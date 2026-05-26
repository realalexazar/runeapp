import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import {
  buildOnboardingSnapshot,
  makeMutationResponse,
  setInboxPreference,
  type InboxPreferenceStatus,
  type OnboardingState,
} from "@/lib/onboard/state"

const VALID_PREFERENCES = new Set(["wanted", "not_wanted", "skipped"])

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const before = await buildOnboardingSnapshot(user.id)
  const previousState = before.state as OnboardingState

  try {
    const body = await req.json().catch(() => ({}))
    const preference = String(body.preference_status || body.status || "").trim() as InboxPreferenceStatus

    if (!VALID_PREFERENCES.has(preference)) {
      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: "invalid_inbox_preference",
        retryable: true,
        message: "Inbox preference must be wanted, not_wanted, or skipped.",
      }), { status: 400 })
    }

    await setInboxPreference(user.id, preference)
    return NextResponse.json(await makeMutationResponse(user.id, previousState))
  } catch (e: any) {
    console.error("Inbox preference error:", e)
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    )
  }
}
