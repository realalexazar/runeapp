import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import {
  getLessonStateFromMapping,
  getLessonTopicById,
  setLessonState,
  switchActiveLessonTopic
} from "@/lib/digest/content-modules"

export async function GET(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const url = new URL(req.url)
    const topicId = url.searchParams.get("topic_id")
    if (!topicId) {
      return NextResponse.json({ ok: false, error: "topic_id is required" }, { status: 400 })
    }

    const topic = await getLessonTopicById({ userId: user.id, topicId })
    if (!topic) {
      return NextResponse.json({ ok: false, error: "Lesson topic not found" }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      topic: {
        id: topic.id,
        topic_text: topic.topic_text,
        active: topic.active,
        lesson_state: getLessonStateFromMapping(topic.topic_mapping_json || {})
      }
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: String(e?.message || e)
    }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || "")
    const topicId = String(body.topic_id || "")

    if (!action || !topicId) {
      return NextResponse.json({
        ok: false,
        error: "action and topic_id are required"
      }, { status: 400 })
    }

    const topic = await getLessonTopicById({ userId: user.id, topicId })
    if (!topic) {
      return NextResponse.json({ ok: false, error: "Lesson topic not found" }, { status: 404 })
    }

    const currentState = getLessonStateFromMapping(topic.topic_mapping_json || {})
    const now = new Date().toISOString()

    if (action === "pause") {
      const ok = await setLessonState({
        userId: user.id,
        topicId,
        state: {
          ...currentState,
          status: "paused",
          paused_at: now
        }
      })
      return NextResponse.json({ ok, action, lesson_state: { ...currentState, status: "paused", paused_at: now } }, { status: ok ? 200 : 500 })
    }

    if (action === "resume") {
      const ok = await setLessonState({
        userId: user.id,
        topicId,
        state: {
          ...currentState,
          status: "active",
          paused_at: null
        }
      })
      return NextResponse.json({ ok, action, lesson_state: { ...currentState, status: "active", paused_at: null } }, { status: ok ? 200 : 500 })
    }

    if (action === "done") {
      const ok = await setLessonState({
        userId: user.id,
        topicId,
        state: {
          ...currentState,
          status: "completed",
          completed_at: now
        },
        active: false
      })
      return NextResponse.json({ ok, action, lesson_state: { ...currentState, status: "completed", completed_at: now } }, { status: ok ? 200 : 500 })
    }

    if (action === "switch_topic") {
      const toTopicId = String(body.to_topic_id || "")
      if (!toTopicId) {
        return NextResponse.json({ ok: false, error: "to_topic_id is required for switch_topic" }, { status: 400 })
      }
      const ok = await switchActiveLessonTopic({
        userId: user.id,
        fromTopicId: topicId,
        toTopicId
      })
      return NextResponse.json({ ok, action }, { status: ok ? 200 : 500 })
    }

    return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: String(e?.message || e)
    }, { status: 500 })
  }
}

