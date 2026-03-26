import { NextResponse } from "next/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { isWithinSendWindow } from "@/lib/digest/utils"
import { getUserModuleConfig } from "@/lib/digest/content-modules"
import { generateDailyLessons, generateDailyNewsTopics } from "@/lib/digest/generator"
import { buildUnifiedDigest, persistFormattedDigest, renderDigestHtml, renderDigestText } from "@/lib/digest/formatter"
import { sendDigestEmail } from "@/lib/digest/email"

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: Request) {
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const now = new Date()
    const digestDate = now.toISOString().slice(0, 10)
    const { data: configs, error } = await supabaseServiceRole
      .from("digest_configs")
      .select("user_id, timezone, send_time")

    if (error) {
      throw new Error(error.message)
    }

    const results: Array<Record<string, any>> = []

    for (const config of configs || []) {
      const sendTimes = Array.isArray(config.send_time) ? config.send_time : []
      const shouldRun = sendTimes.some((sendTime: string) =>
        typeof sendTime === "string" && isWithinSendWindow(now, sendTime, config.timezone || "UTC")
      )

      if (!shouldRun) continue

      const existingSent = await supabaseServiceRole
        .from("digests")
        .select("id, status")
        .eq("user_id", config.user_id)
        .eq("digest_date", digestDate)
        .eq("status", "sent")
        .maybeSingle()

      if (existingSent.data?.id) {
        results.push({ user_id: config.user_id, skipped: true, reason: "already_sent" })
        continue
      }

      try {
        const { moduleFlags } = await getUserModuleConfig(config.user_id)
        const moduleErrors: Array<{ module: string; error: string }> = []

        if (moduleFlags.enable_daily_news_topics) {
          try {
            await generateDailyNewsTopics({ userId: config.user_id, generatedAt: now })
          } catch (e: any) {
            moduleErrors.push({ module: "daily_news_topics", error: String(e?.message || e) })
          }
        }

        if (moduleFlags.enable_daily_lessons) {
          try {
            await generateDailyLessons({ userId: config.user_id, generatedAt: now })
          } catch (e: any) {
            moduleErrors.push({ module: "daily_lessons", error: String(e?.message || e) })
          }
        }

        const digest = await buildUnifiedDigest({
          userId: config.user_id,
          digestDate
        })
        const persisted = await persistFormattedDigest({
          userId: config.user_id,
          digestDate,
          htmlContent: renderDigestHtml(digest),
          textContent: renderDigestText(digest),
          metadata: {
            ...digest.metadata,
            sections: digest.sections.map((section) => section.type),
            subject: digest.subject,
            module_errors: moduleErrors
          }
        })

        const sendResult = await sendDigestEmail({
          userId: config.user_id,
          digestId: persisted.id
        })

        results.push({
          user_id: config.user_id,
          ok: true,
          digest_id: persisted.id,
          sent_to: sendResult.recipient,
          module_errors: moduleErrors
        })
      } catch (e: any) {
        results.push({
          user_id: config.user_id,
          ok: false,
          error: String(e?.message || e)
        })
      }
    }

    return NextResponse.json({
      ok: true,
      ran_at: now.toISOString(),
      processed_users: results.length,
      results
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: String(e?.message || e)
    }, { status: 500 })
  }
}

