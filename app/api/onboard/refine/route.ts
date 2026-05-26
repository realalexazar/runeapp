import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { generateClaudeObject } from "@/lib/ai/gateway"
import { onboardingRefinementPatchSchema } from "@/lib/ai/schemas/onboarding"
import {
  appendOnboardingMessage,
  applyRecommendationPatchOperations,
  buildOnboardingSnapshot,
  makeMutationResponse,
  recordOnboardingEvent,
  transitionOnboardingState,
  type OnboardingState,
} from "@/lib/onboard/state"

const REFINE_SYSTEM = `You update a user's Rune onboarding recommendation cards.

Return ONLY JSON matching this shape:
{
  "summary": "short user-facing sentence about what changed",
  "operations": [
    { "op": "update_card", "card_id": "existing card id", "fields": { "field": "value" } }
  ],
  "clarifying_question": null
}

Rules:
- Only use update_card operations.
- Never invent card ids.
- Only change fields that already make sense for the target card.
- For news cards, editable fields are focus, scope_summary, tracked_entities, preferred_sources, blocked_sources, avoid_terms.
- For lesson cards, editable fields are topic, starting_level, curriculum_goal, depth, scope_summary.
- For inbox cards, editable fields are preference_status, selected_senders, blocked_senders, content_types.
- For delivery cards, editable fields are send_time, timezone, length, style.
- If the instruction is ambiguous or would remove the user's last clear focus, return a clarifying_question and no operations.
- Keep hidden retrieval fields unchanged unless the user directly asks for a different focus.`

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
    const instruction = String(body.instruction || body.message || "").trim()
    if (!instruction) {
      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: "instruction_required",
        retryable: true,
        message: "Tell me what to change about the Rune.",
      }), { status: 400 })
    }

    const recommendation = before.recommendation
    if (!recommendation || recommendation.cards.length === 0) {
      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: "recommendation_missing",
        retryable: true,
        message: "Build the Rune recommendation before refining it.",
      }), { status: 400 })
    }

    const clientVersion = Number(body.current_config_version || 0)
    if (clientVersion && clientVersion !== recommendation.config_version) {
      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: "stale_recommendation",
        retryable: true,
        message: "I refreshed the latest version. Try that change again.",
      }), { status: 409 })
    }

    if (body.recommendation_version_id && body.recommendation_version_id !== recommendation.version_id) {
      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: "stale_recommendation",
        retryable: true,
        message: "I refreshed the latest version. Try that change again.",
      }), { status: 409 })
    }

    await appendOnboardingMessage(user.id, "user", instruction, { message_type: "refinement_instruction" })
    await transitionOnboardingState(user.id, "refining", "refinement_started", {
      recommendation_version_id: recommendation.version_id,
      config_version: recommendation.config_version,
    })

    const patch = await generateClaudeObject({
      system: REFINE_SYSTEM,
      messages: [{
        role: "user",
        content: JSON.stringify({
          instruction,
          recommendation_version_id: recommendation.version_id,
          config_version: recommendation.config_version,
          cards: recommendation.cards,
        }),
      }],
      temperature: 0.2,
      maxTokens: 1200,
      schema: onboardingRefinementPatchSchema,
      outputShapeName: "OnboardingRefinementPatch",
      telemetry: {
        userId: user.id,
        callSiteName: "onboard.refinement.patch",
        filePath: "app/api/onboard/refine/route.ts",
        functionName: "POST",
        metadata: {
          card_count: recommendation.cards.length,
          target_card_id: body.target_card_id || null,
        },
      },
    })

    if (patch.clarifying_question && patch.operations.length === 0) {
      await appendOnboardingMessage(user.id, "rune", patch.clarifying_question, {
        message_type: "refinement_clarifying_question",
      })
      await transitionOnboardingState(user.id, "recommendation_ready", "refinement_failed", {
        reason: "clarifying_question",
      })
      await recordOnboardingEvent(user.id, "refinement_failed", {
        error_code: "clarifying_question",
        retryable: true,
      })

      return NextResponse.json({
        ...(await makeMutationResponse(user.id, previousState)),
        rune_message: patch.clarifying_question,
        patch_summary: patch.summary,
      })
    }

    const result = await applyRecommendationPatchOperations(user.id, patch.operations, patch.summary)
    if (!result.ok) {
      await appendOnboardingMessage(user.id, "rune", result.message, {
        message_type: "refinement_failed",
      })
      await transitionOnboardingState(user.id, "recommendation_ready", "refinement_failed", {
        error_code: result.code,
      })
      await recordOnboardingEvent(user.id, "refinement_failed", {
        error_code: result.code,
        retryable: true,
      })

      return NextResponse.json(await makeMutationResponse(user.id, previousState, {
        code: result.code,
        retryable: true,
        message: result.message,
      }), { status: 400 })
    }

    const runeMessage = patch.summary || "Updated. I tightened the Rune plan."
    await appendOnboardingMessage(user.id, "rune", runeMessage, {
      message_type: "refinement_applied",
      applied_count: result.applied_count,
    })

    return NextResponse.json({
      ...(await makeMutationResponse(user.id, previousState)),
      rune_message: runeMessage,
      patch_summary: patch.summary,
      applied_count: result.applied_count,
    })
  } catch (e: any) {
    console.error("Onboarding refinement error:", e)
    await transitionOnboardingState(user.id, "recommendation_ready", "refinement_failed", {
      error_code: "refinement_exception",
      message: String(e?.message || e),
    }).catch(() => undefined)
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    )
  }
}
