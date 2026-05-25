import { supabaseServiceRole } from "@/lib/supabase/service"
import { generateOpenAIObject } from "@/lib/ai/gateway"
import { newsletterSummaryMapSchema } from "@/lib/ai/schemas/digest"
import { convert } from "html-to-text"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MIN_CONTENT_LENGTH = 100
const MAX_CHARS_PER_BATCH = 50000

export async function summarizeNewslettersForUser(userId: string): Promise<{ ok: boolean; summaries_generated: number; error?: string }> {
  const { data: config } = await supabaseServiceRole
    .from("digest_configs")
    .select("style")
    .eq("user_id", userId)
    .single()

  const style = config?.style || "morning-brief"

  const { data: items, error: itemsErr } = await supabaseServiceRole
    .from("digest_items")
    .select("id, sender_key, newsletter_name, subject, html_content, text_content, links")
    .eq("user_id", userId)
    .is("digest_id", null)
    .is("content_summary", null)
    .order("received_at", { ascending: false })

  if (itemsErr || !items || items.length === 0) {
    return { ok: true, summaries_generated: 0 }
  }

  const prepared = items.map(item => {
    let content = item.text_content || ""
    if (item.html_content && !item.text_content) {
      content = convert(item.html_content, {
        wordwrap: false,
        selectors: [
          { selector: "a", options: { ignoreHref: true } },
          { selector: "img", format: "skip" },
          { selector: "style", format: "skip" },
          { selector: "script", format: "skip" },
        ],
      })
    }

    content = stripBoilerplate(content)
    if (content.length > 15000) content = content.substring(0, 15000) + "\n\n[... truncated ...]"

    const skipLlm = !content || content.length < MIN_CONTENT_LENGTH
    return {
      id: item.id,
      sender_key: item.sender_key,
      newsletter_name: item.newsletter_name,
      subject: item.subject || "",
      content: skipLlm && item.subject ? `Subject: ${item.subject}\n\n${content || "Minimal content."}` : content,
      links: (item.links as string[]) || [],
      skipLlm,
    }
  })

  const valid = prepared.filter(p => !p.skipLlm)
  const sparse = prepared.filter(p => p.skipLlm)

  let llmSummaries: Array<{ item_id: string; summary: string }> = []
  if (valid.length > 0 && OPENAI_API_KEY) {
    llmSummaries = await batchSummarize(userId, valid, style)
  }

  const sparseSummaries = sparse.map(item => ({
    item_id: item.id,
    summary: item.subject
      ? `This email contains minimal text content. Subject: ${item.subject}`
      : "This email contains minimal text content.",
  }))

  const all = [...llmSummaries, ...sparseSummaries]
  let updated = 0

  for (const s of all) {
    const { error } = await supabaseServiceRole
      .from("digest_items")
      .update({ content_summary: s.summary })
      .eq("id", s.item_id)
      .eq("user_id", userId)
    if (!error) updated++
  }

  return { ok: true, summaries_generated: updated }
}

async function batchSummarize(
  userId: string,
  items: Array<{ id: string; sender_key: string | null; newsletter_name: string | null; subject: string; content: string; links: string[] }>,
  style: string
): Promise<Array<{ item_id: string; summary: string }>> {
  const chunks: typeof items[] = []
  let batch: typeof items = []
  let chars = 0

  for (const item of items) {
    if (chars + item.content.length > MAX_CHARS_PER_BATCH && batch.length > 0) {
      chunks.push(batch)
      batch = [item]
      chars = item.content.length
    } else {
      batch.push(item)
      chars += item.content.length
    }
  }
  if (batch.length > 0) chunks.push(batch)

  const results: Array<{ item_id: string; summary: string }> = []
  for (const chunk of chunks) {
    const chunkResults = await summarizeChunk(userId, chunk, style)
    results.push(...chunkResults)
  }
  return results
}

async function summarizeChunk(
  userId: string,
  items: Array<{ id: string; sender_key: string | null; newsletter_name: string | null; subject: string; content: string; links: string[] }>,
  style: string
): Promise<Array<{ item_id: string; summary: string }>> {
  const itemsText = items.map(item =>
    `BEGIN_ITEM ${item.id}\nSenderOrBrand: ${item.newsletter_name || item.sender_key || "Unknown"}\nSubjectLine: ${item.subject}\nBodyText:\n${item.content}\nEND_ITEM ${item.id}`
  ).join("\n\n")

  const instruction = style === "deep-read"
    ? "Provide detailed summaries with context, insights, and important details."
    : style === "reference-mode"
      ? "Provide structured summaries with main topics and key points."
      : "Deliver concise morning brief summaries. Headline + bullet points for each story."

  const systemPrompt = `You are an expert newsletter summarizer. Create ${instruction}

For each item, start with "Headline: " then bullet points (•) with key facts. Extract concrete information: numbers, names, dates, specifics. Respond with a single valid JSON object only (no markdown).

Each key must be the exact item ID from BEGIN_ITEM markers. Example:
{ "${items[0]?.id}": "Headline: ...\\n• ...\\n• ..." }`

  let parsed: Record<string, string>
  try {
    parsed = await generateOpenAIObject({
      apiKey: OPENAI_API_KEY!,
      model: "gpt-4o",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Summarize:\n\n${itemsText}` },
      ],
      schema: newsletterSummaryMapSchema,
      outputShapeName: "NewsletterSummaryMap",
      telemetry: {
        userId,
        callSiteName: "digest.newsletters.summarize_chunk",
        filePath: "lib/digest/summarize-newsletters.ts",
        functionName: "summarizeChunk",
        metadata: {
          batch_item_count: items.length,
          style
        }
      }
    })
  } catch {
    return items.map(item => ({ item_id: item.id, summary: `[Summary generation failed]` }))
  }

  return items.map(item => ({
    item_id: item.id,
    summary: (parsed[item.id] || "").substring(0, 2000) || "[No summary generated]",
  }))
}

function stripBoilerplate(text: string): string {
  return text
    .replace(/unsubscribe.*$/gim, "")
    .replace(/view.*in.*browser.*$/gim, "")
    .replace(/manage.*preferences.*$/gim, "")
    .replace(/https?:\/\/[^\s]+\.(png|jpg|gif|svg|jpeg|webp|ico)\b[^\s]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
