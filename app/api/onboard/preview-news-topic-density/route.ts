import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { previewNewsTopicSignal } from "@/lib/digest/generator"

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const topicText = typeof body.news_topic === "string" ? body.news_topic.trim() : ""
    const scopeSummary = typeof body.news_scope === "string" ? body.news_scope.trim() : ""

    if (!topicText) {
      return NextResponse.json({ ok: false, error: "news_topic is required" }, { status: 400 })
    }

    const preview = await previewNewsTopicSignal({
      topicText,
      scopeSummary: scopeSummary || topicText
    })

    return NextResponse.json({
      ok: true,
      preview
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: String(e?.message || e)
    }, { status: 500 })
  }
}

