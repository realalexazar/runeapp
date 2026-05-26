import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { requireDevOrAdminRequest } from "@/lib/dev-route"
import { getUserModuleConfig } from "@/lib/digest/content-modules"
import { generateDailyLessons, generateDailyNewsTopics } from "@/lib/digest/generator"
import { supabaseServiceRole } from "@/lib/supabase/service"
import {
  buildUnifiedDigest,
  persistFormattedDigest,
  renderDigestHtml,
  renderDigestText
} from "@/lib/digest/formatter"
import { sendDigestEmail } from "@/lib/digest/email"

export async function POST(req: Request) {
  const gated = requireDevOrAdminRequest(req)
  if (gated) return gated

  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const generatedAt = body.generated_at ? new Date(body.generated_at) : new Date()
    const generatedDate = generatedAt.toISOString().slice(0, 10)
    const { moduleFlags } = await getUserModuleConfig(user.id)
    const shouldSend = body.send !== false
    const forceRegenerate = body.regenerate === true

    const newsletterSummaryCountResult = await supabaseServiceRole
      .from("digest_items")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("digest_id", null)
      .not("content_summary", "is", null)

    let newsItems: any[] = []
    let lessonItems: any[] = []
    const moduleErrors: Array<{ module: string; error: string }> = []

    if (moduleFlags.enable_daily_news_topics) {
      try {
        newsItems = await generateDailyNewsTopics({ userId: user.id, generatedAt, forceRegenerate })
      } catch (e: any) {
        moduleErrors.push({ module: "daily_news_topics", error: String(e?.message || e) })
      }
    }

    if (moduleFlags.enable_daily_lessons) {
      try {
        lessonItems = await generateDailyLessons({ userId: user.id, generatedAt, forceRegenerate })
      } catch (e: any) {
        moduleErrors.push({ module: "daily_lessons", error: String(e?.message || e) })
      }
    }

    const digest = await buildUnifiedDigest({
      userId: user.id,
      digestDate: generatedDate
    })
    const persisted = await persistFormattedDigest({
      userId: user.id,
      digestDate: generatedDate,
      htmlContent: renderDigestHtml(digest),
      textContent: renderDigestText(digest),
      metadata: {
        ...digest.metadata,
        sections: digest.sections.map((section) => section.type),
        subject: digest.subject,
        module_errors: moduleErrors
      }
    })

    let sendResult: any = null
    if (shouldSend) {
      sendResult = await sendDigestEmail({
        userId: user.id,
        digestId: persisted.id,
        toEmail: body.to_email || null
      })
    }

    return NextResponse.json({
      ok: true,
      generated_date: generatedDate,
      digest: {
        ...persisted,
        subject: digest.subject,
        section_types: digest.sections.map((section) => section.type)
      },
      modules: {
        newsletter_digest: {
          enabled: moduleFlags.enable_newsletter_digest,
          summarized_items_available: newsletterSummaryCountResult.count || 0
        },
        daily_news_topics: {
          enabled: moduleFlags.enable_daily_news_topics,
          generated_count: newsItems.length,
          items: newsItems
        },
        daily_lessons: {
          enabled: moduleFlags.enable_daily_lessons,
          generated_count: lessonItems.length,
          items: lessonItems
        }
      },
      module_errors: moduleErrors,
      send_result: sendResult,
      message: shouldSend ? "Digest generated and sent" : "Digest generated"
    })
  } catch (e: any) {
    console.error("Error generating digest modules:", e)
    return NextResponse.json({
      ok: false,
      error: String(e?.message || e)
    }, { status: 500 })
  }
}
