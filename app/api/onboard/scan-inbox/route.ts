import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { callOpenAIChatCompletion } from "@/lib/openai/chat"
import { decrypt } from "@/lib/crypto"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const SCAN_WINDOW_DAYS = 30

/**
 * POST /api/onboard/scan-inbox
 *
 * Scans the user's Gmail inbox for newsletter-pattern emails and populates
 * the inbox_analysis table with classified sender data.
 */
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
        ok: false,
        error: "No connected Google account",
        details: acctErr?.message || "Please connect your Google account first"
      }, { status: 400 })
    }

    // 2. Decrypt refresh token and exchange for access token
    const enc = acct.refresh_token_ciphertext ?? acct.refresh_token
    if (!enc) {
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

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    })

    if (!tokenResp.ok) {
      const tokenErr = await tokenResp.text()
      console.error("Token exchange failed:", tokenErr)
      return NextResponse.json({
        ok: false,
        error: "Failed to exchange refresh token for access token",
        auth_error: tokenErr.includes("invalid_grant") ? "invalid_grant" : undefined,
        details: "Please reconnect your Google account."
      }, { status: 401 })
    }

    const { access_token: accessToken } = await tokenResp.json()

    // 3. Query Gmail API for newsletter-pattern emails (last 30 days)
    const query = encodeURIComponent(
      `category:promotions OR category:updates newer_than:${SCAN_WINDOW_DAYS}d`
    )

    const allMessages: Array<{ id: string }> = []
    let pageToken: string | undefined

    while (allMessages.length < 500) {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=500${
        pageToken ? `&pageToken=${pageToken}` : ""
      }`

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!resp.ok) {
        const errText = await resp.text()
        console.error("Gmail list error:", errText)
        if (resp.status === 401) {
          return NextResponse.json({
            ok: false,
            auth_error: "invalid_grant",
            error: "OAuth token expired. Please reconnect your Google account."
          }, { status: 401 })
        }
        break
      }

      const data = await resp.json()
      const messages = data.messages || []
      if (messages.length === 0) break

      allMessages.push(...messages)
      pageToken = data.nextPageToken
      if (!pageToken) break
    }

    if (allMessages.length === 0) {
      return NextResponse.json({
        ok: true,
        senders_found: 0,
        newsletters_identified: 0,
        scan_window_days: SCAN_WINDOW_DAYS,
        message: "No newsletter-pattern emails found in the last 30 days."
      })
    }

    // 4. Fetch metadata for each message to extract sender info
    // Process in batches to avoid rate limits
    const BATCH_SIZE = 50
    const senderMap = new Map<string, { count: number; subjects: string[]; fromName: string | null }>()

    for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
      const batch = allMessages.slice(i, i + BATCH_SIZE)

      const metadataPromises = batch.map(async (msg) => {
        try {
          const metaResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          )
          if (!metaResp.ok) return null
          return metaResp.json()
        } catch {
          return null
        }
      })

      const results = await Promise.all(metadataPromises)

      for (const result of results) {
        if (!result?.payload?.headers) continue

        const headers = result.payload.headers as Array<{ name: string; value: string }>
        const fromHeader = headers.find((h) => h.name.toLowerCase() === "from")?.value || ""
        const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || ""

        const emailMatch = fromHeader.match(/<(.+?)>/)
        const senderEmail = emailMatch
          ? emailMatch[1].toLowerCase()
          : fromHeader.includes("@")
            ? fromHeader.trim().toLowerCase()
            : ""

        if (!senderEmail) continue

        const fromName = fromHeader.replace(/<.+?>/, "").trim() || null

        const existing = senderMap.get(senderEmail) || { count: 0, subjects: [], fromName: null }
        existing.count++
        if (existing.subjects.length < 5) {
          existing.subjects.push(subject)
        }
        if (!existing.fromName && fromName) {
          existing.fromName = fromName
        }
        senderMap.set(senderEmail, existing)
      }
    }

    if (senderMap.size === 0) {
      return NextResponse.json({
        ok: true,
        senders_found: 0,
        newsletters_identified: 0,
        scan_window_days: SCAN_WINDOW_DAYS,
        message: "Could not extract sender info from emails."
      })
    }

    // 5. Get user profile for LLM classification context
    const { data: profile } = await supabaseServiceRole
      .from("user_profiles")
      .select("professional_context, stay_on_top_of")
      .eq("user_id", user.id)
      .maybeSingle()

    const professionalContext = profile?.professional_context || "Not specified"
    const stayOnTopOf = Array.isArray(profile?.stay_on_top_of)
      ? profile.stay_on_top_of.join(", ")
      : profile?.stay_on_top_of || "Not specified"

    // Build sender list for classification
    const senderEntries = Array.from(senderMap.entries()).map(([address, data]) => ({
      address,
      from_name: data.fromName,
      email_count: data.count,
      sample_subjects: data.subjects,
    }))

    // 6. Use OpenAI to classify senders
    if (!OPENAI_API_KEY) {
      return NextResponse.json({
        ok: false,
        error: "OpenAI API key not configured"
      }, { status: 500 })
    }

    const classificationPrompt = `Given this user's professional context and stated interests:
- Context: ${professionalContext}
- Stays on top of: ${stayOnTopOf}

Categorize and score these newsletter senders:
${JSON.stringify(senderEntries, null, 2)}

For each sender, return JSON:
{
  "senders": [
    {
      "address": "sender@example.com",
      "is_newsletter": true/false,
      "category": "finance" | "tech" | "news" | "sports" | "lifestyle" | "other",
      "estimated_frequency": "daily" | "weekly" | "occasional",
      "relevance_score": 0.0-1.0,
      "relevance_reason": "one sentence"
    }
  ]
}

Return ONLY valid JSON. No markdown, no prose, no backticks.`

    const llmResp = await callOpenAIChatCompletion({
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "You classify email senders. Return strict JSON only." },
        { role: "user", content: classificationPrompt },
      ],
    })

    const llmData = await llmResp.json()
    const llmContent = llmData?.choices?.[0]?.message?.content || ""

    let classified: Array<{
      address: string
      is_newsletter: boolean
      category: string
      estimated_frequency: string
      relevance_score: number
      relevance_reason: string
    }> = []

    try {
      const parsed = extractJsonObject(llmContent)
      if (parsed?.senders && Array.isArray(parsed.senders)) {
        classified = parsed.senders
      }
    } catch {
      console.error("Failed to parse LLM classification response")
      return NextResponse.json({
        ok: false,
        error: "Failed to parse classification results"
      }, { status: 500 })
    }

    // 7. Upsert results into inbox_analysis table
    const upserts = classified.map((sender) => {
      const senderData = senderMap.get(sender.address)
      return {
        user_id: user.id,
        sender_address: sender.address,
        sender_name: senderData?.fromName || null,
        email_count: senderData?.count || 0,
        sample_subjects: senderData?.subjects || [],
        is_newsletter: sender.is_newsletter ?? false,
        category: sender.category || "other",
        estimated_frequency: sender.estimated_frequency || "occasional",
        relevance_score: Math.min(1, Math.max(0, sender.relevance_score ?? 0)),
        relevance_reason: sender.relevance_reason || null,
        scanned_at: new Date().toISOString(),
      }
    })

    if (upserts.length > 0) {
      const { error: upsertErr } = await supabaseServiceRole
        .from("inbox_analysis")
        .upsert(upserts, { onConflict: "user_id,sender_address" })

      if (upsertErr) {
        console.error("Upsert error:", upsertErr)
        return NextResponse.json({
          ok: false,
          error: upsertErr.message
        }, { status: 500 })
      }
    }

    const newslettersIdentified = classified.filter((s) => s.is_newsletter).length

    return NextResponse.json({
      ok: true,
      senders_found: senderMap.size,
      newsletters_identified: newslettersIdentified,
      scan_window_days: SCAN_WINDOW_DAYS,
    })
  } catch (e: any) {
    console.error("Error scanning inbox:", e)
    return NextResponse.json({
      ok: false,
      error: String(e.message || e)
    }, { status: 500 })
  }
}

function extractJsonObject(text: string): any | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}
