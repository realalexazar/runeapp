import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"

/**
 * POST /api/onboard/approve
 *
 * Finalizes onboarding by persisting the user's approved configuration
 * into all necessary database records (digest_configs, news/lesson topics,
 * newsletter selections, inbox_analysis dispositions).
 */
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

    if (!config || !config.modules || !config.digest_preferences) {
      return NextResponse.json({
        ok: false,
        error: "Invalid request body. Expected 'config' with 'modules' and 'digest_preferences'."
      }, { status: 400 })
    }

    const { modules, digest_preferences } = config
    const now = new Date().toISOString()
    const createdIds: Record<string, string> = {}

    // 1. Store approved_config and mark onboarding complete
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
    const moduleFlags = {
      enable_newsletter_digest: !!modules.newsletters?.enabled,
      enable_daily_news_topics: !!modules.news?.enabled,
      enable_daily_lessons: !!modules.lessons?.enabled,
    }

    const { data: digestConfig, error: digestErr } = await supabaseServiceRole
      .from("digest_configs")
      .upsert({
        user_id: user.id,
        cadence: "daily",
        send_time: digest_preferences.delivery_time,
        timezone: digest_preferences.timezone,
        style: "morning-brief",
        rune_name: null,
        module_flags: moduleFlags,
        updated_at: now,
      }, {
        onConflict: "user_id",
        ignoreDuplicates: false,
      })
      .select("id")
      .single()

    if (digestErr) {
      console.error("Failed to upsert digest_configs:", digestErr)
      return NextResponse.json({ ok: false, error: digestErr.message }, { status: 500 })
    }
    createdIds.digest_config_id = digestConfig.id

    // 3. News module
    if (modules.news?.enabled) {
      const { error: deactivateNewsErr } = await supabaseServiceRole
        .from("user_news_topics")
        .update({ active: false, updated_at: now })
        .eq("user_id", user.id)
        .eq("active", true)

      if (deactivateNewsErr) {
        console.error("Failed to deactivate existing news topics:", deactivateNewsErr)
        return NextResponse.json({ ok: false, error: deactivateNewsErr.message }, { status: 500 })
      }

      const { data: newsTopic, error: newsInsertErr } = await supabaseServiceRole
        .from("user_news_topics")
        .insert({
          user_id: user.id,
          topic_text: modules.news.topic_text,
          topic_raw_text: modules.news.topic_text,
          timeframe: "24h",
          topic_mapping_json: modules.news.topic_mapping,
          active: true,
        })
        .select("id")
        .single()

      if (newsInsertErr) {
        console.error("Failed to insert news topic:", newsInsertErr)
        return NextResponse.json({ ok: false, error: newsInsertErr.message }, { status: 500 })
      }
      createdIds.news_topic_id = newsTopic.id
    }

    // 4. Lessons module
    if (modules.lessons?.enabled) {
      const { error: deactivateLessonsErr } = await supabaseServiceRole
        .from("user_lesson_topics")
        .update({ active: false, updated_at: now })
        .eq("user_id", user.id)
        .eq("active", true)

      if (deactivateLessonsErr) {
        console.error("Failed to deactivate existing lesson topics:", deactivateLessonsErr)
        return NextResponse.json({ ok: false, error: deactivateLessonsErr.message }, { status: 500 })
      }

      const { data: lessonTopic, error: lessonInsertErr } = await supabaseServiceRole
        .from("user_lesson_topics")
        .insert({
          user_id: user.id,
          topic_text: modules.lessons.topic_text,
          topic_raw_text: modules.lessons.topic_text,
          curriculum_goal: modules.lessons.topic_mapping?.curriculum_plan?.completion_signal ?? null,
          starting_level: "beginner",
          topic_mapping_json: modules.lessons.topic_mapping,
          active: true,
        })
        .select("id")
        .single()

      if (lessonInsertErr) {
        console.error("Failed to insert lesson topic:", lessonInsertErr)
        return NextResponse.json({ ok: false, error: lessonInsertErr.message }, { status: 500 })
      }
      createdIds.lesson_topic_id = lessonTopic.id
    }

    // 5. Newsletters module
    if (modules.newsletters?.enabled) {
      const prioritySenders: string[] = modules.newsletters.priority_senders || []
      const deprioritizedSenders: string[] = modules.newsletters.deprioritized_senders || []

      if (prioritySenders.length > 0) {
        const upserts = prioritySenders.map((sender: string) => ({
          user_id: user.id,
          sender_key: sender,
          selected: true,
          updated_at: now,
        }))

        const { error: selErr } = await supabaseServiceRole
          .from("user_newsletter_selections")
          .upsert(upserts, {
            onConflict: "user_id,sender_key",
            ignoreDuplicates: false,
          })

        if (selErr) {
          console.error("Failed to upsert newsletter selections:", selErr)
          return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })
        }

        const { error: priorityErr } = await supabaseServiceRole
          .from("inbox_analysis")
          .update({ disposition: "priority", updated_at: now })
          .eq("user_id", user.id)
          .in("sender_address", prioritySenders)

        if (priorityErr) {
          console.error("Failed to update inbox_analysis priority:", priorityErr)
          return NextResponse.json({ ok: false, error: priorityErr.message }, { status: 500 })
        }
      }

      if (deprioritizedSenders.length > 0) {
        const { error: excludeErr } = await supabaseServiceRole
          .from("inbox_analysis")
          .update({ disposition: "exclude", updated_at: now })
          .eq("user_id", user.id)
          .in("sender_address", deprioritizedSenders)

        if (excludeErr) {
          console.error("Failed to update inbox_analysis exclude:", excludeErr)
          return NextResponse.json({ ok: false, error: excludeErr.message }, { status: 500 })
        }
      }

      createdIds.newsletter_selections_count = String(prioritySenders.length)
    }

    return NextResponse.json({
      ok: true,
      created_ids: createdIds,
    })

  } catch (e: any) {
    console.error("Error approving onboarding config:", e)

    if (e instanceof SyntaxError || e.message?.includes("JSON")) {
      return NextResponse.json({
        ok: false,
        error: "Invalid JSON in request body."
      }, { status: 400 })
    }

    return NextResponse.json({
      ok: false,
      error: String(e.message || e)
    }, { status: 500 })
  }
}
