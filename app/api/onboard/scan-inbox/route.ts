import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { decrypt } from "@/lib/crypto"
import { shouldSkipLLM } from "@/lib/onboard/hard-rules"
import pLimit from "p-limit"
import {
  getExternalApiErrorMessage,
  recordExternalApiCall,
} from "@/lib/ai/external-api-telemetry"
import { generateOpenAIObject } from "@/lib/ai/gateway"
import { inboxSenderRelevanceSchema } from "@/lib/ai/schemas/onboarding"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const SCAN_WINDOW_DAYS = 14

function estimateFrequency(emailCount: number, windowDays: number): string {
  const perWeek = (emailCount / windowDays) * 7
  if (perWeek >= 5) return "daily"
  if (perWeek >= 1) return "weekly"
  return "occasional"
}

export async function POST() {
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (!user) {
    console.error("Auth error:", userError)
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    // 1. Get Google OAuth connection
    const { data: acct, error: acctErr } = await supabaseServiceRole
      .from("connected_accounts")
      .select("id, provider, refresh_token, refresh_token_ciphertext, account_email")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .limit(1)
      .single()

    if (acctErr || !acct) {
      return NextResponse.json({
        ok: false, error: "No connected Google account",
        details: acctErr?.message || "Please connect your Google account first"
      }, { status: 400 })
    }

    // 2. Decrypt refresh token and exchange for access token
    const enc = acct.refresh_token_ciphertext ?? acct.refresh_token
    if (!enc) {
      return NextResponse.json({
        ok: false, error: "Missing refresh token",
        details: "OAuth token not found. Please reconnect your Google account."
      }, { status: 400 })
    }

    let refreshToken: string
    try {
      refreshToken = decrypt(enc)
    } catch (decryptErr: any) {
      console.error("Failed to decrypt refresh token:", decryptErr)
      return NextResponse.json({
        ok: false, error: "Failed to decrypt OAuth token",
        details: decryptErr?.message || "Please reconnect your Google account"
      }, { status: 401 })
    }

    let tokenResp: Response
    const tokenStartedAt = Date.now()
    try {
      tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      })
    } catch (e: any) {
      await recordExternalApiCall({
        userId: user.id,
        callSiteName: "onboard.scan_inbox.google_oauth_token",
        filePath: "app/api/onboard/scan-inbox/route.ts",
        functionName: "POST",
        provider: "google_oauth",
        endpoint: "token",
        requestUnits: 1,
        latencyMs: Date.now() - tokenStartedAt,
        success: false,
        statusCode: null,
        errorMessage: getExternalApiErrorMessage(e),
        metadata: { grant_type: "refresh_token" }
      })
      throw e
    }

    if (!tokenResp.ok) {
      const tokenErr = await tokenResp.text()
      await recordExternalApiCall({
        userId: user.id,
        callSiteName: "onboard.scan_inbox.google_oauth_token",
        filePath: "app/api/onboard/scan-inbox/route.ts",
        functionName: "POST",
        provider: "google_oauth",
        endpoint: "token",
        requestUnits: 1,
        latencyMs: Date.now() - tokenStartedAt,
        success: false,
        statusCode: tokenResp.status,
        errorMessage: tokenErr.slice(0, 500),
        metadata: { grant_type: "refresh_token" }
      })
      console.error("Token exchange failed:", tokenErr)
      return NextResponse.json({
        ok: false, error: "Failed to exchange refresh token",
        auth_error: tokenErr.includes("invalid_grant") ? "invalid_grant" : undefined,
        details: "Please reconnect your Google account."
      }, { status: 401 })
    }

    const { access_token: accessToken } = await tokenResp.json()
    await recordExternalApiCall({
      userId: user.id,
      callSiteName: "onboard.scan_inbox.google_oauth_token",
      filePath: "app/api/onboard/scan-inbox/route.ts",
      functionName: "POST",
      provider: "google_oauth",
      endpoint: "token",
      requestUnits: 1,
      latencyMs: Date.now() - tokenStartedAt,
      success: true,
      statusCode: tokenResp.status,
      metadata: { grant_type: "refresh_token" }
    })

    // 3. List messages from primary, last 14 days
    const query = encodeURIComponent(`category:primary newer_than:${SCAN_WINDOW_DAYS}d`)
    const allMessages: Array<{ id: string }> = []
    let pageToken: string | undefined

    while (true) {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=500${
        pageToken ? `&pageToken=${pageToken}` : ""
      }`
      const listStartedAt = Date.now()
      const hadPageToken = Boolean(pageToken)
      let resp: Response
      try {
        resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      } catch (e: any) {
        await recordExternalApiCall({
          userId: user.id,
          callSiteName: "onboard.scan_inbox.gmail_messages_list",
          filePath: "app/api/onboard/scan-inbox/route.ts",
          functionName: "POST",
          provider: "gmail",
          endpoint: "messages.list",
          requestUnits: 5,
          latencyMs: Date.now() - listStartedAt,
          success: false,
          statusCode: null,
          errorMessage: getExternalApiErrorMessage(e),
          metadata: {
            scan_window_days: SCAN_WINDOW_DAYS,
            max_results: 500,
            had_page_token: hadPageToken
          }
        })
        throw e
      }

      if (!resp.ok) {
        const errText = await resp.text()
        await recordExternalApiCall({
          userId: user.id,
          callSiteName: "onboard.scan_inbox.gmail_messages_list",
          filePath: "app/api/onboard/scan-inbox/route.ts",
          functionName: "POST",
          provider: "gmail",
          endpoint: "messages.list",
          requestUnits: 5,
          latencyMs: Date.now() - listStartedAt,
          success: false,
          statusCode: resp.status,
          errorMessage: errText.slice(0, 500),
          metadata: {
            scan_window_days: SCAN_WINDOW_DAYS,
            max_results: 500,
            had_page_token: hadPageToken
          }
        })
        console.error("Gmail list error:", errText)
        if (resp.status === 401) {
          return NextResponse.json({
            ok: false, auth_error: "invalid_grant",
            error: "OAuth token expired. Please reconnect."
          }, { status: 401 })
        }
        break
      }

      const data = await resp.json()
      const messages = data.messages || []
      await recordExternalApiCall({
        userId: user.id,
        callSiteName: "onboard.scan_inbox.gmail_messages_list",
        filePath: "app/api/onboard/scan-inbox/route.ts",
        functionName: "POST",
        provider: "gmail",
        endpoint: "messages.list",
        requestUnits: 5,
        latencyMs: Date.now() - listStartedAt,
        success: true,
        statusCode: resp.status,
        metadata: {
          scan_window_days: SCAN_WINDOW_DAYS,
          max_results: 500,
          had_page_token: hadPageToken,
          messages_returned: messages.length,
          has_next_page: Boolean(data.nextPageToken)
        }
      })
      if (messages.length === 0) break
      allMessages.push(...messages)
      pageToken = data.nextPageToken
      if (!pageToken) break
    }

    if (allMessages.length === 0) {
      return NextResponse.json({
        ok: true, senders_found: 0, relevant_senders: 0,
        scan_window_days: SCAN_WINDOW_DAYS,
        scan_summary: { total_senders: 0, relevant_senders: [], content_types_found: [], gaps: [] },
        message: "No emails found in primary inbox."
      })
    }

    // 4. Fetch metadata in parallel (From + Subject only)
    const metadataLimit = pLimit(30)
    const senderMap = new Map<string, { count: number; subjects: string[]; fromName: string | null; fromEmail: string | null }>()

    const results = await Promise.all(
      allMessages.map((msg) =>
        metadataLimit(async () => {
          const metadataStartedAt = Date.now()
          let metaStatus: number | null = null
          try {
            const metaResp = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            )
            metaStatus = metaResp.status
            if (!metaResp.ok) {
              const errText = await metaResp.text().catch(() => "")
              await recordExternalApiCall({
                userId: user.id,
                callSiteName: "onboard.scan_inbox.gmail_messages_get_metadata",
                filePath: "app/api/onboard/scan-inbox/route.ts",
                functionName: "POST",
                provider: "gmail",
                endpoint: "messages.get.metadata",
                requestUnits: 1,
                latencyMs: Date.now() - metadataStartedAt,
                success: false,
                statusCode: metaStatus,
                errorMessage: errText.slice(0, 500),
                metadata: {
                  scan_window_days: SCAN_WINDOW_DAYS
                }
              })
              return null
            }
            const data = await metaResp.json()
            await recordExternalApiCall({
              userId: user.id,
              callSiteName: "onboard.scan_inbox.gmail_messages_get_metadata",
              filePath: "app/api/onboard/scan-inbox/route.ts",
              functionName: "POST",
              provider: "gmail",
              endpoint: "messages.get.metadata",
              requestUnits: 1,
              latencyMs: Date.now() - metadataStartedAt,
              success: true,
              statusCode: metaStatus,
              metadata: {
                scan_window_days: SCAN_WINDOW_DAYS
              }
            })
            return data
          } catch (e: any) {
            await recordExternalApiCall({
              userId: user.id,
              callSiteName: "onboard.scan_inbox.gmail_messages_get_metadata",
              filePath: "app/api/onboard/scan-inbox/route.ts",
              functionName: "POST",
              provider: "gmail",
              endpoint: "messages.get.metadata",
              requestUnits: 1,
              latencyMs: Date.now() - metadataStartedAt,
              success: false,
              statusCode: metaStatus,
              errorMessage: getExternalApiErrorMessage(e),
              metadata: {
                scan_window_days: SCAN_WINDOW_DAYS
              }
            })
            return null
          }
        })
      )
    )

    for (const result of results) {
      if (!result?.payload?.headers) continue
      const headers = result.payload.headers as Array<{ name: string; value: string }>
      const fromHeader = headers.find((h) => h.name.toLowerCase() === "from")?.value || ""
      const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || ""

      const emailMatch = fromHeader.match(/<(.+?)>/)
      const senderEmail = emailMatch
        ? emailMatch[1].toLowerCase()
        : fromHeader.includes("@") ? fromHeader.trim().toLowerCase() : ""
      if (!senderEmail) continue

      const fromName = fromHeader.replace(/<.+?>/, "").trim() || null
      const existing = senderMap.get(senderEmail) || { count: 0, subjects: [], fromName: null, fromEmail: null }
      existing.count++
      if (existing.subjects.length < 5) existing.subjects.push(subject)
      if (!existing.fromName && fromName) existing.fromName = fromName
      if (!existing.fromEmail) existing.fromEmail = senderEmail
      senderMap.set(senderEmail, existing)
    }

    if (senderMap.size === 0) {
      return NextResponse.json({
        ok: true, senders_found: 0, relevant_senders: 0,
        scan_window_days: SCAN_WINDOW_DAYS,
        scan_summary: { total_senders: 0, relevant_senders: [], content_types_found: [], gaps: [] },
        message: "Could not extract sender info."
      })
    }

    // 5. Layer 1: Cadence filter (skip senders with < 2 emails)
    // 5. Layer 2: Hard rules filter (transactional/promotional keywords)
    const candidates: Array<{ address: string; fromName: string | null; count: number; subjects: string[] }> = []
    let filteredOut = 0

    for (const [address, data] of senderMap.entries()) {
      if (data.count < 2) { filteredOut++; continue }
      if (data.subjects.length === 0) { filteredOut++; continue }
      if (shouldSkipLLM(data.subjects)) { filteredOut++; continue }
      candidates.push({ address, fromName: data.fromName, count: data.count, subjects: data.subjects })
    }

    // 6. Layer 3: LLM relevance scoring against user interests
    const { data: profile } = await supabaseServiceRole
      .from("user_profiles")
      .select("professional_context, stay_on_top_of, recommended_config")
      .eq("user_id", user.id)
      .maybeSingle()

    const professionalContext = profile?.professional_context || "Not specified"
    const stayOnTopOf = Array.isArray(profile?.stay_on_top_of)
      ? profile.stay_on_top_of.join(", ")
      : "Not specified"

    const rawIntent = profile?.recommended_config?.raw_intent
    const wantedEmailTypes = rawIntent?.inbox_preferences?.email_types_wanted || []
    const inboxNotes = rawIntent?.inbox_preferences?.notes || ""

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "OpenAI API key not configured" }, { status: 500 })
    }

    const senderEntries = candidates.map((c) => ({
      address: c.address,
      from_name: c.fromName,
      email_count: c.count,
      sample_subjects: c.subjects,
    }))

    const classificationPrompt = `You are scoring email senders for relevance to a specific user.

This user said they want to stay on top of: ${stayOnTopOf}
Their professional context: ${professionalContext}
They specifically asked for these kinds of emails: ${wantedEmailTypes.join(", ") || "not specified"}
${inboxNotes ? `Additional notes: ${inboxNotes}` : ""}

For each sender below, determine:
1. How relevant are their emails to what this user explicitly said they care about? Score 0.0 to 1.0.
2. What type of content does this sender deliver? (e.g., "market news", "job alerts", "industry analysis", "promotional", "personal", "social media notifications")
3. One sentence explaining why this sender is or isn't relevant to this user's stated interests.

A sender is relevant if their content helps this user stay informed on their stated interests — regardless of whether it's a traditional "newsletter" or not. Job alerts, platform notifications, and recurring updates count if they match what the user wants.

Senders:
${JSON.stringify(senderEntries, null, 2)}

Return ONLY valid JSON:
{
  "senders": [
    {
      "address": "sender@example.com",
      "content_type": "string",
      "relevance_score": 0.0,
      "relevance_reason": "string"
    }
  ]
}`

    const parsed = await generateOpenAIObject({
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "You score email senders for relevance. Return strict JSON only." },
        { role: "user", content: classificationPrompt },
      ],
      schema: inboxSenderRelevanceSchema,
      outputShapeName: "InboxSenderRelevance",
      telemetry: {
        userId: user.id,
        callSiteName: "onboard.scan_inbox.sender_relevance",
        filePath: "app/api/onboard/scan-inbox/route.ts",
        functionName: "POST",
        metadata: {
          candidate_count: senderEntries.length,
          scan_window_days: SCAN_WINDOW_DAYS
        }
      }
    })

    const classified = parsed.senders

    // 7. Upsert into inbox_analysis
    const upserts = classified.map((sender) => {
      const senderData = senderMap.get(sender.address)
      const score = Math.min(1, Math.max(0, sender.relevance_score ?? 0))
      return {
        user_id: user.id,
        sender_address: sender.address,
        sender_name: senderData?.fromName || null,
        sender_domain: sender.address.split("@")[1] || null,
        email_count: senderData?.count || 0,
        sample_subjects: senderData?.subjects || [],
        is_newsletter: score >= 0.3,
        category: sender.content_type || "other",
        estimated_frequency: estimateFrequency(senderData?.count || 0, SCAN_WINDOW_DAYS),
        relevance_score: score,
        relevance_reason: sender.relevance_reason || null,
        disposition: "unset",
      }
    })

    if (upserts.length > 0) {
      const { error: upsertErr } = await supabaseServiceRole
        .from("inbox_analysis")
        .upsert(upserts, { onConflict: "user_id,sender_address" })

      if (upsertErr) {
        console.error("Upsert error:", upsertErr)
        return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 })
      }
    }

    // 8. Build scan_summary for conversation injection
    const relevantSenders = classified
      .filter((s) => (s.relevance_score ?? 0) >= 0.3)
      .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))

    const contentTypes = [...new Set(classified.map((s) => s.content_type).filter(Boolean))]

    const gaps: string[] = []
    for (const wanted of wantedEmailTypes) {
      const wantedLower = String(wanted).toLowerCase()
      const found = relevantSenders.some((s) =>
        (s.content_type || "").toLowerCase().includes(wantedLower) ||
        wantedLower.includes((s.content_type || "").toLowerCase())
      )
      if (!found) {
        gaps.push(`User asked for "${wanted}" — no matching senders found`)
      }
    }

    const scanSummary = {
      total_senders: senderMap.size,
      candidates_after_filtering: candidates.length,
      filtered_out: filteredOut,
      relevant_senders: relevantSenders.map((s) => {
        const data = senderMap.get(s.address)
        return {
          name: data?.fromName || s.address,
          address: s.address,
          content_type: s.content_type,
          relevance_score: s.relevance_score,
          email_count: data?.count || 0,
        }
      }),
      content_types_found: contentTypes,
      gaps,
    }

    return NextResponse.json({
      ok: true,
      senders_found: senderMap.size,
      relevant_senders: relevantSenders.length,
      scan_window_days: SCAN_WINDOW_DAYS,
      scan_summary: scanSummary,
    })
  } catch (e: any) {
    console.error("Error scanning inbox:", e)
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 })
  }
}
