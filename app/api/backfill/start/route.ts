import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { google, gmail_v1 } from "googleapis"
import { decrypt } from "@/lib/crypto"
import { createHash } from "crypto"

export async function POST() {
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

  // Build fetch query: first run = last 30d; subsequent runs = last 2d (overlapped)
  let qBase = "(category:primary OR category:updates)"
  let qWindow = "newer_than:30d"
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
  const maxResults = 100 // Gmail allows up to 500; 100 is a safe, fast default
  const perRunCap = 1000 // stop after this many messages per run

  let pageToken: string | undefined = undefined
  let scanned = 0, inserted = 0, uploaded = 0, failed = 0
  const errors: Array<{ id: string, error: unknown }> = []

  async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

  // Retry wrapper to handle transient Gmail/Storage hiccups
  async function retry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 400): Promise<T> {
    let lastErr: any
    for (let i = 0; i < attempts; i++) {
      try { return await fn() } catch (e: any) { lastErr = e }
      await sleep(baseDelayMs * Math.pow(2, i))
    }
    throw lastErr
  }

  while (scanned < perRunCap) {
    try {
      const listData = (await gmail.users.messages.list({ userId: "me", q, maxResults, pageToken })).data as gmail_v1.Schema$ListMessagesResponse
      const messages = listData.messages ?? []
      if (messages.length === 0) break

      for (const m of messages) {
        if (!m.id) continue
        if (scanned >= perRunCap) break
        scanned += 1
        try {
          const getRes = await retry(() => gmail.users.messages.get({ userId: "me", id: m.id as string, format: "raw" }))
          const msg = getRes.data
          const rawBuf = msg.raw ? Buffer.from(msg.raw as string, "base64") : Buffer.from("")

          const dataView = new Uint8Array(rawBuf)
          const sha256 = createHash("sha256").update(dataView).digest("hex")
          const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null

          const path = `${user.id}/${m.id}.eml`
          const upload = await retry(() => supabaseServiceRole.storage
            .from("emails-raw")
            .upload(path, dataView, { contentType: "message/rfc822", upsert: true }))
          if (!upload.error) uploaded += 1

          const rawUrl = `emails-raw/${path}`
          const { error: upErr } = await supabaseServiceRole
            .from("messages_raw")
            .upsert(
              {
                user_id: user.id,
                connected_account_id: acct.id,
                provider: "google",
                provider_message_id: m.id,
                received_at: receivedAt,
                raw_url: rawUrl,
                storage_path: path,
                sha256
              },
              { onConflict: "user_id,provider_message_id" }
            )

          if (upErr) {
            console.error("messages_raw upsert error", upErr)
            errors.push({ id: m.id, error: upErr })
            // record failure row (per-message)
            const existing = await supabaseServiceRole
              .from("ingest_failures")
              .select("id, attempts")
              .eq("user_id", user.id)
              .eq("provider", "google")
              .eq("provider_message_id", m.id)
              .maybeSingle()
            if (existing.data) {
              await supabaseServiceRole
                .from("ingest_failures")
                .update({
                  attempts: (existing.data.attempts || 0) + 1,
                  last_attempt: new Date().toISOString(),
                  phase: "upsert",
                  reason: upErr,
                  resolved: false
                })
                .eq("id", existing.data.id)
            } else {
              await supabaseServiceRole
                .from("ingest_failures")
                .insert({
                  user_id: user.id,
                  connected_account_id: acct.id,
                  provider: "google",
                  provider_message_id: m.id,
                  phase: "upsert",
                  reason: upErr,
                  attempts: 1,
                  last_attempt: new Date().toISOString(),
                  resolved: false
                })
            }
            failed += 1
          } else {
            inserted += 1
            // mark any prior failure as resolved
            await supabaseServiceRole
              .from("ingest_failures")
              .update({ resolved: true, resolved_at: new Date().toISOString() })
              .eq("user_id", user.id)
              .eq("provider", "google")
              .eq("provider_message_id", m.id)
          }
        } catch (e: any) {
          const code = e?.errors?.[0]?.reason || e?.code
          if (code === "rateLimitExceeded" || code === 429) {
            await sleep(1000)
          }
          console.error("backfill item error", e)
          errors.push({ id: m.id!, error: e?.message || e })
          // record failure for fetch/upload errors
          const existing = await supabaseServiceRole
            .from("ingest_failures")
            .select("id, attempts")
            .eq("user_id", user.id)
            .eq("provider", "google")
            .eq("provider_message_id", m.id!)
            .maybeSingle()
          const phase = "fetch"
          if (existing.data) {
            await supabaseServiceRole
              .from("ingest_failures")
              .update({ attempts: (existing.data.attempts || 0) + 1, last_attempt: new Date().toISOString(), phase, reason: e?.message || e, resolved: false })
              .eq("id", existing.data.id)
          } else {
            await supabaseServiceRole
              .from("ingest_failures")
              .insert({ user_id: user.id, connected_account_id: acct.id, provider: "google", provider_message_id: m.id!, phase, reason: e?.message || e, attempts: 1, last_attempt: new Date().toISOString(), resolved: false })
          }
          failed += 1
        }
      }

      pageToken = listData.nextPageToken || undefined
      if (!pageToken) break
    } catch (e: any) {
      const code = e?.errors?.[0]?.reason || e?.code
      if (code === "rateLimitExceeded" || code === 429) {
        await sleep(1500)
        continue
      }
      // If the refresh token is invalid/expired, surface a clear auth error
      const errMsg = (e?.response?.data?.error) || e?.message || ""
      if (String(errMsg).includes("invalid_grant") || code === "invalid_grant") {
        return NextResponse.json({ ok: false, auth_error: "invalid_grant" }, { status: 401 })
      }
      console.error("backfill list error", e)
      break
    }
  }

  // Immediate failure retry sweep: retry queued failures for up to ~60s
  try {
    const sweepStart = Date.now()
    let totalRetried = 0
    while (Date.now() - sweepStart < 60_000) {
      const { data: fails } = await supabaseServiceRole
        .from("ingest_failures")
        .select("id, provider_message_id, attempts")
        .eq("user_id", user.id)
        .eq("provider", "google")
        .eq("resolved", false)
        .lt("attempts", 5)
        .limit(25)
      if (!fails || fails.length === 0) break

      for (const f of fails) {
        try {
          const getRes = await retry(() => gmail.users.messages.get({ userId: "me", id: f.provider_message_id as string, format: "raw" }))
          const msg = getRes.data
          const rawBuf = msg.raw ? Buffer.from(msg.raw as string, "base64") : Buffer.from("")

          const dataView = new Uint8Array(rawBuf)
          const sha256 = createHash("sha256").update(dataView).digest("hex")
          const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null

          const path = `${user.id}/${f.provider_message_id}.eml`
          const upload = await retry(() => supabaseServiceRole.storage
            .from("emails-raw")
            .upload(path, dataView, { contentType: "message/rfc822", upsert: true }))
          if (!upload.error) uploaded += 1

          const rawUrl = `emails-raw/${path}`
          const { error: upErr } = await supabaseServiceRole
            .from("messages_raw")
            .upsert(
              {
                user_id: user.id,
                connected_account_id: acct.id,
                provider: "google",
                provider_message_id: f.provider_message_id,
                received_at: receivedAt,
                raw_url: rawUrl,
                storage_path: path,
                sha256
              },
              { onConflict: "user_id,provider_message_id" }
            )

          if (upErr) {
            await supabaseServiceRole
              .from("ingest_failures")
              .update({ attempts: (f.attempts || 0) + 1, last_attempt: new Date().toISOString(), phase: "upsert", reason: upErr, resolved: false })
              .eq("id", f.id)
          } else {
            await supabaseServiceRole
              .from("ingest_failures")
              .update({ resolved: true, resolved_at: new Date().toISOString() })
              .eq("id", f.id)
            totalRetried += 1
          }
        } catch (e: any) {
          await supabaseServiceRole
            .from("ingest_failures")
            .update({ attempts: (f.attempts || 0) + 1, last_attempt: new Date().toISOString(), phase: "fetch", reason: e?.message || e, resolved: false })
            .eq("id", f.id)
        }
      }

      // small pause between mini-batches
      await sleep(500)
    }
  } catch (e) {
    console.error("failure retry sweep error", e)
  }

  // Update watermark for observability (not used for newer_than fetch)
  try {
    await supabaseServiceRole
      .from("system_state")
      .upsert({ user_id: user.id, last_backfill_at: new Date().toISOString(), key: "default", value: "backfill" }, { onConflict: "user_id" })
  } catch (e) {
    console.error("system_state upsert error", e)
  }

  // Purge raws older than 30 days (FK cascade will clean messages_clean)
  try {
    const cutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    await supabaseServiceRole
      .from("messages_raw")
      .delete()
      .eq("user_id", user.id)
      .lt("received_at", cutoffIso)
  } catch (e) {
    console.error("purge old raws error", e)
  }

  return NextResponse.json({ ok: true, query: q, messages_scanned: scanned, uploaded, inserted, failed, errors })
}
