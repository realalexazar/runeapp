import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { shouldSkipLLM } from "@/lib/onboard/hard-rules"
import { classifyBatch, Candidate } from "@/lib/onboard/llm-batch"

/**
 * 3-Layer Classification System:
 * Layer 1: Candidate generation (domain + cadence filter)
 * Layer 2: Hard rules filter (transaction/discount keywords)
 * Layer 3: LLM classification (batch call with subject lines)
 */
export async function POST(_req: Request) {
  const startTime = Date.now()
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    // Layer 1: Candidate Generation
    // Get messages from last 14 days, grouped by sender_key
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    
    const { data: rawMessages, error: rawErr } = await supabaseServiceRole
      .from("messages_raw")
      .select("sender_key, subject, from_name, from_email, received_at")
      .eq("user_id", user.id)
      .gte("received_at", fourteenDaysAgo)
      .not("sender_key", "is", null)
      .order("received_at", { ascending: false })

    if (rawErr) {
      return NextResponse.json({ ok: false, error: rawErr.message }, { status: 500 })
    }

    if (!rawMessages || rawMessages.length === 0) {
      return NextResponse.json({ 
        ok: true, 
        senders_classified: 0, 
        positive: 0, 
        grey: 0, 
        low: 0,
        message: "No messages found in last 14 days. Run backfill first." 
      })
    }

    // Group by sender_key
    const sendersMap = new Map<string, Array<typeof rawMessages[0]>>()
    for (const msg of rawMessages) {
      const key = msg.sender_key || "unknown"
      if (key === "unknown") continue
      const arr = sendersMap.get(key) || []
      arr.push(msg)
      sendersMap.set(key, arr)
    }

    // Filter: count_14d >= 2 (cadence filter)
    const candidates: Candidate[] = []
    const hardRuleFiltered: Array<{ sender_key: string; bucket: "low"; reason: string }> = []

    for (const [senderKey, messages] of sendersMap.entries()) {
      const count_14d = messages.length
      
      // Cadence filter: skip senders with < 2 messages
      if (count_14d < 2) {
        hardRuleFiltered.push({
          sender_key: senderKey,
          bucket: "low",
          reason: "insufficient_cadence"
        })
        continue
      }

      // Extract up to 5 most recent subject lines
      const subjects = messages
        .slice(0, 5)
        .map(m => m.subject || "")
        .filter(s => s.length > 0)

      if (subjects.length === 0) {
        hardRuleFiltered.push({
          sender_key: senderKey,
          bucket: "low",
          reason: "no_subjects"
        })
        continue
      }

      // Layer 2: Hard Rules Filter
      if (shouldSkipLLM(subjects)) {
        hardRuleFiltered.push({
          sender_key: senderKey,
          bucket: "low",
          reason: "hard_rule_filter"
        })
        continue
      }

      // Get most common from_name/from_email
      const fromCounts = new Map<string, { name: string | null; email: string | null; count: number }>()
      for (const msg of messages) {
        const key = `${msg.from_email || ""}|${msg.from_name || ""}`
        const existing = fromCounts.get(key) || { name: msg.from_name, email: msg.from_email, count: 0 }
        existing.count++
        fromCounts.set(key, existing)
      }
      const mostCommon = Array.from(fromCounts.values()).sort((a, b) => b.count - a.count)[0]

      candidates.push({
        sender_key: senderKey,
        from_name: mostCommon?.name || null,
        from_email: mostCommon?.email || null,
        count_14d,
        subjects
      })
    }

    // Layer 3: Batch LLM Classification
    const llmResults = await classifyBatch(candidates, { userId: user.id })

    // Combine results
    const allResults: Array<{
      sender_key: string
      bucket: "positive" | "grey" | "low"
      sample_size: number
      low_confidence: boolean
      reason?: string
    }> = [
      ...llmResults.map(r => ({ ...r })),
      ...hardRuleFiltered.map(r => ({
        sender_key: r.sender_key,
        bucket: r.bucket as "low",
        sample_size: 0,
        low_confidence: false,
        reason: r.reason
      }))
    ]

    // Store results in digest_candidates
    const upserts = allResults.map(r => ({
      user_id: user.id,
      sender_key: r.sender_key,
      bucket: r.bucket,
      classifier_source: r.reason ? "rule" : "llm",
      sample_size: r.sample_size,
      low_confidence: r.low_confidence,
      msgs_14d: sendersMap.get(r.sender_key)?.length || 0,
      msgs_30d: sendersMap.get(r.sender_key)?.length || 0, // Keep for backward compatibility
      updated_at: new Date().toISOString()
    }))

    if (upserts.length > 0) {
      const { error: upsertErr } = await supabaseServiceRole
        .from("digest_candidates")
        .upsert(upserts, { onConflict: "user_id,sender_key" })

      if (upsertErr) {
        return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 })
      }
    }

    const elapsed = Date.now() - startTime
    const positive = allResults.filter(r => r.bucket === "positive").length
    const grey = allResults.filter(r => r.bucket === "grey").length
    const low = allResults.filter(r => r.bucket === "low").length

    return NextResponse.json({
      ok: true,
      senders_classified: allResults.length,
      positive,
      grey,
      low,
      candidates_llm: candidates.length,
      candidates_filtered: hardRuleFiltered.length,
      time_ms: elapsed
    })

  } catch (e: any) {
    console.error("Classification error:", e)
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 })
  }
}
