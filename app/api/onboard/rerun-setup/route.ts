import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"

/**
 * POST /api/onboard/rerun-setup
 *
 * Resets setup/configuration state so user can go through onboarding again,
 * while keeping fetched email history in messages_raw.
 */
export async function POST() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const now = new Date().toISOString()
    const { error: profileResetErr } = await supabaseServiceRole
      .from("user_profiles")
      .update({
        onboard_chat_phase: "conversation",
        onboarding_status: "conversation_done",
        approved_config: null,
        recommended_config: null,
        onboarding_completed_at: null,
        updated_at: now,
      })
      .eq("user_id", user.id)
    if (profileResetErr) throw profileResetErr

    // 1) Remove module topic selections
    const { error: newsTopicErr } = await supabaseServiceRole
      .from("user_news_topics")
      .delete()
      .eq("user_id", user.id)
    if (newsTopicErr) throw newsTopicErr

    const { error: lessonTopicErr } = await supabaseServiceRole
      .from("user_lesson_topics")
      .delete()
      .eq("user_id", user.id)
    if (lessonTopicErr) throw lessonTopicErr

    // 2) Reset newsletter selections (keeps candidates and messages)
    const { error: selectionsErr } = await supabaseServiceRole
      .from("user_newsletter_selections")
      .delete()
      .eq("user_id", user.id)
    if (selectionsErr) throw selectionsErr

    // 3) Clear staged digest items that are not attached to a sent digest
    const { error: stagedDigestItemsErr } = await supabaseServiceRole
      .from("digest_items")
      .delete()
      .eq("user_id", user.id)
      .is("digest_id", null)
    if (stagedDigestItemsErr) throw stagedDigestItemsErr

    // 4) Remove digest config so dashboard returns to onboarding flow
    const { error: digestConfigErr } = await supabaseServiceRole
      .from("digest_configs")
      .delete()
      .eq("user_id", user.id)
    if (digestConfigErr) throw digestConfigErr

    return NextResponse.json({
      ok: true,
      message: "Setup reset successfully. Email history was preserved."
    })
  } catch (e: any) {
    console.error("Error rerunning setup:", e)
    return NextResponse.json({
      ok: false,
      error: String(e.message || e)
    }, { status: 500 })
  }
}

