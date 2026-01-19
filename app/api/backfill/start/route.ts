import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { google, gmail_v1 } from "googleapis"
import { decrypt } from "@/lib/crypto"
import pLimit from "p-limit"
import { extractSenderKey } from "@/lib/onboard/sender-extraction"

export async function POST() {
  const startTime = Date.now()
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: acct, error: acctErr } = await supabaseServiceRole
    .from("connected_accounts")
    .select("id, provider, refresh_token, refresh_token_ciphertext, account_email")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .limit(1)
    .single()
  if (acctErr || !acct) return NextResponse.json({ error: "No connected Google account" }, { status: 400 })

  const enc = acct.refresh_token_ciphertext ?? acct.refresh_token
  if (!enc) return NextResponse.json({ error: "Missing refresh token" }, { status: 400 })
  const refreshToken = decrypt(enc)

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  )
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const gmail = google.gmail({ version: "v1", auth: oauth2Client })

  // Build fetch query: first run = last 14d (2 weeks); subsequent runs = last 2d (overlapped)
  let qBase = "(category:primary OR category:updates)"
  let qWindow = "newer_than:14d"
  try {
    const state = await supabaseServiceRole
      .from("system_state")
      .select("last_backfill_at")
      .eq("user_id", user.id)
      .maybeSingle()
    const last = state.data?.last_backfill_at as string | null | undefined
    if (last) {
      // Incremental window; rely on upsert idempotency. Keep a generous overlap.
      qWindow = "newer_than:2d"
    }
  } catch {}
  const q = `${qBase} ${qWindow}`
  const maxResults = 500 // Increased from 100 - Gmail allows up to 500
  const perRunCap = 1000 // stop after this many messages per run

  // Setup concurrency limit (aggressive test: 75 parallel requests)
  // Gmail quota: ~250 units/sec, each messages.get = 1 unit → safe up to ~100
  const limit = pLimit(75)

  let pageToken: string | undefined = undefined
  let scanned = 0
  const allMessageIds: string[] = []
  const errors: Array<{ id: string, error: unknown }> = []

  // Step 1: Collect all message IDs (fast, no parsing)
  while (scanned < perRunCap) {
    try {
      const listData = (await gmail.users.messages.list({ userId: "me", q, maxResults, pageToken })).data as gmail_v1.Schema$ListMessagesResponse
      const messages = listData.messages ?? []
      if (messages.length === 0) break

      for (const m of messages) {
        if (!m.id) continue
        if (scanned >= perRunCap) break
        scanned += 1
        allMessageIds.push(m.id)
      }

      pageToken = listData.nextPageToken || undefined
      if (!pageToken) break
    } catch (e: any) {
      const code = e?.errors?.[0]?.reason || e?.code
      if (code === "rateLimitExceeded" || code === 429) {
        await new Promise(r => setTimeout(r, 1500))
        continue
      }
      const errMsg = (e?.response?.data?.error) || e?.message || ""
      if (String(errMsg).includes("invalid_grant") || code === "invalid_grant") {
        return NextResponse.json({ ok: false, auth_error: "invalid_grant" }, { status: 401 })
      }
      console.error("backfill list error", e)
      break
    }
  }

  // Step 2: Fetch metadata for all messages in parallel
  const emailTasks = allMessageIds.map((messageId) =>
    limit(async () => {
      try {
        // OPTIMIZATION: Request ONLY metadata (No raw body = 100x smaller payload)
        const res = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "metadata",
          metadataHeaders: [
            "From",
            "Subject",
            "Date",
            "List-ID",
            "List-Unsubscribe",
            "Return-Path",      // Needed for extractSenderKey
            "DKIM-Signature",   // Needed for extractSenderKey
            "Message-Id"        // Needed for extractSenderKey
          ]
        })

        const headers = res.data.payload?.headers || []
        const getHeader = (name: string) => {
          const h = headers.find(h => h.name?.toLowerCase() === name.toLowerCase())
          return h?.value || undefined
        }

        const fromValue = getHeader("From") || ""
        const subject = getHeader("Subject") || ""
        const date = getHeader("Date") || ""

        // Extract email/name from the "From" header string
        const fromEmailMatch = fromValue.match(/<(.+?)>/)
        const fromEmail = fromEmailMatch ? fromEmailMatch[1] : (fromValue.includes("@") ? fromValue.trim() : "")
        const fromName = fromValue.replace(/<.+?>/, "").trim() || null
        const fromDomain = fromEmail && fromEmail.includes("@") ? fromEmail.split("@")[1]?.toLowerCase() : null

        // Build headers object for extractSenderKey
        const headersObj: Record<string, string | undefined> = {}
        headers.forEach(h => {
          if (h.name && h.value) {
            headersObj[h.name.toLowerCase()] = h.value
          }
        })

        // Extract sender_key using all needed headers
        const senderKey = extractSenderKey(headersObj, fromDomain || null)

        // Minimal headers_json (only what we need for classification)
        const headersJson = {
          list_id: getHeader("List-ID") || null,
          list_unsubscribe: getHeader("List-Unsubscribe") || null,
          from: fromValue || null,
          subject: subject || null,
          date: date || null
        }

        // Use internalDate (more reliable than parsing Date header)
        const receivedAt = res.data.internalDate
          ? new Date(Number(res.data.internalDate)).toISOString()
          : null

        return {
          user_id: user.id,
          connected_account_id: acct.id,
          provider: "google",
          provider_message_id: messageId,
          received_at: receivedAt,
          sender_key: senderKey,
          subject: subject || null,
          from_name: fromName,
          from_email: fromEmail || null,
          headers_json: headersJson,
          storage_path: `skipped/${user.id}/${messageId}`, // Placeholder - not storing .eml files for speed
          // Skip: raw_url, sha256 (not needed for onboarding)
        }
      } catch (err: any) {
        const code = err?.errors?.[0]?.reason || err?.code
        const errMsg = err?.response?.data?.error || err?.message || ""
        
        // OAuth/auth errors - these are fatal and should stop the whole process
        if (code === "invalid_grant" || String(errMsg).includes("invalid_grant") || 
            code === 401 || String(errMsg).includes("unauthorized") ||
            String(errMsg).includes("Invalid Credentials")) {
          throw err // Re-throw to be caught by outer handler
        }
        
        if (code === "rateLimitExceeded" || code === 429) {
          // Rate limited - return null, will be retried if needed
          return null
        }
        console.error(`Failed to fetch ${messageId}`, err)
        errors.push({ id: messageId, error: err?.message || err })
        return null // Skip failed ones
      }
    })
  )

  // Step 3: Execute all requests in parallel
  type EmailResult = {
    user_id: string
    connected_account_id: string
    provider: string
    provider_message_id: string
    received_at: string | null
    sender_key: string | null
    subject: string | null
    from_name: string | null
    from_email: string | null
    headers_json: Record<string, any>
    storage_path: string
  }
  
  let allResults: Array<EmailResult | null> = []
  try {
    allResults = await Promise.all(emailTasks)
  } catch (err: any) {
    // Catch OAuth errors that were re-thrown from individual tasks
    const errMsg = err?.response?.data?.error || err?.message || ""
    const code = err?.errors?.[0]?.reason || err?.code
    if (code === "invalid_grant" || String(errMsg).includes("invalid_grant") || 
        code === 401 || String(errMsg).includes("unauthorized")) {
      return NextResponse.json({ ok: false, auth_error: "invalid_grant", message: "OAuth token expired. Please reconnect your Google account." }, { status: 401 })
    }
    throw err // Re-throw other errors
  }
  const results = allResults.filter((r): r is EmailResult => r !== null)
  const fetchFailed = allResults.length - results.length // Count of null results (failed fetches)

  // Step 4: PARALLEL Chunked Upserts (Multiple DB trips in parallel)
  let inserted = 0
  let upsertFailed = 0
  if (results.length > 0) {
    const CHUNK_SIZE = 200 // Batch size per upsert
    const chunks: typeof results[] = []
    for (let i = 0; i < results.length; i += CHUNK_SIZE) {
      chunks.push(results.slice(i, i + CHUNK_SIZE))
    }

    // Parallel upserts (limit to 10 concurrent DB writes to avoid overwhelming DB)
    const dbLimit = pLimit(10)
    const upsertTasks = chunks.map((chunk) =>
      dbLimit(async () => {
        const { error: upErr } = await supabaseServiceRole
          .from("messages_raw")
          .upsert(chunk, { onConflict: "user_id,provider_message_id" })

        if (upErr) {
          console.error(`chunk upsert error (${chunk.length} records)`, upErr)
          return { success: false, count: chunk.length, error: upErr }
        }
        return { success: true, count: chunk.length }
      })
    )

    const upsertResults = await Promise.all(upsertTasks)
    for (const result of upsertResults) {
      if (result.success) {
        inserted += result.count
      } else {
        upsertFailed += result.count
        errors.push({ id: "bulk", error: result.error?.message || String(result.error) })
      }
    }
  }

  // Update watermark for observability
  try {
    await supabaseServiceRole
      .from("system_state")
      .upsert({ user_id: user.id, last_backfill_at: new Date().toISOString(), key: "default", value: "\"backfill\"" }, { onConflict: "user_id" })
  } catch (e) {
    console.error("system_state upsert error", e)
  }

  // Purge raws older than 14 days
  try {
    const cutoffIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    await supabaseServiceRole
      .from("messages_raw")
      .delete()
      .eq("user_id", user.id)
      .lt("received_at", cutoffIso)
  } catch (e) {
    console.error("purge old raws error", e)
  }

  const totalFailed = fetchFailed + upsertFailed
  const elapsed = Date.now() - startTime

  return NextResponse.json({
    ok: true,
    query: q,
    messages_scanned: scanned,
    inserted,
    failed: totalFailed,
    fetch_failed: fetchFailed,
    upsert_failed: upsertFailed,
    time_ms: elapsed,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined // Limit errors to first 10
  })
}
