import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { google, gmail_v1 } from "googleapis"
import { decrypt } from "@/lib/crypto"
import pLimit from "p-limit"
import { extractSenderKey } from "@/lib/onboard/sender-extraction"

/**
 * POST /api/digest/fetch-emails
 * 
 * Fetches full email bodies from Gmail API for selected newsletters within lookback window.
 * Stores email bodies in digest_items table (temporary storage, digest_id = NULL).
 * 
 * Body: { lookback_days?: number } - Override lookback window (defaults to config-based)
 */
export async function POST(req: Request) {
  const startTime = Date.now()
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (!user) {
    console.error("Auth error:", userError)
    return NextResponse.json({ 
      ok: false, 
      error: "Unauthorized - Please log in again",
      details: userError?.message || "No user session found"
    }, { status: 401 })
  }

  try {
    // Parse request body
    const body = await req.json().catch(() => ({}))
    const lookbackDays = body.lookback_days ? parseInt(body.lookback_days) : null

    // 1. Get Google OAuth connection
    const { data: acct, error: acctErr } = await supabaseServiceRole
      .from("connected_accounts")
      .select("id, provider, refresh_token, refresh_token_ciphertext, account_email")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .limit(1)
      .single()
    if (acctErr || !acct) {
      console.error("No Google account found:", acctErr)
      return NextResponse.json({ 
        ok: false, 
        error: "No connected Google account",
        details: acctErr?.message || "Please connect your Google account first"
      }, { status: 400 })
    }

    const enc = acct.refresh_token_ciphertext ?? acct.refresh_token
    if (!enc) {
      console.error("Missing refresh token for user:", user.id)
      return NextResponse.json({ 
        ok: false, 
        error: "Missing refresh token",
        details: "OAuth token not found. Please reconnect your Google account."
      }, { status: 400 })
    }
    
    let refreshToken: string
    try {
      refreshToken = decrypt(enc)
    } catch (decryptErr: any) {
      console.error("Failed to decrypt refresh token:", decryptErr)
      return NextResponse.json({ 
        ok: false, 
        error: "Failed to decrypt OAuth token",
        details: decryptErr?.message || "Please reconnect your Google account"
      }, { status: 401 })
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    )
    oauth2Client.setCredentials({ refresh_token: refreshToken })
    
    // Validate OAuth token before starting long process (fail fast)
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2Client })
      await gmail.users.getProfile({ userId: "me" })
    } catch (oauthErr: any) {
      const code = oauthErr?.errors?.[0]?.reason || oauthErr?.code
      const errMsg = oauthErr?.response?.data?.error || oauthErr?.message || ""
      if (code === "invalid_grant" || String(errMsg).includes("invalid_grant") || 
          code === 401 || String(errMsg).includes("unauthorized")) {
        return NextResponse.json({ 
          ok: false, 
          auth_error: "invalid_grant",
          error: "OAuth token expired. Please reconnect your Google account.",
          details: "Your Google OAuth token has expired. Click 'Reconnect' in the Digest Status card."
        }, { status: 401 })
      }
      throw oauthErr // Re-throw if it's not an OAuth error
    }
    
    const gmail = google.gmail({ version: "v1", auth: oauth2Client })

    // 2. Get selected newsletters
    const { data: selections, error: selErr } = await supabaseServiceRole
      .from("user_newsletter_selections")
      .select("sender_key")
      .eq("user_id", user.id)
      .eq("selected", true)

    if (selErr || !selections || selections.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: "No newsletters selected. Please select newsletters first." 
      }, { status: 400 })
    }

    const selectedSenderKeys = selections.map(s => s.sender_key).filter(Boolean)
    if (selectedSenderKeys.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: "No valid sender keys found" 
      }, { status: 400 })
    }

    // 3. Get from_email addresses for selected sender_keys (to build Gmail query)
    const { data: senderEmails, error: emailErr } = await supabaseServiceRole
      .from("messages_raw")
      .select("sender_key, from_email")
      .eq("user_id", user.id)
      .in("sender_key", selectedSenderKeys)
      .not("from_email", "is", null)
      .neq("from_email", "")

    if (emailErr) {
      return NextResponse.json({ ok: false, error: emailErr.message }, { status: 500 })
    }

    // Build map of sender_key -> email addresses
    const senderKeyToEmails = new Map<string, Set<string>>()
    if (senderEmails) {
      for (const row of senderEmails) {
        if (!row.sender_key || !row.from_email) continue
        const emails = senderKeyToEmails.get(row.sender_key) || new Set()
        emails.add(row.from_email)
        senderKeyToEmails.set(row.sender_key, emails)
      }
    }

    // Build Gmail query: (from:email1 OR from:email2 OR ...) newer_than:Xd
    const lookbackDaysValue = lookbackDays || 1
    const fromQueries: string[] = []
    
    for (const [senderKey, emails] of senderKeyToEmails.entries()) {
      if (emails.size > 0) {
        // Use up to 10 emails per sender (Gmail query limit)
        const emailList = Array.from(emails).slice(0, 10)
        const emailQuery = emailList.map(e => `from:${e}`).join(" OR ")
        fromQueries.push(`(${emailQuery})`)
      } else {
        // Fallback: use domain-based query if no emails found
        fromQueries.push(`from:${senderKey}`)
      }
    }

    if (fromQueries.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: "Could not determine email addresses for selected newsletters. Please run backfill first." 
      }, { status: 400 })
    }

    // Build final Gmail query
    const gmailQuery = `(${fromQueries.join(" OR ")}) newer_than:${lookbackDaysValue}d (category:primary OR category:updates)`
    
    // 4. Query Gmail API directly for recent messages
    const allMessageIds: string[] = []
    let pageToken: string | undefined = undefined
    const maxResults = 500

    while (allMessageIds.length < 1000) { // Cap at 1000 messages
      try {
        const listResponse = await gmail.users.messages.list({
          userId: "me",
          q: gmailQuery,
          maxResults,
          pageToken
        })
        const listRes = listResponse.data as gmail_v1.Schema$ListMessagesResponse

        const messages = listRes.messages || []
        if (messages.length === 0) break

        for (const m of messages) {
          if (m.id) allMessageIds.push(m.id)
        }

        pageToken = listRes.nextPageToken || undefined
        if (!pageToken) break
      } catch (e: any) {
        const code = e?.errors?.[0]?.reason || e?.code
        if (code === "rateLimitExceeded" || code === 429) {
          await new Promise(r => setTimeout(r, 1500))
          continue
        }
        const errMsg = (e?.response?.data?.error) || e?.message || ""
        if (String(errMsg).includes("invalid_grant") || code === "invalid_grant") {
          return NextResponse.json({ ok: false, auth_error: "invalid_grant", message: "OAuth token expired. Please reconnect your Google account." }, { status: 401 })
        }
        console.error("Gmail list error", e)
        break
      }
    }

    if (allMessageIds.length === 0) {
      return NextResponse.json({ 
        ok: true, 
        emails_fetched: 0,
        items_stored: 0,
        message: `No messages found for selected newsletters in the last ${lookbackDaysValue} day(s)`,
        gmail_query: gmailQuery
      })
    }

    // 5. Fetch metadata first to filter by sender_key and get message details
    const metadataLimit = pLimit(20)
    const metadataTasks = allMessageIds.map((messageId) =>
      metadataLimit(async () => {
        try {
          const res = await gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date", "Return-Path", "DKIM-Signature", "Message-Id"]
          })

          const headers = res.data.payload?.headers || []
          const getHeader = (name: string) => {
            const h = headers.find(h => h.name?.toLowerCase() === name.toLowerCase())
            return h?.value || undefined
          }

          const fromValue = getHeader("From") || ""
          const fromEmailMatch = fromValue.match(/<(.+?)>/)
          const fromEmail = fromEmailMatch ? fromEmailMatch[1] : (fromValue.includes("@") ? fromValue.trim() : "")
          const fromDomain = fromEmail && fromEmail.includes("@") ? fromEmail.split("@")[1]?.toLowerCase() : null
          const fromName = fromValue.replace(/<.+?>/, "").trim() || null

          // Extract sender_key to verify it matches selected newsletters
          const headersObj: Record<string, string | undefined> = {}
          headers.forEach(h => {
            if (h.name && h.value) {
              headersObj[h.name.toLowerCase()] = h.value
            }
          })

          const senderKey = extractSenderKey(headersObj, fromDomain || null)

          // Only include if sender_key matches selected newsletters
          if (!senderKey || !selectedSenderKeys.includes(senderKey)) {
            return null
          }

          const receivedAt = res.data.internalDate
            ? new Date(Number(res.data.internalDate)).toISOString()
            : null

          return {
            provider_message_id: messageId,
            sender_key: senderKey,
            subject: getHeader("Subject") || null,
            from_name: fromName,
            from_email: fromEmail || null,
            received_at: receivedAt
          }
        } catch (err: any) {
          console.error(`Failed to fetch metadata for ${messageId}`, err)
          return null
        }
      })
    )

    const metadataResults = await Promise.all(metadataTasks)
    const filteredMessages = metadataResults.filter((r): r is NonNullable<typeof metadataResults[0]> => r !== null)

    if (filteredMessages.length === 0) {
      return NextResponse.json({ 
        ok: true, 
        emails_fetched: 0,
        items_stored: 0,
        message: `No messages found for selected newsletters in the last ${lookbackDaysValue} day(s) after filtering`,
        gmail_query: gmailQuery
      })
    }

    // 6. Fetch full email bodies in parallel
    const limit = pLimit(20) // Conservative for full body fetches
    const errors: Array<{ message_id: string; error: string }> = []

    const emailTasks = filteredMessages.map((msg) =>
      limit(async () => {
        try {
          const res = await gmail.users.messages.get({
            userId: "me",
            id: msg.provider_message_id,
            format: "full" // Get full email body
          })

          // Parse email body from Gmail payload
          const parsed = await parseGmailPayload(res.data.payload)
          
          return {
            provider_message_id: msg.provider_message_id,
            sender_key: msg.sender_key,
            subject: msg.subject,
            from_name: msg.from_name,
            from_email: msg.from_email,
            received_at: msg.received_at,
            html_content: parsed.html || null,
            text_content: parsed.text || null,
            links: parsed.links || []
          }
        } catch (err: any) {
          const code = err?.errors?.[0]?.reason || err?.code
          const errMsg = err?.response?.data?.error || err?.message || ""
          
          // OAuth/auth errors - fatal
          if (code === "invalid_grant" || String(errMsg).includes("invalid_grant") || 
              code === 401 || String(errMsg).includes("unauthorized")) {
            throw err // Re-throw to be caught by outer handler
          }
          
          if (code === "rateLimitExceeded" || code === 429) {
            return null
          }
          
          console.error(`Failed to fetch ${msg.provider_message_id}`, err)
          errors.push({ 
            message_id: msg.provider_message_id, 
            error: err?.message || String(err) 
          })
          return null
        }
      })
    )

    type EmailContent = {
      provider_message_id: string
      sender_key: string | null
      subject: string | null
      from_name: string | null
      from_email: string | null
      received_at: string | null
      html_content: string | null
      text_content: string | null
      links: string[]
    }

    let allResults: Array<EmailContent | null> = []
    try {
      allResults = await Promise.all(emailTasks)
    } catch (err: any) {
      // Catch OAuth errors
      const errMsg = err?.response?.data?.error || err?.message || ""
      const code = err?.errors?.[0]?.reason || err?.code
      if (code === "invalid_grant" || String(errMsg).includes("invalid_grant") || 
          code === 401 || String(errMsg).includes("unauthorized")) {
        return NextResponse.json({ 
          ok: false, 
          auth_error: "invalid_grant", 
          message: "OAuth token expired. Please reconnect your Google account." 
        }, { status: 401 })
      }
      throw err
    }

    const emails = allResults.filter((r): r is EmailContent => r !== null)
    const fetchFailed = allResults.length - emails.length

    // 7. Clean up any existing temporary items for this user (from previous failed runs)
    await supabaseServiceRole
      .from("digest_items")
      .delete()
      .eq("user_id", user.id)
      .is("digest_id", null)

    // 8. Store email bodies in digest_items (temporary storage, digest_id = NULL)
    const itemsToInsert = emails.map((email, index) => ({
      user_id: user.id,
      digest_id: null, // Temporary storage
      sender_key: email.sender_key,
      newsletter_name: email.from_name, // Use from_name as newsletter name
      subject: email.subject,
      received_at: email.received_at,
      provider_message_id: email.provider_message_id,
      html_content: email.html_content,
      text_content: email.text_content,
      links: email.links.length > 0 ? email.links : [], // Store all links as JSONB array
      article_url: email.links.length > 0 ? email.links[0] : null, // Use first link as article URL (for backward compatibility)
      order_index: index, // Will be reordered later
      content_summary: null // Will be filled by summarization step
    }))

    let itemsStored = 0
    if (itemsToInsert.length > 0) {
      // Bulk insert in chunks
      const CHUNK_SIZE = 200
      const chunks: typeof itemsToInsert[] = []
      for (let i = 0; i < itemsToInsert.length; i += CHUNK_SIZE) {
        chunks.push(itemsToInsert.slice(i, i + CHUNK_SIZE))
      }

      const dbLimit = pLimit(10)
      const insertTasks = chunks.map((chunk) =>
        dbLimit(async () => {
          const { error: insertErr } = await supabaseServiceRole
            .from("digest_items")
            .insert(chunk)

          if (insertErr) {
            console.error(`chunk insert error (${chunk.length} records)`, insertErr)
            return { success: false, count: chunk.length, error: insertErr }
          }
          return { success: true, count: chunk.length }
        })
      )

      const insertResults = await Promise.all(insertTasks)
      for (const result of insertResults) {
        if (result.success) {
          itemsStored += result.count
        } else {
          errors.push({ message_id: "bulk", error: result.error?.message || String(result.error) })
        }
      }
    }

    const elapsed = Date.now() - startTime

    return NextResponse.json({
      ok: true,
      emails_fetched: emails.length,
      emails_failed: fetchFailed,
      items_stored: itemsStored,
      lookback_days: lookbackDaysValue,
      time_ms: elapsed,
      gmail_query: gmailQuery,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined
    })

  } catch (e: any) {
    console.error("Error fetching emails:", e)
    
    // Check if it's an OAuth/auth error
    const code = e?.errors?.[0]?.reason || e?.code
    const errMsg = e?.response?.data?.error || e?.message || ""
    
    if (code === "invalid_grant" || String(errMsg).includes("invalid_grant") || 
        code === 401 || String(errMsg).includes("unauthorized")) {
      return NextResponse.json({ 
        ok: false, 
        auth_error: "invalid_grant",
        error: "OAuth token expired. Please reconnect your Google account.",
        details: String(errMsg || e)
      }, { status: 401 })
    }
    
    return NextResponse.json({ 
      ok: false, 
      error: String(e.message || e),
      details: String(errMsg || e)
    }, { status: 500 })
  }
}

/**
 * Parse Gmail API payload to extract HTML/text content
 * Handles multipart emails and base64 encoding
 */
async function parseGmailPayload(payload: gmail_v1.Schema$MessagePart | undefined): Promise<{
  html: string | null
  text: string | null
  links: string[]
}> {
  if (!payload) {
    return { html: null, text: null, links: [] }
  }

  // If it's a multipart message, find HTML and text parts
  if (payload.parts && payload.parts.length > 0) {
    let htmlPart: gmail_v1.Schema$MessagePart | null = null
    let textPart: gmail_v1.Schema$MessagePart | null = null

    for (const part of payload.parts) {
      const mimeType = part.mimeType || ""
      if (mimeType === "text/html" && !htmlPart) {
        htmlPart = part
      } else if (mimeType === "text/plain" && !textPart) {
        textPart = part
      }
      
      // Also check nested parts (multipart/alternative)
      if (part.parts && part.parts.length > 0) {
        for (const nestedPart of part.parts) {
          const nestedMimeType = nestedPart.mimeType || ""
          if (nestedMimeType === "text/html" && !htmlPart) {
            htmlPart = nestedPart
          } else if (nestedMimeType === "text/plain" && !textPart) {
            textPart = nestedPart
          }
        }
      }
    }

    const html = htmlPart?.body?.data ? decodeBase64(htmlPart.body.data) : null
    const text = textPart?.body?.data ? decodeBase64(textPart.body.data) : null

    // Extract links from HTML
    const links = extractLinks(html || "")

    return { html, text, links }
  }

  // Single part message
  const mimeType = payload.mimeType || ""
  const bodyData = payload.body?.data

  if (!bodyData) {
    return { html: null, text: null, links: [] }
  }

  const content = decodeBase64(bodyData)

  if (mimeType === "text/html") {
    const links = extractLinks(content)
    return { html: content, text: null, links }
  } else if (mimeType === "text/plain") {
    return { html: null, text: content, links: [] }
  }

  // Try parsing as MIME with mailparser
  try {
    const { simpleParser } = await import("mailparser")
    const parsed = await simpleParser(Buffer.from(content))
    const html = parsed.html || null
    const text = parsed.text || null
    const links = extractLinks(html || "")
    return { html, text, links }
  } catch {
    // Fallback: return as text
    return { html: null, text: content, links: [] }
  }
}

/**
 * Decode base64url (Gmail uses base64url, not standard base64)
 */
function decodeBase64(data: string): string {
  try {
    // Gmail uses base64url encoding, need to convert to standard base64
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/")
    const padding = "=".repeat((4 - (base64.length % 4)) % 4)
    return Buffer.from(base64 + padding, "base64").toString("utf-8")
  } catch {
    return ""
  }
}

/**
 * Extract links from HTML content
 */
function extractLinks(html: string): string[] {
  const links: string[] = []
  const linkRegex = /href=["']([^"']+)["']/gi
  let match
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1]
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      links.push(url)
    }
  }
  return [...new Set(links)] // Remove duplicates
}
