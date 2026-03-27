import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"

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

    // 1. Store approved config + mark complete
    const { error: profileErr } = await supabaseServiceRole
      .from("user_profiles")
      .update({
        approved_config: config,
        onboarding_status: "complete",
        onboarding_completed_at: now,
        updated_at: now,
      })
      .eq("user_id", user.id)

    if (profileErr) {
      console.error("Failed to update user_profiles:", profileErr)
      return NextResponse.json({ ok: false, error: profileErr.message }, { status: 500 })
    }

    // 2. Upsert digest_configs
    const preferences = config.digest_preferences || {}
    const { error: digestErr } = await supabaseServiceRole
      .from("digest_configs")
      .upsert({
        user_id: user.id,
        cadence: "daily",
        send_time: [preferences.delivery_time || "07:00"],
        timezone: preferences.timezone || "America/New_York",
        style: "morning-brief",
        rune_name: null,
        module_flags: {
          enable_newsletter_digest: emailSlots.length > 0,
          enable_daily_news_topics: newsSlots.length > 0,
          enable_daily_lessons: lessonSlots.length > 0,
        },
        updated_at: now,
      }, { onConflict: "user_id", ignoreDuplicates: false })

    if (digestErr) {
      console.error("Failed to upsert digest_configs:", digestErr)
      return NextResponse.json({ ok: false, error: digestErr.message }, { status: 500 })
    }

    // 3. News topics — one record per news slot
    if (newsSlots.length > 0) {
      await supabaseServiceRole
        .from("user_news_topics")
        .update({ active: false, updated_at: now })
        .eq("user_id", user.id)
        .eq("active", true)

      for (const slot of newsSlots) {
        const { data: newsTopic, error: newsErr } = await supabaseServiceRole
          .from("user_news_topics")
          .insert({
            user_id: user.id,
            topic_text: slot.focus,
            topic_raw_text: slot.focus,
            timeframe: "24h",
            topic_mapping_json: {
              normalized_topic: slot.focus,
              scope_summary: slot.scope_summary || slot.focus,
              retrieval_queries: slot.retrieval_queries || [slot.focus],
              required_terms: slot.required_terms || [],
              retrieval_hint: slot.focus,
            },
            active: true,
          })
          .select("id")
          .single()

        if (newsErr) {
          console.error(`Failed to insert news topic "${slot.focus}":`, newsErr)
        } else if (newsTopic) {
          createdIds[`news_topic_slot_${slot.slot}`] = newsTopic.id
        }
      }
    }

    // 4. Lesson topics — one record per lesson slot
    if (lessonSlots.length > 0) {
      await supabaseServiceRole
        .from("user_lesson_topics")
        .update({ active: false, updated_at: now })
        .eq("user_id", user.id)
        .eq("active", true)

      for (const slot of lessonSlots) {
        const { data: lessonTopic, error: lessonErr } = await supabaseServiceRole
          .from("user_lesson_topics")
          .insert({
            user_id: user.id,
            topic_text: slot.focus,
            topic_raw_text: slot.focus,
            curriculum_goal: slot.curriculum_goal || null,
            starting_level: slot.starting_level || "beginner",
            topic_mapping_json: {
              normalized_topic: slot.focus,
              scope_summary: slot.curriculum_goal || slot.focus,
              starting_level: slot.starting_level || "beginner",
            },
            active: true,
          })
          .select("id")
          .single()

        if (lessonErr) {
          console.error(`Failed to insert lesson topic "${slot.focus}":`, lessonErr)
        } else if (lessonTopic) {
          createdIds[`lesson_topic_slot_${slot.slot}`] = lessonTopic.id
        }
      }
    }

    // 5. Email / inbox curation
    if (emailSlots.length > 0) {
      const allPrioritySenders = emailSlots.flatMap((s) => s.priority_senders || [])
      const inboxPlan = config.inbox_curation_plan || {}
      const planSenders = inboxPlan.priority_senders || []
      const combined = [...new Set([...allPrioritySenders, ...planSenders])]

      if (combined.length > 0) {
        const upserts = combined.map((sender: string) => ({
          user_id: user.id,
          sender_key: sender,
          selected: true,
          updated_at: now,
        }))

        await supabaseServiceRole
          .from("user_newsletter_selections")
          .upsert(upserts, { onConflict: "user_id,sender_key", ignoreDuplicates: false })

        await supabaseServiceRole
          .from("inbox_analysis")
          .update({ disposition: "priority" })
          .eq("user_id", user.id)
          .in("sender_address", combined)

        createdIds.newsletter_selections_count = combined.length
      }
    }

    return NextResponse.json({ ok: true, created_ids: createdIds })

  } catch (e: any) {
    console.error("Error approving onboarding config:", e)
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 })
  }
}
