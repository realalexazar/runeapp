import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { buildOnboardingSnapshot } from "@/lib/onboard/state"

export async function GET() {
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const snapshot = await buildOnboardingSnapshot(user.id)
    return NextResponse.json({ ok: true, snapshot })
  } catch (e: any) {
    console.error("Onboarding state error:", e)
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    )
  }
}
