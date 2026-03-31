import { supabaseServiceRole } from "@/lib/supabase/service"

type NewsletterSummaryItem = {
  id: string
  newsletter_name: string | null
  subject: string | null
  content_summary: string | null
  article_url: string | null
  received_at: string | null
}

type GeneratedModuleRow = {
  topic_id: string | null
  title: string
  content: string
  metadata: Record<string, any> | null
}

export type UnifiedDigestSection =
  | {
      type: "newsletter_summaries"
      title: string
      items: Array<{
        newsletter_name: string
        subject: string
        summary: string
        article_url: string | null
      }>
    }
  | {
      type: "daily_news_topics"
      title: string
      items: Array<{
        title: string
        content: string
        references: Array<{ title: string; url: string; source?: string }>
        empty: boolean
      }>
    }
  | {
      type: "daily_lessons"
      title: string
      items: Array<{
        title: string
        content: string
        lesson_day: number | null
        day_count: number | null
      }>
    }

export type UnifiedDigest = {
  digestDate: string
  runeName: string | null
  userId: string
  subject: string
  sections: UnifiedDigestSection[]
  metadata: {
    newsletter_count: number
    news_count: number
    lesson_count: number
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function markdownToHtml(value: string) {
  return escapeHtml(value)
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n- /g, "<br/>- ")
    .replace(/\n/g, "<br/>")
}

export async function buildUnifiedDigest(input: {
  userId: string
  digestDate: string
}): Promise<UnifiedDigest> {
  const [{ data: config }, { data: newsletterRows }, { data: newsRows }, { data: lessonRows }] = await Promise.all([
    supabaseServiceRole
      .from("digest_configs")
      .select("rune_name, module_flags")
      .eq("user_id", input.userId)
      .single(),
    supabaseServiceRole
      .from("digest_items")
      .select("id, newsletter_name, subject, content_summary, article_url, received_at")
      .eq("user_id", input.userId)
      .is("digest_id", null)
      .not("content_summary", "is", null)
      .order("received_at", { ascending: false }),
    supabaseServiceRole
      .from("generated_content_items")
      .select("topic_id, title, content, metadata")
      .eq("user_id", input.userId)
      .eq("module", "news_topics")
      .eq("generated_date", input.digestDate)
      .order("updated_at", { ascending: true }),
    supabaseServiceRole
      .from("generated_content_items")
      .select("topic_id, title, content, metadata")
      .eq("user_id", input.userId)
      .eq("module", "lessons")
      .eq("generated_date", input.digestDate)
      .order("updated_at", { ascending: true })
  ])

  const sections: UnifiedDigestSection[] = []

  const newsletterItems = ((newsletterRows || []) as NewsletterSummaryItem[])
    .filter((row) => row.content_summary)
    .map((row) => ({
      newsletter_name: row.newsletter_name || "Newsletter",
      subject: row.subject || "(No subject)",
      summary: row.content_summary || "",
      article_url: row.article_url || null
    }))

  if (newsletterItems.length > 0) {
    sections.push({
      type: "newsletter_summaries",
      title: "Newsletter Summaries",
      items: newsletterItems
    })
  }

  const newsItems = ((newsRows || []) as GeneratedModuleRow[]).map((row) => ({
    title: row.title,
    content: row.metadata?.empty_state
      ? `No notable developments on ${row.metadata?.topic_text || row.title} today.`
      : row.content,
    references: Array.isArray(row.metadata?.references) ? row.metadata!.references : [],
    empty: !!row.metadata?.empty_state
  }))

  const emptyTopics = newsItems.filter((item) => item.empty)
  const activeTopics = newsItems.filter((item) => !item.empty)

  if (emptyTopics.length >= 2) {
    const collapsedTitle = emptyTopics.map((t) => t.title).join(" and ")
    const collapsedItem = {
      title: collapsedTitle,
      content: `Quiet day on ${collapsedTitle}.`,
      references: [] as any[],
      empty: true,
    }
    newsItems.length = 0
    newsItems.push(...activeTopics, collapsedItem)
  }

  if (newsItems.length > 0) {
    sections.push({
      type: "daily_news_topics",
      title: "Daily News Topics",
      items: newsItems
    })
  }

  const lessonsByTopic = new Map<string, GeneratedModuleRow>()
  for (const row of (lessonRows || []) as GeneratedModuleRow[]) {
    const key = row.topic_id || row.metadata?.topic_text || row.title
    lessonsByTopic.set(key, row)
  }
  const lessonItems = [...lessonsByTopic.values()].map((row) => ({
    title: row.title,
    content: row.content,
    lesson_day: typeof row.metadata?.lesson_day === "number" ? row.metadata.lesson_day : null,
    day_count: typeof row.metadata?.day_count === "number" ? row.metadata.day_count : null
  }))

  if (lessonItems.length > 0) {
    sections.push({
      type: "daily_lessons",
      title: "Daily Lesson",
      items: lessonItems
    })
  }

  const runeName = config?.rune_name || null
  const subject = runeName ? `${runeName} · ${input.digestDate}` : `Your Daily Rune · ${input.digestDate}`

  return {
    digestDate: input.digestDate,
    runeName,
    userId: input.userId,
    subject,
    sections,
    metadata: {
      newsletter_count: newsletterItems.length,
      news_count: newsItems.length,
      lesson_count: lessonItems.length
    }
  }
}

export function renderDigestHtml(digest: UnifiedDigest): string {
  const sectionHtml = digest.sections.map((section) => {
    if (section.type === "newsletter_summaries") {
      const items = section.items.map((item) => `
        <div style="margin-bottom:18px;">
          <div style="font-weight:600;color:#ffffff;">${escapeHtml(item.newsletter_name)}</div>
          <div style="color:#b7b7c9;font-size:13px;margin-top:2px;">${escapeHtml(item.subject)}</div>
          <p style="color:#e9e9f1;line-height:1.6;margin:8px 0 0 0;">${escapeHtml(item.summary)}</p>
          ${item.article_url ? `<a href="${escapeHtml(item.article_url)}" style="color:#8ab4ff;font-size:13px;">Open source</a>` : ""}
        </div>
      `).join("")
      return `<section style="margin-bottom:28px;"><h2 style="color:#ffffff;font-size:18px;margin:0 0 14px 0;">${escapeHtml(section.title)}</h2>${items}</section>`
    }

    if (section.type === "daily_news_topics") {
      const items = section.items.map((item) => {
        if (item.empty) {
          return `
            <div style="margin-bottom:10px;color:#b7b7c9;font-size:14px;">
              <span style="font-weight:600;color:#e9e9f1;">${escapeHtml(item.title)}</span> — No notable developments today.
            </div>`
        }
        return `
          <div style="margin-bottom:18px;">
            <div style="font-weight:600;color:#ffffff;">${escapeHtml(item.title)}</div>
            <p style="color:#e9e9f1;line-height:1.6;margin:8px 0 0 0;">${escapeHtml(item.content)}</p>
            ${item.references.length > 0 ? `
              <div style="margin-top:8px;color:#b7b7c9;font-size:13px;">
                ${item.references.map((ref) => `<div><a href="${escapeHtml(String(ref.url || ""))}" style="color:#8ab4ff;">${escapeHtml(String(ref.title || ref.url || "Reference"))}</a>${ref.source ? ` · ${escapeHtml(String(ref.source))}` : ""}</div>`).join("")}
              </div>
            ` : ""}
          </div>`
      }).join("")
      return `<section style="margin-bottom:28px;"><h2 style="color:#ffffff;font-size:18px;margin:0 0 14px 0;">${escapeHtml(section.title)}</h2>${items}</section>`
    }

    const items = section.items.map((item) => `
      <div style="margin-bottom:18px;">
        <div style="font-weight:600;color:#ffffff;">${escapeHtml(item.title)}</div>
        ${item.lesson_day ? `<div style="color:#b7b7c9;font-size:13px;margin-top:2px;">Day ${item.lesson_day}${item.day_count ? ` of ${item.day_count}` : ""}</div>` : ""}
        <p style="color:#e9e9f1;line-height:1.6;margin:8px 0 0 0;">${markdownToHtml(item.content)}</p>
      </div>
    `).join("")
    return `<section style="margin-bottom:28px;"><h2 style="color:#ffffff;font-size:18px;margin:0 0 14px 0;">${escapeHtml(section.title)}</h2>${items}</section>`
  }).join("")

  return `
    <html>
      <body style="margin:0;padding:0;background:#0b0b12;font-family:Arial,sans-serif;">
        <div style="max-width:680px;margin:0 auto;padding:32px 20px;color:#ffffff;">
          <h1 style="margin:0 0 6px 0;font-size:28px;">${escapeHtml(digest.runeName || "Your Daily Rune")}</h1>
          <div style="color:#b7b7c9;font-size:14px;margin-bottom:24px;">${escapeHtml(digest.digestDate)}</div>
          ${sectionHtml || `<p style="color:#e9e9f1;">No digest sections were available for this send.</p>`}
        </div>
      </body>
    </html>
  `.trim()
}

export function renderDigestText(digest: UnifiedDigest): string {
  const parts: string[] = []
  parts.push(digest.runeName || "Your Daily Rune")
  parts.push(digest.digestDate)
  parts.push("")

  for (const section of digest.sections) {
    parts.push(section.title.toUpperCase())
    parts.push("")

    if (section.type === "newsletter_summaries") {
      for (const item of section.items) {
        parts.push(`${item.newsletter_name} — ${item.subject}`)
        parts.push(item.summary)
        if (item.article_url) parts.push(`Source: ${item.article_url}`)
        parts.push("")
      }
      continue
    }

    if (section.type === "daily_news_topics") {
      for (const item of section.items) {
        if (item.empty) {
          parts.push(`${item.title} — No notable developments today.`)
          parts.push("")
          continue
        }
        parts.push(item.title)
        parts.push(item.content)
        if (item.references.length > 0) {
          parts.push("References:")
          item.references.forEach((ref) => parts.push(`- ${ref.title}: ${ref.url}`))
        }
        parts.push("")
      }
      continue
    }

    for (const item of section.items) {
      parts.push(item.lesson_day ? `${item.title} (Day ${item.lesson_day}${item.day_count ? `/${item.day_count}` : ""})` : item.title)
      parts.push(item.content)
      parts.push("")
    }
  }

  return parts.join("\n").trim()
}

export async function persistFormattedDigest(input: {
  userId: string
  digestDate: string
  htmlContent: string
  textContent: string
  metadata: Record<string, any>
}) {
  const { data, error } = await supabaseServiceRole
    .from("digests")
    .upsert({
      user_id: input.userId,
      digest_date: input.digestDate,
      generated_at: new Date().toISOString(),
      status: "generated",
      html_content: input.htmlContent,
      text_content: input.textContent,
      metadata: input.metadata
    }, {
      onConflict: "user_id,digest_date",
      ignoreDuplicates: false
    })
    .select("id, status, digest_date, generated_at, sent_at, metadata")
    .single()

  if (error) {
    throw new Error(`Failed to persist digest: ${error.message}`)
  }

  return data
}

