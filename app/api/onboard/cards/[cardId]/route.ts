import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import {
  applyRecommendationCardEdit,
  buildOnboardingSnapshot,
  makeMutationResponse,
  type OnboardingState,
} from "@/lib/onboard/state"

type RouteContext = {
  params: Promise<{ cardId: string }>
}

export async function PATCH(req: Request, context: RouteContext) {
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const before = await buildOnboardingSnapshot(user.id)
  const previousState = before.state as OnboardingState

  try {
    const { cardId } = await context.params
    const body = await req.json().catch(() => ({}))
    const fields = body.fields && typeof body.fields === "object" ? body.fields : body
    const clientVersion = Number(body.current_config_version || 0)

    if (clientVersion && clientVersion !== before.recommendation?.config_version) {
      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: "stale_recommendation",
        retryable: true,
        message: "I refreshed the latest version. Try that edit again.",
      }), { status: 409 })
    }

    if (body.recommendation_version_id && body.recommendation_version_id !== before.recommendation?.version_id) {
      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: "stale_recommendation",
        retryable: true,
        message: "I refreshed the latest version. Try that edit again.",
      }), { status: 409 })
    }

    const result = await applyRecommendationCardEdit(user.id, cardId, fields)
    if (!result.ok) {
      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: result.code,
        retryable: true,
        message: result.message,
      }), { status: result.code === "card_not_found" ? 404 : 400 })
    }

    return NextResponse.json(await makeMutationResponse(user.id, previousState))
  } catch (e: any) {
    console.error("Card edit error:", e)
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    )
  }
}
