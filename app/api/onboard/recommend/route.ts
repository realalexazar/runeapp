import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { buildOnboardingSnapshot, persistRecommendationVersion } from "@/lib/onboard/state"

/**
 * POST /api/onboard/recommend
 *
 * Thin handler: receives recommendation JSON extracted from Claude's response,
 * enriches email slots with full sender data from inbox_analysis, stores config.
 */
export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (!user) {
    console.error("Auth error:", userError)
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const recommendation = body.recommendation

    if (!recommendation || !Array.isArray(recommendation.slot_allocation)) {
      return NextResponse.json({
        ok: false,
        error: "Invalid recommendation: missing slot_allocation"
      }, { status: 400 })
    }

    const emailSlots = recommendation.slot_allocation.filter((s: any) => s.type === "email")

    if (emailSlots.length > 0) {
      const allPrioritySenders = emailSlots.flatMap((s: any) => s.priority_senders || [])

      if (allPrioritySenders.length > 0) {
        const { data: senderDetails } = await supabaseServiceRole
          .from("inbox_analysis")
          .select("sender_address, sender_name, category, relevance_score, relevance_reason, email_count, estimated_frequency, sample_subjects")
          .eq("user_id", user.id)
          .in("sender_address", allPrioritySenders)

        if (senderDetails) {
          const detailMap = new Map(senderDetails.map((s) => [s.sender_address, s]))

          for (const slot of recommendation.slot_allocation) {
            if (slot.type !== "email" || !slot.priority_senders) continue
            slot.sender_details = slot.priority_senders.map((addr: string) => {
              const detail = detailMap.get(addr)
              return detail || { sender_address: addr, sender_name: addr }
            })
          }
        }
      }
    }

    const assembledConfig = {
      slot_allocation: recommendation.slot_allocation,
      allocation_notes: recommendation.allocation_notes || null,
      inbox_curation_plan: recommendation.inbox_curation_plan || null,
      user_facing_summary: recommendation.user_facing_summary || [],
      digest_preferences: {
        delivery_time: "07:00",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      },
    }

    await supabaseServiceRole
      .from("user_profiles")
      .update({
        recommended_config: assembledConfig,
        onboarding_status: "config_ready",
        onboard_chat_phase: "recommendation",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)

    await persistRecommendationVersion(user.id, assembledConfig)

    return NextResponse.json({
      ok: true,
      config: assembledConfig,
      snapshot: await buildOnboardingSnapshot(user.id),
    })
  } catch (e: any) {
    console.error("Error storing recommendation:", e)
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 })
  }
}
