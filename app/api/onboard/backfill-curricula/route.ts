import { NextResponse } from "next/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { generateCurriculumPlan } from "@/lib/onboard/generate-curriculum"

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: Request) {
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const { data: topics, error } = await supabaseServiceRole
      .from("user_lesson_topics")
      .select("id, user_id, topic_text, topic_raw_text, curriculum_goal, starting_level, topic_mapping_json, active")
      .eq("active", true)

    if (error) throw new Error(error.message)
    if (!topics || topics.length === 0) {
      return NextResponse.json({ ok: true, message: "No active lesson topics found", backfilled: 0 })
    }

    const results: Array<Record<string, any>> = []

    for (const topic of topics) {
      const mapping = (topic.topic_mapping_json || {}) as Record<string, any>

      if (mapping.curriculum_plan && Array.isArray(mapping.curriculum_plan.days) && mapping.curriculum_plan.days.length > 0) {
        results.push({ topic_id: topic.id, user_id: topic.user_id, skipped: true, reason: "already_has_curriculum" })
        continue
      }

      try {
        const plan = await generateCurriculumPlan({
          topic: topic.topic_text || topic.topic_raw_text || "General topic",
          startingLevel: topic.starting_level || mapping.starting_level || "beginner",
          curriculumGoal: topic.curriculum_goal || mapping.scope_summary || null,
          scopeSummary: mapping.scope_summary || null,
        })

        const updatedMapping = {
          ...mapping,
          curriculum_plan: plan,
          lesson_state: mapping.lesson_state || {
            status: "active",
            next_day: 1,
            last_generated_date: null,
            paused_at: null,
            completed_at: null,
          },
        }

        const { error: updateErr } = await supabaseServiceRole
          .from("user_lesson_topics")
          .update({ topic_mapping_json: updatedMapping })
          .eq("id", topic.id)

        if (updateErr) {
          results.push({ topic_id: topic.id, user_id: topic.user_id, ok: false, error: updateErr.message })
        } else {
          results.push({
            topic_id: topic.id,
            user_id: topic.user_id,
            ok: true,
            curriculum_title: plan.curriculum_title,
            days: plan.days?.length || 0,
          })
        }
      } catch (e: any) {
        results.push({ topic_id: topic.id, user_id: topic.user_id, ok: false, error: String(e?.message || e) })
      }
    }

    const backfilled = results.filter(r => r.ok === true).length

    return NextResponse.json({ ok: true, backfilled, total_topics: topics.length, results })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
