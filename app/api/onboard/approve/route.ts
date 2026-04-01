import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { generateCurriculumPlan } from "@/lib/onboard/generate-curriculum"

const ALLOWED_LEVELS = ["beginner", "intermediate", "advanced"] as const

function normalizeStartingLevel(raw: string): string {
  const lower = raw.toLowerCase()
  if (ALLOWED_LEVELS.includes(lower as any)) return lower
  if (lower.includes("expert") || lower.includes("advanced") || lower.includes("senior")) return "advanced"
  if (lower.includes("intermediate") || lower.includes("familiar") || lower.includes("some")) return "intermediate"
  return "beginner"
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (!user) {
    console.error("Auth error:", userError)
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { config } = body

    if (!config || !Array.isArray(config.slot_allocation)) {
      return NextResponse.json({
        ok: false,
        error: "Invalid config: missing slot_allocation array"
      }, { status: 400 })
    }

    const slots = config.slot_allocation as Array<Record<string, any>>
    const now = new Date().toISOString()
    const createdIds: Record<string, string | number> = {}

    const emailSlots = slots.filter((s) => s.type === "email")
    const newsSlots = slots.filter((s) => s.type === "news")
    const lessonSlots = slots.filter((s) => s.type === "lesson")

    const slotErrors: string[] = []
    for (const slot of newsSlots) {
      if (!Array.isArray(slot.retrieval_queries) || slot.retrieval_queries.length === 0) {
        slotErrors.push(`News slot "${slot.focus}" is missing retrieval_queries`)
      }
      if (!Array.isArray(slot.required_terms) || slot.required_terms.length === 0) {
        slotErrors.push(`News slot "${slot.focus}" is missing required_terms`)
      }
    }
    if (slotErrors.length > 0) {
      console.error("Slot validation failed:", slotErrors)
      return NextResponse.json({ ok: false, error: "Invalid news slot config", details: slotErrors }, { status: 400 })
    }

    const curriculumPlans =
      lessonSlots.length > 0
        ? await Promise.all(
            lessonSlots.map((slot) =>
              generateCurriculumPlan({
                topic: slot.focus,
                startingLevel: slot.starting_level || "beginner",
                curriculumGoal: slot.curriculum_goal || null,
                scopeSummary: slot.scope_summary || null,
              })
            )
          )
        : []

    const newsTopicsPayload = newsSlots.map((slot) => ({
      topic_text: slot.focus,
      topic_raw_text: slot.focus,
      timeframe: "24h",
      topic_mapping_json: {
        normalized_topic: slot.focus,
        scope_summary: slot.scope_summary || slot.focus,
        retrieval_queries: slot.retrieval_queries,
        required_terms: slot.required_terms,
        retrieval_hint: slot.focus,
        tracked_entities: Array.isArray(slot.tracked_entities) ? slot.tracked_entities : [],
      },
    }))

    const lessonTopicsPayload: Record<string, unknown>[] = []
    for (let i = 0; i < lessonSlots.length; i++) {
      const slot = lessonSlots[i]
      const rawLevel = slot.starting_level || "beginner"
      const normalizedLevel = normalizeStartingLevel(rawLevel)
      const curriculumGoal = slot.curriculum_goal || null
      const curriculumPlan = curriculumPlans[i]

      lessonTopicsPayload.push({
        topic_text: slot.focus,
        topic_raw_text: slot.focus,
        curriculum_goal: curriculumGoal,
        starting_level: normalizedLevel,
        topic_mapping_json: {
          normalized_topic: slot.focus,
          scope_summary: curriculumGoal || slot.focus,
          starting_level: rawLevel,
          curriculum_plan: curriculumPlan,
          lesson_state: {
            status: "active",
            next_day: 1,
            last_generated_date: null,
            paused_at: null,
            completed_at: null,
          },
        },
      })
    }

    const preferences = config.digest_preferences || {}
    const digestPayload = {
      cadence: "daily",
      send_time: [preferences.delivery_time || "07:00"],
      timezone: preferences.timezone || "America/New_York",
      style: "morning-brief",
      module_flags: {
        enable_newsletter_digest: emailSlots.length > 0,
        enable_daily_news_topics: newsSlots.length > 0,
        enable_daily_lessons: lessonSlots.length > 0,
      },
    }

    let newsletterSenders: string[] = []
    let inboxAddresses: string[] = []
    if (emailSlots.length > 0) {
      const allPrioritySenders = emailSlots.flatMap((s) => s.priority_senders || [])
      const inboxPlan = config.inbox_curation_plan || {}
      const planSenders = inboxPlan.priority_senders || []
      const combined = [...new Set([...allPrioritySenders, ...planSenders])]
      newsletterSenders = combined
      inboxAddresses = combined
      createdIds.newsletter_selections_count = combined.length
    }

    const { data: rpcData, error: rpcError } = await supabaseServiceRole.rpc("commit_onboard_approval", {
      p_user_id: user.id,
      p_now: now,
      p_approved_config: config,
      p_digest: digestPayload,
      p_news_topics: newsTopicsPayload,
      p_lesson_topics: lessonTopicsPayload,
      p_newsletter_senders: newsletterSenders.length > 0 ? newsletterSenders : null,
      p_inbox_priority_addresses: inboxAddresses.length > 0 ? inboxAddresses : null,
    })

    if (rpcError) {
      console.error("commit_onboard_approval failed:", rpcError)
      return NextResponse.json(
        { ok: false, error: rpcError.message || "Database transaction failed" },
        { status: 500 }
      )
    }

    const result = rpcData as {
      ok?: boolean
      news_topic_ids?: string[]
      lesson_topic_ids?: string[]
      newsletter_selection_count?: number
    } | null

    const newsIds = Array.isArray(result?.news_topic_ids) ? result!.news_topic_ids : []
    const lessonIds = Array.isArray(result?.lesson_topic_ids) ? result!.lesson_topic_ids : []

    newsSlots.forEach((slot, i) => {
      if (newsIds[i]) createdIds[`news_topic_slot_${slot.slot}`] = newsIds[i] as string
    })
    lessonSlots.forEach((slot, i) => {
      if (lessonIds[i]) createdIds[`lesson_topic_slot_${slot.slot}`] = lessonIds[i] as string
    })

    if (typeof result?.newsletter_selection_count === "number") {
      createdIds.newsletter_selections_count = result.newsletter_selection_count
    }

    return NextResponse.json({ ok: true, created_ids: createdIds })
  } catch (e: any) {
    console.error("Error approving onboarding config:", e)
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 })
  }
}
