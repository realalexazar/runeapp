import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import {
  buildOnboardingSnapshot,
  evaluateMinimumIntentGate,
  inferInboxPreference,
  makeMutationResponse,
  recordOnboardingEvent,
  updateIntentState,
  type OnboardingState,
} from "@/lib/onboard/state"

export async function POST() {
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const before = await buildOnboardingSnapshot(user.id)
  const previousState = before.state as OnboardingState

  try {
    const intent = before.intent || await getLegacyIntent(user.id)
    const inboxPreference = before.inbox_preference !== "unknown"
      ? before.inbox_preference
      : inferInboxPreference(intent)
    const gate = evaluateMinimumIntentGate(intent, inboxPreference)

    await recordOnboardingEvent(user.id, "build_my_rune_clicked", {
      minimum_gate_passed: gate.passed,
      missing_fields: gate.missing_fields,
    })

    if (!gate.passed) {
      const message = buildGateMessage(gate.missing_fields)
      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: "minimum_intent_missing",
        retryable: true,
        message,
      }), { status: 400 })
    }

    if (intent) {
      await updateIntentState(user.id, intent)
    }

    return NextResponse.json(await makeMutationResponse(user.id, previousState))
  } catch (e: any) {
    console.error("Build my Rune error:", e)
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    )
  }
}

async function getLegacyIntent(userId: string): Promise<any> {
  const { data } = await supabaseServiceRole
    .from("user_profiles")
    .select("recommended_config")
    .eq("user_id", userId)
    .maybeSingle()
  return data?.recommended_config?.raw_intent || null
}

function buildGateMessage(missingFields: string[]): string {
  if (missingFields.includes("meaningful_focus")) {
    return "I need one more thing: what should I focus on each morning?"
  }
  if (missingFields.includes("inbox_preference")) {
    return "Should I inspect your inbox for newsletters and recurring updates, or skip that for now?"
  }
  if (missingFields.includes("slot_type")) {
    return "Should Rune track news, teach you something over time, curate inbox updates, or some mix of those?"
  }
  return "I need a bit more before I can build this cleanly."
}
