import { supabaseServiceRole } from "@/lib/supabase/service"
import { google, gmail_v1 } from "googleapis"
import { decrypt } from "@/lib/crypto"
import pLimit from "p-limit"
import { extractSenderKey } from "@/lib/onboard/sender-extraction"

type FetchResult = {
  ok: boolean
  emails_fetched: number
  items_stored: number
  skipped_reason?: string
  error?: string
}

export async function fetchNewslettersForUser(userId: string, lookbackDays = 1): Promise<FetchResult> {
  const { data: acct } = await supabaseServiceRole
    .from("connected_accounts")
    .select("refresh_token, refresh_token_ciphertext")
    .eq("user_id", userId)
    .eq("provider", "google")
    .limit(1)
    .maybeSingle()

  if (!acct) {
    return { ok: true, emails_fetched: 0, items_stored: 0, skipped_reason: "no_google_account" }
  }

  const enc = acct.refresh_token_ciphertext ?? acct.refresh_token
  if (!enc) {
    return { ok: false, emails_fetched: 0, items_stored: 0, error: "missing_refresh_token" }
  }

  let refreshToken: string
  try {
    refreshToken = decrypt(enc)
  } catch {
    return { ok: false, emails_fetched: 0, items_stored: 0, error: "decrypt_failed" }
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  )
  oauth2Client.setCredentials({ refresh_token: refreshToken })

  const gmail = google.gmail({ version: "v1", auth: oauth2Client })

  try {
    await gmail.users.getProfile({ userId: "me" })
  } catch {
    return { ok: false, emails_fetched: 0, items_stored: 0, error: "oauth_invalid" }
  }

  const { data: selections } = await supabaseServiceRole
    .from("user_newsletter_selections")
    .select("sender_key")
    .eq("user_id", userId)
    .eq("selected", true)

  if (!selections || selections.length === 0) {
    return { ok: true, emails_fetched: 0, items_stored: 0, skipped_reason: "no_selections" }
  }

  const selectedSenderKeys = selections.map(s => s.sender_key).filter(Boolean)

  const { data: senderEmails } = await supabaseServiceRole
    .from("messages_raw")
    .select("sender_key, from_email")
    .eq("user_id", userId)
    .in("sender_key", selectedSenderKeys)
    .not("from_email", "is", null)
    .neq("from_email", "")

  const senderKeyToEmails = new Map<string, Set<string>>()
  if (senderEmails) {
    for (const row of senderEmails) {
      if (!row.sender_key || !row.from_email) continue
      const emails = senderKeyToEmails.get(row.sender_key) || new Set()
      emails.add(row.from_email)
      senderKeyToEmails.set(row.sender_key, emails)
    }
  }

  const fromQueries: string[] = []
  for (const [senderKey, emails] of senderKeyToEmails.entries()) {
    if (emails.size > 0) {
      const emailList = Array.from(emails).slice(0, 10)
      fromQueries.push(`(${emailList.map(e => `from:${e}`).join(" OR ")})`)
    } else {
      fromQueries.push(`from:${senderKey}`)
    }
  }

  if (fromQueries.length === 0) {
    return { ok: true, emails_fetched: 0, items_stored: 0, skipped_reason: "no_sender_emails" }
  }

  const gmailQuery = `(${fromQueries.join(" OR ")}) newer_than:${lookbackDays}d (category:primary OR category:updates)`

  const allMessageIds: string[] = []
  let pageToken: string | undefined

  while (allMessageIds.length < 1000) {
    try {
      const listResponse = await gmail.users.messages.list({
        userId: "me",
        q: gmailQuery,
        maxResults: 500,
        pageToken
      })
      const listRes = listResponse.data as gmail_v1.Schema$ListMessagesResponse
      const messages = listRes.messages || []
      if (messages.length === 0) break
      for (const m of messages) { if (m.id) allMessageIds.push(m.id) }
      pageToken = listRes.nextPageToken || undefined
      if (!pageToken) break
    } catch (e: any) {
      if (e?.errors?.[0]?.reason === "rateLimitExceeded" || e?.code === 429) {
        await new Promise(r => setTimeout(r, 1500))
        continue
      }
      break
    }
  }

  if (allMessageIds.length === 0) {
    return { ok: true, emails_fetched: 0, items_stored: 0, skipped_reason: "no_messages_found" }
  }

  const metadataLimit = pLimit(20)
  const metadataResults = await Promise.all(
    allMessageIds.map(messageId =>
      metadataLimit(async () => {
        try {
          const res = await gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date", "Return-Path", "DKIM-Signature", "Message-Id"]
          })
          const headers = res.data.payload?.headers || []
          const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || undefined
          const fromValue = getHeader("From") || ""
          const fromEmailMatch = fromValue.match(/<(.+?)>/)
          const fromEmail = fromEmailMatch ? fromEmailMatch[1] : (fromValue.includes("@") ? fromValue.trim() : "")
          const fromDomain = fromEmail?.includes("@") ? fromEmail.split("@")[1]?.toLowerCase() : null
          const fromName = fromValue.replace(/<.+?>/, "").trim() || null

          const headersObj: Record<string, string | undefined> = {}
          headers.forEach(h => { if (h.name && h.value) headersObj[h.name.toLowerCase()] = h.value })
          const senderKey = extractSenderKey(headersObj, fromDomain || null)

          if (!senderKey || !selectedSenderKeys.includes(senderKey)) return null

          return {
            provider_message_id: messageId,
            sender_key: senderKey,
            subject: getHeader("Subject") || null,
            from_name: fromName,
            from_email: fromEmail || null,
            received_at: res.data.internalDate ? new Date(Number(res.data.internalDate)).toISOString() : null,
          }
        } catch { return null }
      })
    )
  )

  const filtered = metadataResults.filter((r): r is NonNullable<typeof r> => r !== null)
  if (filtered.length === 0) {
    return { ok: true, emails_fetched: 0, items_stored: 0, skipped_reason: "no_matching_messages" }
  }

  const bodyLimit = pLimit(20)
  const bodyResults = await Promise.all(
    filtered.map(msg =>
      bodyLimit(async () => {
        try {
          const res = await gmail.users.messages.get({ userId: "me", id: msg.provider_message_id, format: "full" })
          const parsed = parsePayload(res.data.payload)
          return { ...msg, html_content: parsed.html, text_content: parsed.text, links: parsed.links }
        } catch { return null }
      })
    )
  )

  const emails = bodyResults.filter((r): r is NonNullable<typeof r> => r !== null)

  await supabaseServiceRole.from("digest_items").delete().eq("user_id", userId).is("digest_id", null)

  const items = emails.map((email, i) => ({
    user_id: userId,
    digest_id: null,
    sender_key: email.sender_key,
    newsletter_name: email.from_name,
    subject: email.subject,
    received_at: email.received_at,
    provider_message_id: email.provider_message_id,
    html_content: email.html_content,
    text_content: email.text_content,
    links: email.links.length > 0 ? email.links : [],
    article_url: email.links.length > 0 ? email.links[0] : null,
    order_index: i,
    content_summary: null,
  }))

  let stored = 0
  const CHUNK = 200
  for (let i = 0; i < items.length; i += CHUNK) {
    const { error } = await supabaseServiceRole.from("digest_items").insert(items.slice(i, i + CHUNK))
    if (!error) stored += Math.min(CHUNK, items.length - i)
  }

  return { ok: true, emails_fetched: emails.length, items_stored: stored }
}

function parsePayload(payload: gmail_v1.Schema$MessagePart | undefined): { html: string | null; text: string | null; links: string[] } {
  if (!payload) return { html: null, text: null, links: [] }

  if (payload.parts && payload.parts.length > 0) {
    let htmlPart: gmail_v1.Schema$MessagePart | null = null
    let textPart: gmail_v1.Schema$MessagePart | null = null

    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && !htmlPart) htmlPart = part
      else if (part.mimeType === "text/plain" && !textPart) textPart = part
      if (part.parts) {
        for (const nested of part.parts) {
          if (nested.mimeType === "text/html" && !htmlPart) htmlPart = nested
          else if (nested.mimeType === "text/plain" && !textPart) textPart = nested
        }
      }
    }

    const html = htmlPart?.body?.data ? decodeBase64(htmlPart.body.data) : null
    const text = textPart?.body?.data ? decodeBase64(textPart.body.data) : null
    return { html, text, links: extractLinks(html || "") }
  }

  const bodyData = payload.body?.data
  if (!bodyData) return { html: null, text: null, links: [] }
  const content = decodeBase64(bodyData)

  if (payload.mimeType === "text/html") return { html: content, text: null, links: extractLinks(content) }
  if (payload.mimeType === "text/plain") return { html: null, text: content, links: [] }
  return { html: null, text: content, links: [] }
}

function decodeBase64(data: string): string {
  try {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/")
    const padding = "=".repeat((4 - (base64.length % 4)) % 4)
    return Buffer.from(base64 + padding, "base64").toString("utf-8")
  } catch { return "" }
}

function extractLinks(html: string): string[] {
  const links: string[] = []
  const re = /href=["']([^"']+)["']/gi
  let m
  while ((m = re.exec(html)) !== null) {
    if (m[1]?.startsWith("http")) links.push(m[1])
  }
  return [...new Set(links)]
}
