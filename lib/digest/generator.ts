import { supabaseServiceRole } from "@/lib/supabase/service"
import {
  createGeneratedContentRun,
  finalizeGeneratedContentRun,
  getLessonStateFromMapping,
  getUserModuleConfig,
  setLessonState,
  upsertGeneratedContentItem
} from "@/lib/digest/content-modules"
import { callOpenAIChatCompletion } from "@/lib/openai/chat"
import { convert } from "html-to-text"
import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const TAVILY_API_KEY = process.env.TAVILY_API_KEY

type GeneratedModuleItem = {
  module: "news_topics" | "lessons"
  topicId: string
  title: string
  content: string
  metadata: Record<string, any>
  generatedDate: string
}

type LessonTopicRecord = {
  id: string
  topic_text: string
  curriculum_goal: string | null
  starting_level: string | null
  topic_mapping_json: Record<string, any> | null
}

type NewsTopicRecord = {
  id: string
  topic_text: string
  timeframe: string | null
  topic_mapping_json: Record<string, any> | null
}

type NewsArticle = {
  title: string
  link: string
  pubDate: string
  description: string
  source: string
  resolvedUrl?: string
  contentPreview?: string | null
}

type NewsFreshnessTier = {
  key: "24h" | "72h" | "7d"
  operator: string
  framingLabel: string
}

type NewsRelevanceEvaluation = {
  index: number
  relevant: boolean
  confidence: number
  reason: string
}

type RetrievalFunnelLog = {
  tier: string
  raw_count: number
  unseen_count: number
  substantive_count: number
  prefiltered_count: number
  hydrated_count: number
  hydration_passed_count: number
  relevant_count: number
  selected: boolean
}

type CurriculumDay = {
  day: number
  lesson_title: string
  objective: string
  key_points: string[]
}

function extractJsonObject(text: string): any | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}

  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
  try {
    return JSON.parse(stripped)
  } catch {}

  const start = stripped.indexOf("{")
  const end = stripped.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(stripped.slice(start, end + 1))
    } catch {}
  }
  return null
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function stripXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

function parseGoogleNewsRss(xml: string) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
  return items.map((match) => {
    const itemXml = match[1]
    const title = stripXml(itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "")
    const link = stripXml(itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "")
    const pubDate = stripXml(itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "")
    const description = stripXml(itemXml.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "")
    const source = stripXml(itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "")
    return { title, link, pubDate, description, source }
  }).filter((item) => item.title && item.link)
}

function timeframeToGoogleNewsOperator(timeframe: string | null | undefined) {
  const normalized = String(timeframe || "24h").toLowerCase()
  if (normalized.includes("7d") || normalized.includes("7 days")) return "when:7d"
  if (normalized.includes("30d") || normalized.includes("30 days")) return "when:30d"
  return "when:1d"
}

const NEWS_FRESHNESS_TIERS: NewsFreshnessTier[] = [
  { key: "24h", operator: "when:1d", framingLabel: "Today on this topic" },
  { key: "72h", operator: "when:3d", framingLabel: "Recent developments" },
  { key: "7d", operator: "when:7d", framingLabel: "This week on this topic" }
]

function tierKeyToDays(tierKey: string) {
  if (tierKey === "24h") return 1
  if (tierKey === "72h") return 3
  return 7
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url)
    const clean = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`
    return clean.toLowerCase()
  } catch {
    return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "")
  }
}

function significantWords(text: string) {
  const stopwords = new Set(["the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or", "is", "are", "was", "were", "be", "been", "has", "have", "had", "its", "it", "that", "this", "with", "from", "by", "as", "not", "but", "can", "will", "how", "new", "says", "said"])
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1 && !stopwords.has(word))
}

function titlesAreSimilar(a: string, b: string) {
  const wordsA = significantWords(a)
  const wordsB = significantWords(b)
  if (wordsA.length === 0 || wordsB.length === 0) return false
  const setB = new Set(wordsB)
  const overlap = wordsA.filter((word) => setB.has(word)).length
  return overlap / Math.min(wordsA.length, wordsB.length) >= 0.6
}

function deduplicateArticlesCrossProvider(articles: NewsArticle[]) {
  const kept: NewsArticle[] = []
  const normalizedUrls = new Set<string>()

  for (const article of articles) {
    const normUrl = normalizeUrl(article.resolvedUrl || article.link)
    if (normalizedUrls.has(normUrl)) continue

    const isDupeByTitle = kept.some((existing) => titlesAreSimilar(existing.title, article.title))
    if (isDupeByTitle) continue

    normalizedUrls.add(normUrl)
    kept.push(article)
  }

  return kept
}

async function fetchTavilyNews(input: {
  queries: string[]
  days: number
  maxResults?: number
}): Promise<NewsArticle[]> {
  if (!TAVILY_API_KEY) {
    console.warn("[tavily] TAVILY_API_KEY is not set, skipping")
    return []
  }

  const allArticles: NewsArticle[] = []

  const results = await Promise.allSettled(
    input.queries.map(async (query) => {
      const resp = await fetchWithTimeout("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: "advanced",
          topic: "news",
          days: input.days,
          max_results: input.maxResults || 5,
          include_raw_content: true
        })
      }, 15000)

      if (!resp.ok) {
        const body = await resp.text().catch(() => "")
        console.warn(`[tavily] search failed for "${query}": ${resp.status} ${body.slice(0, 300)}`)
        return []
      }

      const data = await resp.json()
      const tavilyResults = Array.isArray(data?.results) ? data.results : []
      console.log(`[tavily] query="${query}" returned ${tavilyResults.length} results`)
      return tavilyResults.map((result: any) => {
        const rawText = String(result.raw_content || "").trim()
        const snippet = String(result.content || "").trim()
        const bestContent = rawText.length > snippet.length ? rawText : snippet
        return {
          title: String(result.title || "").trim(),
          link: String(result.url || "").trim(),
          pubDate: String(result.published_date || ""),
          description: snippet.slice(0, 500),
          source: String(new URL(result.url || "https://unknown").hostname).replace(/^www\./, ""),
          resolvedUrl: String(result.url || "").trim(),
          contentPreview: bestContent.slice(0, 8000) || null
        }
      }).filter((article: NewsArticle) => article.title && article.link)
    })
  )

  for (const result of results) {
    if (result.status === "fulfilled") {
      allArticles.push(...result.value)
    } else {
      console.warn(`[tavily] query rejected: ${result.reason}`)
    }
  }

  return allArticles
}

function isSubstantiveArticle(article: NewsArticle) {
  const combined = `${article.title} ${article.description}`.trim()
  if (!article.title || article.title.length < 18) return false
  if (combined.length < 80) return false
  const lowered = combined.toLowerCase()
  if (lowered.includes("sign in") || lowered.includes("subscribe")) return false
  return true
}

function buildNewsSearchBase(topic: NewsTopicRecord) {
  const mapping = (topic.topic_mapping_json || {}) as Record<string, any>
  const retrievalHint = String(mapping.retrieval_hint || "").trim()
  const normalizedTopic = String(mapping.normalized_topic || "").trim()
  const topicText = String(topic.topic_text || "").trim()

  if (retrievalHint && retrievalHint.length <= 140) return retrievalHint
  if (normalizedTopic) return normalizedTopic
  return topicText
}

function buildNewsSearchInstruction(topic: NewsTopicRecord) {
  const mapping = (topic.topic_mapping_json || {}) as Record<string, any>
  return String(mapping.scope_summary || mapping.retrieval_hint || mapping.normalized_topic || topic.topic_text || "").trim()
}

function getRequiredTermGroups(topic: NewsTopicRecord): string[][] {
  const mapping = (topic.topic_mapping_json || {}) as Record<string, any>
  if (Array.isArray(mapping.required_terms)) {
    const groups = mapping.required_terms
      .map((group: any) => Array.isArray(group)
        ? group.map((term: any) => String(term || "").trim().toLowerCase()).filter(Boolean)
        : [])
      .filter((group: string[]) => group.length > 0)
    if (groups.length > 0) return groups.slice(0, 4)
  }

  return String(topic.topic_text || "")
    .split(/[^a-zA-Z0-9]+/)
    .filter((term) => term.length > 2)
    .slice(0, 4)
    .map((term) => [term.toLowerCase()])
}

function passesTopicPreFilter(article: NewsArticle, topic: NewsTopicRecord): boolean {
  const requiredGroups = getRequiredTermGroups(topic)
  if (requiredGroups.length === 0) return true

  const haystack = `${article.title} ${article.description}`.toLowerCase()
  const matchedGroups = requiredGroups.filter((group) => group.some((term) => haystack.includes(term)))
  return matchedGroups.length >= requiredGroups.length
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const trimmed = String(value || "").trim()
    if (!trimmed) continue
    const normalized = trimmed.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    output.push(trimmed)
  }
  return output
}

function buildNewsSearchQueries(topic: NewsTopicRecord) {
  const mapping = (topic.topic_mapping_json || {}) as Record<string, any>
  const configuredQueries = Array.isArray(mapping.retrieval_queries)
    ? mapping.retrieval_queries.map((value: any) => String(value || "").trim()).filter(Boolean)
    : []

  if (configuredQueries.length > 0) {
    return uniqueStrings(configuredQueries).slice(0, 5)
  }

  const normalizedTopic = String(mapping.normalized_topic || "").trim()
  const retrievalHint = String(mapping.retrieval_hint || "").trim()
  const topicText = String(topic.topic_text || "").trim()
  const queries: string[] = []

  const baseTopic = normalizedTopic || topicText
  if (baseTopic) queries.push(`"${baseTopic}"`)
  if (retrievalHint) queries.push(retrievalHint)

  const lowerTopic = topicText.toLowerCase()
  if (lowerTopic.includes("ai")) {
    queries.push(topicText.replace(/\bAI\b/gi, "artificial intelligence"))
  }
  if (lowerTopic.includes("commercial real estate")) {
    queries.push(topicText.replace(/commercial real estate/gi, "CRE"))
  }

  const splitIn = topicText.split(/\sin\s/i)
  if (splitIn.length === 2) {
    queries.push(`"${splitIn[0].trim()}" "${splitIn[1].trim()}"`)
  }

  const splitFor = topicText.split(/\sfor\s/i)
  if (splitFor.length === 2) {
    queries.push(`"${splitFor[0].trim()}" "${splitFor[1].trim()}"`)
  }

  return uniqueStrings(queries).slice(0, 5)
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number = 8000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

function extractArticlePreview(html: string, url: string): string | null {
  try {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    if (article?.textContent) {
      const cleaned = article.textContent.replace(/\s+/g, " ").trim()
      if (cleaned.length >= 100) return cleaned.slice(0, 4000)
    }
  } catch {}

  try {
    const text = convert(html, {
      wordwrap: false,
      selectors: [
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "noscript", format: "skip" },
        { selector: "img", format: "skip" }
      ]
    })
      .replace(/\s+/g, " ")
      .trim()

    if (text.length >= 100) return text.slice(0, 4000)
  } catch {}

  return null
}

async function hydrateArticlePreview(article: NewsArticle): Promise<NewsArticle> {
  const source = article.source || new URL(article.link || "https://unknown").hostname

  if (article.link.includes("news.google.com/rss/articles")) {
    return { ...article, contentPreview: null }
  }

  try {
    const resp = await fetchWithTimeout(article.link, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RuneDigest/1.0)"
      },
      redirect: "follow"
    }, 7000)

    if (!resp.ok) {
      console.log(`[hydration] FAIL ${resp.status} ${source}`)
      return { ...article, contentPreview: null }
    }

    const resolvedUrl = resp.url || article.link
    const html = await resp.text()
    const preview = extractArticlePreview(html, resolvedUrl)
    if (!preview || preview.length < 200) {
      console.log(`[hydration] THIN ${preview?.length || 0}ch ${source}`)
    }
    return {
      ...article,
      resolvedUrl,
      contentPreview: preview
    }
  } catch (e: any) {
    const reason = e?.code || e?.cause?.code || "unknown"
    console.log(`[hydration] ERR ${reason} ${source}`)
    return { ...article, contentPreview: null }
  }
}

function hasUsableContentPreview(article: NewsArticle) {
  return !!article.contentPreview && article.contentPreview.trim().length >= 200
}

function fallbackRelevantNewsArticles(input: {
  topic: NewsTopicRecord
  articles: NewsArticle[]
}) {
  const topicTerms = String(input.topic.topic_text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2)

  const relevantArticles = input.articles.filter((article) => {
    const haystack = `${article.title} ${article.description}`.toLowerCase()
    const matchCount = topicTerms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0)
    return matchCount >= Math.min(2, topicTerms.length)
  })

  return {
    relevantArticles,
    evaluations: input.articles.map((article, index) => ({
      index,
      relevant: relevantArticles.includes(article),
      confidence: relevantArticles.includes(article) ? 0.6 : 0.2,
      reason: relevantArticles.includes(article)
        ? "Matched multiple topic terms."
        : "Did not match enough topic terms."
    }))
  }
}

async function filterRelevantNewsArticles(input: {
  topic: NewsTopicRecord
  searchInstruction: string
  articles: NewsArticle[]
  professionalContext?: string | null
}) {
  if (!OPENAI_API_KEY) {
    return fallbackRelevantNewsArticles(input)
  }

  const contextClause = input.professionalContext
    ? `\n- Consider the user's professional context when evaluating relevance: "${input.professionalContext}". An article about foreign policy in another country is not relevant to a US-focused professional unless it directly impacts their domain.`
    : ""

  const prompt = `You are Rune's news relevance filter.
Your job is to decide whether each candidate source is substantively about the user's exact topic.

Core rule:
- A source is relevant only if a person tracking the exact topic would consider it a meaningful update on that topic.
- Sharing one keyword is not enough.
- Tangential, adjacent, or loosely related sources are NOT relevant.${contextClause}
- When in doubt, reject.

Return STRICT JSON:
{
  "evaluations": [
    {
      "index": 0,
      "relevant": true,
      "confidence": 0.0,
      "reason": "string"
    }
  ]
}

Confidence should be between 0 and 1.
Keep reasons short.`

  const resp = await callOpenAIChatCompletion({
    apiKey: OPENAI_API_KEY,
    model: "gpt-4o",
    temperature: 0.1,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify({
          topic: input.topic.topic_text,
          search_instruction: input.searchInstruction,
          candidates: input.articles.map((article, index) => ({
            index,
            title: article.title,
            description: article.description,
            content_preview: article.contentPreview || null,
            source: article.source,
            pubDate: article.pubDate
          }))
        })
      }
    ]
  })

  const data = await resp.json()
  const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || "")
  const rawEvaluations = Array.isArray(parsed?.evaluations) ? parsed.evaluations : []
  const evaluations: NewsRelevanceEvaluation[] = rawEvaluations.map((evaluation: any) => ({
    index: Number(evaluation?.index || 0),
    relevant: !!evaluation?.relevant,
    confidence: Math.max(0, Math.min(1, Number(evaluation?.confidence ?? 0))),
    reason: String(evaluation?.reason || "")
  }))

  const relevantIndexes = new Set(
    evaluations
      .filter((evaluation) => evaluation.relevant && evaluation.confidence >= 0.55)
      .map((evaluation) => evaluation.index)
  )

  return {
    relevantArticles: input.articles.filter((_, index) => relevantIndexes.has(index)),
    evaluations
  }
}

async function getActiveLessonTopicRecords(userId: string): Promise<LessonTopicRecord[]> {
  const { data, error } = await supabaseServiceRole
    .from("user_lesson_topics")
    .select("id, topic_text, curriculum_goal, starting_level, topic_mapping_json")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("Error fetching active lesson topics:", error)
    return []
  }

  return (data || []) as LessonTopicRecord[]
}

async function getActiveNewsTopicRecords(userId: string): Promise<NewsTopicRecord[]> {
  const { data, error } = await supabaseServiceRole
    .from("user_news_topics")
    .select("id, topic_text, timeframe, topic_mapping_json")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("Error fetching active news topics:", error)
    return []
  }

  return (data || []) as NewsTopicRecord[]
}

async function getGeneratedItemForDate(input: {
  userId: string
  module: "news_topics" | "lessons"
  topicId: string
  generatedDate: string
}) {
  const { data, error } = await supabaseServiceRole
    .from("generated_content_items")
    .select("title, content, metadata")
    .eq("user_id", input.userId)
    .eq("module", input.module)
    .eq("topic_id", input.topicId)
    .eq("generated_date", input.generatedDate)
    .maybeSingle()

  if (error) {
    console.error("Error fetching existing generated item:", error)
    return null
  }

  return data
}

async function getLastGeneratedLessonMetadata(userId: string, topicId: string) {
  const { data, error } = await supabaseServiceRole
    .from("generated_content_items")
    .select("generated_date, metadata, title")
    .eq("user_id", userId)
    .eq("module", "lessons")
    .eq("topic_id", topicId)
    .order("generated_date", { ascending: false })
    .limit(3)

  if (error) {
    console.error("Error fetching recent lessons:", error)
    return []
  }

  return data || []
}

async function getRecentGeneratedNewsMetadata(input: {
  userId: string
  topicId: string
  beforeDate: string
}) {
  const { data, error } = await supabaseServiceRole
    .from("generated_content_items")
    .select("generated_date, metadata, title, content")
    .eq("user_id", input.userId)
    .eq("module", "news_topics")
    .eq("topic_id", input.topicId)
    .lt("generated_date", input.beforeDate)
    .order("generated_date", { ascending: false })
    .limit(7)

  if (error) {
    console.error("Error fetching recent news history:", error)
    return []
  }

  return data || []
}

async function synthesizeLessonContent(input: {
  topic: LessonTopicRecord
  curriculumTitle: string
  day: CurriculumDay
  currentDay: number
  dayCount: number
  completionSignal: string
  recentLessonTitles: string[]
}) {
  if (!OPENAI_API_KEY) {
    return {
      title: input.day.lesson_title,
      content: [
        `Today's lesson focuses on ${input.day.lesson_title}.`,
        input.day.objective,
        "",
        ...input.day.key_points.map((point) => `- ${point}`),
        "",
        `This is day ${input.currentDay} of ${input.dayCount}.`
      ].join("\n")
    }
  }

  const prompt = `You are Rune's daily lesson writer.
Write today's lesson from a curriculum plan.
Return STRICT JSON:
{
  "title": "string",
  "content": "markdown string"
}

Requirements:
- Use the provided lesson day plan exactly.
- Make the lesson digestible but substantive. 400-700 words.
- This is for email delivery — it should read cleanly in plain text/markdown.

Structure:
- Open with a concrete hook: a real-world example, recent event, surprising statistic, or scenario that grounds the day's concept immediately. Never open with "Welcome to lesson X" or "Today we will explore."
- Teach the core concepts in the body. Prefer explanations that build intuition over listing definitions. When introducing a term, show how it works in practice before naming it.
- Use bullets sparingly and only for genuinely list-like content (e.g. 3 distinct tools the Fed uses). Avoid bullet-heavy lessons where every paragraph is a bulleted list.
- Each concept should have its own angle or implication — avoid repeating the same takeaway (e.g. "more liquidity → more investment") under different headings.
- Include at least one concrete number, date, or real example to anchor the theory.
- Close with a brief recap (2-3 sentences) that connects back to the hook or previews the next lesson's territory. Keep it tight.

Tone:
- Conversational but precise — like a sharp colleague explaining over coffee, not a textbook chapter.
- Avoid filler phrases: "It's important to note that," "In this lesson we will," "Let's delve into."
- Do not repeat prior lesson framing or titles.`

  const userPayload = {
    topic: input.topic.topic_text,
    curriculum_title: input.curriculumTitle,
    current_day: input.currentDay,
    total_days: input.dayCount,
    completion_signal: input.completionSignal,
    lesson_day_plan: input.day,
    recent_lesson_titles: input.recentLessonTitles
  }

  const resp = await callOpenAIChatCompletion({
    apiKey: OPENAI_API_KEY,
    model: "gpt-4o",
    temperature: 0.4,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: JSON.stringify(userPayload) }
    ]
  })

  const data = await resp.json()
  const raw = data?.choices?.[0]?.message?.content || ""
  const parsed = extractJsonObject(raw)

  if (parsed && parsed.content) {
    return {
      title: String(parsed.title || input.day.lesson_title),
      content: String(parsed.content)
    }
  }

  if (raw.length > 100) {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim()
    return {
      title: input.day.lesson_title,
      content: cleaned
    }
  }

  return {
    title: input.day.lesson_title,
    content: input.day.key_points.map((kp: string) => `• ${kp}`).join("\n\n")
  }
}

async function synthesizeNewsBrief(input: {
  topic: NewsTopicRecord
  searchInstruction: string
  articles: NewsArticle[]
  framingLabel: string
  tierKey: NewsFreshnessTier["key"]
}) {
  if (!OPENAI_API_KEY) {
    return {
      title: input.topic.topic_text,
      content: `${input.framingLabel}: ${input.articles.slice(0, 3).map((article) => `${article.title} (${article.source || "Source"})`).join("; ")}`,
      references: input.articles.slice(0, 5).map((article) => ({
        title: article.title,
        url: article.link,
        source: article.source || "Source"
      })),
      whyThisMatters: null
    }
  }

  const articleCount = input.articles.length

  const prompt = `You are Rune's daily news writer.
You receive a scoped search instruction and retrieved news items for a specific freshness window.
Write one substantive intelligence brief with references.
Return STRICT JSON:
{
  "title": "string",
  "content": "string",
  "references": [
    { "title": "string", "url": "string", "source": "string" }
  ],
  "why_this_matters": "string | null"
}

Requirements:
- Be specific: name the companies, the numbers, the actual news. No vague summaries.
- If the retrieved articles cover different subtopics, present each as a separate brief item — do not force them into one unified narrative. A brief with three distinct items is better than one paragraph pretending three unrelated stories are connected.
- ${articleCount === 1 ? "You have ONE source. Do not synthesize. Present it directly: 'One notable development: [specific thing]. [Source].' Two sentences max." : articleCount <= 2 ? "You have very few sources. Write 2-3 sentences max. Be short and honest. Do NOT pad thin material." : "Keep content concise and digestible."}
- Respect the freshness framing. If the window is broader than today, write it as a concise status update over that period.
- Only include "why_this_matters" if it adds genuinely new insight beyond what the brief already says. If it would just restate or rephrase the content, set it to null.
- Use only the provided retrieved items.
- References must point to the most relevant items.`

  const resp = await callOpenAIChatCompletion({
    apiKey: OPENAI_API_KEY,
    model: "gpt-4o",
    temperature: 0.3,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify({
          search_instruction: input.searchInstruction,
          topic: input.topic.topic_text,
          freshness_tier: input.tierKey,
          framing_label: input.framingLabel,
        articles: input.articles.slice(0, 8).map((article) => ({
          title: article.title,
          source: article.source,
          pubDate: article.pubDate,
          url: article.resolvedUrl || article.link,
          description: article.description,
          content_preview: article.contentPreview || null
        }))
        })
      }
    ]
  })

  const data = await resp.json()
  const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || "")
  if (!parsed) {
    throw new Error("Invalid news brief JSON")
  }

  return {
    title: String(parsed.title || input.topic.topic_text),
    content: String(parsed.content || ""),
    references: Array.isArray(parsed.references) ? parsed.references : [],
    whyThisMatters: parsed.why_this_matters ? String(parsed.why_this_matters) : null
  }
}

async function fetchNewsArticles(topic: NewsTopicRecord) {
  const baseQuery = buildNewsSearchBase(topic)
  const timeframeOperator = timeframeToGoogleNewsOperator(topic.timeframe)
  const query = encodeURIComponent(`${baseQuery} ${timeframeOperator}`)
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "RuneDigest/1.0"
    }
  })

  if (!resp.ok) {
    throw new Error(`News retrieval failed (${resp.status})`)
  }

  const xml = await resp.text()
  const parsed = parseGoogleNewsRss(xml)
  const deduped = parsed.filter((item, index, arr) =>
    arr.findIndex((other) => other.link === item.link || other.title === item.title) === index
  )

  return {
    query: `${baseQuery} ${timeframeOperator}`.trim(),
    articles: deduped.slice(0, 8)
  }
}

async function fetchGoogleNewsForTier(queries: string[], tier: NewsFreshnessTier) {
  const retrievals = await Promise.allSettled(
    queries.map(async (baseQuery) => {
      const query = encodeURIComponent(`${baseQuery} ${tier.operator}`)
      const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`
      const resp = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "RuneDigest/1.0"
        }
      }, 7000)

      if (!resp.ok) return []
      const xml = await resp.text()
      return parseGoogleNewsRss(xml)
    })
  )

  const articles: NewsArticle[] = []
  for (const result of retrievals) {
    if (result.status === "fulfilled") articles.push(...result.value)
  }
  return articles
}

async function fetchNewsArticlesForTier(topic: NewsTopicRecord, tier: NewsFreshnessTier) {
  const queries = buildNewsSearchQueries(topic)
  const days = tierKeyToDays(tier.key)

  const [googleArticles, tavilyArticles] = await Promise.all([
    fetchGoogleNewsForTier(queries, tier),
    fetchTavilyNews({ queries, days, maxResults: 10 })
  ])

  const combined = [...tavilyArticles, ...googleArticles]
  const deduped = deduplicateArticlesCrossProvider(combined)

  const sourceBreakdown = {
    tavily: tavilyArticles.length,
    google: googleArticles.length,
    after_dedup: deduped.length
  }
  console.log(`[news-retrieval] tier=${tier.key} sources: tavily=${sourceBreakdown.tavily} google=${sourceBreakdown.google} deduped=${sourceBreakdown.after_dedup}`)

  return {
    query: queries.join(" | "),
    articles: deduped.slice(0, 16),
    sourceBreakdown
  }
}

export async function previewNewsTopicSignal(input: {
  topicText: string
  scopeSummary?: string | null
  retrievalHint?: string | null
  retrievalQueries?: string[] | null
  requiredTerms?: string[][] | null
}) {
  const topic: NewsTopicRecord = {
    id: "__preview__",
    topic_text: input.topicText,
    timeframe: "7d",
    topic_mapping_json: {
      normalized_topic: input.topicText,
      scope_summary: input.scopeSummary || input.topicText,
      retrieval_hint: input.retrievalHint || null,
      retrieval_queries: input.retrievalQueries || undefined,
      required_terms: input.requiredTerms || undefined
    }
  }

  const searchInstruction = buildNewsSearchInstruction(topic)
  const retrieval = await fetchNewsArticlesForTier(topic, NEWS_FRESHNESS_TIERS[2])
  const substantiveArticles = retrieval.articles.filter(isSubstantiveArticle)
  const preFilteredArticles = substantiveArticles.filter((article) => passesTopicPreFilter(article, topic))
  const alreadyHydrated = preFilteredArticles.filter((article) => hasUsableContentPreview(article))
  const needsHydration = preFilteredArticles.filter((article) => !hasUsableContentPreview(article))
  const freshlyHydrated = await Promise.all(
    needsHydration.slice(0, 6).map((article) => hydrateArticlePreview(article))
  )
  const hydrationPassedArticles = [...alreadyHydrated, ...freshlyHydrated.filter(hasUsableContentPreview)]
  const hydrationFailedButDescriptive = freshlyHydrated
    .filter((a) => !hasUsableContentPreview(a))
    .filter((a) => `${a.title} ${a.description}`.trim().length >= 80)
  const articlesForRelevance = [...hydrationPassedArticles, ...hydrationFailedButDescriptive]
  const relevance = await filterRelevantNewsArticles({
    topic,
    searchInstruction,
    articles: articlesForRelevance
  })

  const relevantCount = relevance.relevantArticles.length
  let bucket: "high" | "moderate" | "likely_sparse" = "likely_sparse"
  if (relevantCount >= 4) bucket = "high"
  else if (relevantCount >= 2) bucket = "moderate"

  return {
    bucket,
    relevant_count: relevantCount,
    candidate_count: retrieval.articles.length,
    query: retrieval.query,
    sample_titles: relevance.relevantArticles.slice(0, 3).map((article) => article.title)
  }
}

export async function generateDailyLessons(input: {
  userId: string
  generatedAt?: Date
  forceRegenerate?: boolean
}) {
  const generatedAt = input.generatedAt || new Date()
  const generatedDate = formatDateKey(generatedAt)
  const runId = await createGeneratedContentRun({ userId: input.userId, module: "lessons" })

  try {
    const { moduleFlags } = await getUserModuleConfig(input.userId)
    if (!moduleFlags.enable_daily_lessons) {
      if (runId) await finalizeGeneratedContentRun({ runId, status: "completed" })
      return []
    }

    const topics = await getActiveLessonTopicRecords(input.userId)
    const outputs: GeneratedModuleItem[] = []

    for (const topic of topics) {
      const existing = await getGeneratedItemForDate({
        userId: input.userId,
        module: "lessons",
        topicId: topic.id,
        generatedDate
      })

      if (existing && !input.forceRegenerate) {
        outputs.push({
          module: "lessons",
          topicId: topic.id,
          title: existing.title,
          content: existing.content,
          metadata: existing.metadata || {},
          generatedDate
        })
        continue
      }

      const mapping = (topic.topic_mapping_json || {}) as Record<string, any>
      const curriculumPlan = (mapping.curriculum_plan || null) as Record<string, any> | null
      const curriculumDays = Array.isArray(curriculumPlan?.days) ? curriculumPlan!.days as CurriculumDay[] : []
      const dayCount = Number(curriculumPlan?.day_count || curriculumDays.length || 10)
      const recentLessons = await getLastGeneratedLessonMetadata(input.userId, topic.id)
      const lessonState = getLessonStateFromMapping(mapping)
      const regeneratedLessonDay = Number(existing?.metadata?.lesson_day || 0)
      const nextDay = input.forceRegenerate && regeneratedLessonDay > 0
        ? regeneratedLessonDay
        : (lessonState.next_day || 1)

      if (lessonState.status === "paused") {
        continue
      }

      if (lessonState.status === "completed") {
        continue
      }

      if (!curriculumPlan || curriculumDays.length === 0) {
        const fallbackContent = `No curriculum plan is stored for ${topic.topic_text} yet. Re-run lesson setup to regenerate the curriculum.`
        const metadata = { topic_text: topic.topic_text, missing_curriculum: true }
        await upsertGeneratedContentItem({
          userId: input.userId,
          module: "lessons",
          topicId: topic.id,
          generatedDate,
          title: `Lesson setup needed: ${topic.topic_text}`,
          content: fallbackContent,
          metadata
        })
        outputs.push({
          module: "lessons",
          topicId: topic.id,
          title: `Lesson setup needed: ${topic.topic_text}`,
          content: fallbackContent,
          metadata,
          generatedDate
        })
        continue
      }

      if (nextDay > dayCount) {
        const completionTitle = `Curriculum complete: ${curriculumPlan.curriculum_title || topic.topic_text}`
        const completionContent = `You've completed this ${dayCount}-day curriculum on ${topic.topic_text}. Next step: choose a new topic, pause lessons, or revisit a prior day for review.`
        const metadata = {
          topic_text: topic.topic_text,
          lesson_day: dayCount,
          day_count: dayCount,
          curriculum_complete: true,
          completion_signal: curriculumPlan.completion_signal || null
        }
        await upsertGeneratedContentItem({
          userId: input.userId,
          module: "lessons",
          topicId: topic.id,
          generatedDate,
          title: completionTitle,
          content: completionContent,
          metadata
        })
        outputs.push({
          module: "lessons",
          topicId: topic.id,
          title: completionTitle,
          content: completionContent,
          metadata,
          generatedDate
        })

        if (!input.forceRegenerate) {
          await setLessonState({
            userId: input.userId,
            topicId: topic.id,
            state: {
              ...lessonState,
              status: "completed",
              next_day: dayCount + 1,
              completed_at: new Date().toISOString()
            }
          })
        }
        continue
      }

      const dayPlan = curriculumDays.find((day) => Number(day.day) === nextDay) || curriculumDays[nextDay - 1]
      const lesson = await synthesizeLessonContent({
        topic,
        curriculumTitle: String(curriculumPlan.curriculum_title || topic.topic_text),
        day: {
          day: Number(dayPlan?.day || nextDay),
          lesson_title: String(dayPlan?.lesson_title || `Day ${nextDay}`),
          objective: String(dayPlan?.objective || topic.curriculum_goal || ""),
          key_points: Array.isArray(dayPlan?.key_points) ? dayPlan.key_points.map((point) => String(point)) : []
        },
        currentDay: nextDay,
        dayCount,
        completionSignal: String(curriculumPlan.completion_signal || ""),
        recentLessonTitles: recentLessons.map((item) => String(item.title || "")).filter(Boolean)
      })

      const metadata = {
        topic_text: topic.topic_text,
        lesson_day: nextDay,
        day_count: dayCount,
        curriculum_title: curriculumPlan.curriculum_title || topic.topic_text,
        objective: dayPlan?.objective || null,
        key_points: Array.isArray(dayPlan?.key_points) ? dayPlan.key_points : [],
        completion_signal: curriculumPlan.completion_signal || null
      }

      await upsertGeneratedContentItem({
        userId: input.userId,
        module: "lessons",
        topicId: topic.id,
        generatedDate,
        title: lesson.title,
        content: lesson.content,
        metadata
      })

      outputs.push({
        module: "lessons",
        topicId: topic.id,
        title: lesson.title,
        content: lesson.content,
        metadata,
        generatedDate
      })

      if (!input.forceRegenerate) {
        await setLessonState({
          userId: input.userId,
          topicId: topic.id,
          state: {
            ...lessonState,
            status: "active",
            next_day: nextDay + 1,
            last_generated_date: generatedDate,
            paused_at: null
          }
        })
      }
    }

    if (runId) await finalizeGeneratedContentRun({ runId, status: "completed" })
    return outputs
  } catch (e: any) {
    if (runId) {
      await finalizeGeneratedContentRun({
        runId,
        status: "failed",
        errorMessage: String(e?.message || e)
      })
    }
    throw e
  }
}

export async function generateDailyNewsTopics(input: {
  userId: string
  generatedAt?: Date
  forceRegenerate?: boolean
}) {
  const generatedAt = input.generatedAt || new Date()
  const generatedDate = formatDateKey(generatedAt)
  const runId = await createGeneratedContentRun({ userId: input.userId, module: "news_topics" })

  try {
    const { moduleFlags } = await getUserModuleConfig(input.userId)
    if (!moduleFlags.enable_daily_news_topics) {
      if (runId) await finalizeGeneratedContentRun({ runId, status: "completed" })
      return []
    }

    const topics = await getActiveNewsTopicRecords(input.userId)
    const outputs: GeneratedModuleItem[] = []

    const { data: profile } = await supabaseServiceRole
      .from("user_profiles")
      .select("professional_context")
      .eq("user_id", input.userId)
      .maybeSingle()
    const professionalContext = profile?.professional_context || null

    for (const topic of topics) {
      const existing = await getGeneratedItemForDate({
        userId: input.userId,
        module: "news_topics",
        topicId: topic.id,
        generatedDate
      })

      if (existing && !input.forceRegenerate) {
        outputs.push({
          module: "news_topics",
          topicId: topic.id,
          title: existing.title,
          content: existing.content,
          metadata: existing.metadata || {},
          generatedDate
        })
        continue
      }

      const searchInstruction = buildNewsSearchInstruction(topic)
      const recentNewsHistory = await getRecentGeneratedNewsMetadata({
        userId: input.userId,
        topicId: topic.id,
        beforeDate: generatedDate
      })
      const recentlyUsedUrls = new Set<string>()
      for (const historyRow of recentNewsHistory) {
        const refs = Array.isArray((historyRow.metadata as any)?.references)
          ? (historyRow.metadata as any).references
          : []
        for (const ref of refs) {
          if (ref?.url) recentlyUsedUrls.add(String(ref.url))
        }
      }

      let selectedTier: NewsFreshnessTier | null = null
      let selectedQuery = ""
      let selectedArticles: NewsArticle[] = []
      let selectedEvaluations: NewsRelevanceEvaluation[] = []
      const retrievalFunnel: RetrievalFunnelLog[] = []

      for (const tier of NEWS_FRESHNESS_TIERS) {
        const retrieval = await fetchNewsArticlesForTier(topic, tier)
        const unseenArticles = retrieval.articles.filter((article) => !recentlyUsedUrls.has(article.link))
        const substantiveArticles = unseenArticles.filter(isSubstantiveArticle)
        let preFilteredArticles = substantiveArticles.filter((article) => passesTopicPreFilter(article, topic))
        if (preFilteredArticles.length < 3 && substantiveArticles.length > preFilteredArticles.length) {
          preFilteredArticles = substantiveArticles.slice(0, 12)
        }
        const alreadyHydrated = preFilteredArticles.filter((article) => hasUsableContentPreview(article))
        const needsHydration = preFilteredArticles.filter((article) => !hasUsableContentPreview(article))
        const freshlyHydrated = await Promise.all(
          needsHydration.slice(0, 6).map((article) => hydrateArticlePreview(article))
        )
        const freshlyHydrationPassed = freshlyHydrated.filter(hasUsableContentPreview)
        const hydrationPassedArticles = [...alreadyHydrated, ...freshlyHydrationPassed]
        const hydrationFailedButDescriptive = freshlyHydrated
          .filter((a) => !hasUsableContentPreview(a))
          .filter((a) => `${a.title} ${a.description}`.trim().length >= 80)
        const articlesForRelevance = [...hydrationPassedArticles, ...hydrationFailedButDescriptive]
        const relevance = await filterRelevantNewsArticles({
          topic,
          searchInstruction,
          articles: articlesForRelevance,
          professionalContext,
        })
        const relevantArticles = relevance.relevantArticles
        const minArticlesForTier = tier.key === "24h" ? 1 : 2
        const hasEnoughSignal = relevantArticles.length >= minArticlesForTier

        const funnelEntry: RetrievalFunnelLog = {
          tier: tier.key,
          raw_count: retrieval.articles.length,
          unseen_count: unseenArticles.length,
          substantive_count: substantiveArticles.length,
          prefiltered_count: preFilteredArticles.length,
          hydrated_count: alreadyHydrated.length + freshlyHydrated.length,
          hydration_passed_count: hydrationPassedArticles.length,
          relevant_count: relevantArticles.length,
          selected: hasEnoughSignal
        }
        retrievalFunnel.push(funnelEntry)
        console.log(`[news-retrieval] topic="${topic.topic_text}" tier=${tier.key}: ${funnelEntry.raw_count} raw → ${funnelEntry.prefiltered_count} prefiltered → ${funnelEntry.hydration_passed_count} hydrated → ${funnelEntry.relevant_count} relevant → ${hasEnoughSignal ? "SELECTED" : "SKIP"}`)

        if (hasEnoughSignal) {
          selectedTier = tier
          selectedQuery = retrieval.query
          selectedArticles = relevantArticles
          selectedEvaluations = relevance.evaluations
          break
        }
      }

      let title = topic.topic_text
      let content = `No notable developments on ${topic.topic_text} this week.`
      let metadata: Record<string, any> = {
        topic_text: topic.topic_text,
        timeframe: topic.timeframe || "24h",
        query: buildNewsSearchBase(topic),
        references: [],
        freshness_tier: "empty",
        framing_label: `No notable developments on ${topic.topic_text} this week.`,
        empty_state: true,
        retrieval_funnel: retrievalFunnel
      }

      if (selectedTier && selectedArticles.length > 0) {
        const brief = await synthesizeNewsBrief({
          topic,
          searchInstruction,
          articles: selectedArticles,
          framingLabel: selectedTier.framingLabel,
          tierKey: selectedTier.key
        })
        title = brief.title
        const framedContent = selectedTier.key === "24h"
          ? brief.content
          : `${selectedTier.framingLabel}: ${brief.content}`
        content = brief.whyThisMatters
          ? `${framedContent}\n\nWhy this matters: ${brief.whyThisMatters}`
          : framedContent
        metadata = {
          ...metadata,
          query: selectedQuery,
          references: brief.references.map((ref: any) => ({
            ...ref,
            url: String(ref?.url || "")
          })),
          article_count: selectedArticles.length,
          relevance_evaluations: selectedEvaluations,
          freshness_tier: selectedTier.key,
          framing_label: selectedTier.framingLabel,
          empty_state: false,
          retrieval_links: selectedArticles.map((article) => article.resolvedUrl || article.link),
          retrieval_funnel: retrievalFunnel
        }
      }

      await upsertGeneratedContentItem({
        userId: input.userId,
        module: "news_topics",
        topicId: topic.id,
        generatedDate,
        title,
        content,
        metadata
      })

      outputs.push({
        module: "news_topics",
        topicId: topic.id,
        title,
        content,
        metadata,
        generatedDate
      })
    }

    if (runId) await finalizeGeneratedContentRun({ runId, status: "completed" })
    return outputs
  } catch (e: any) {
    if (runId) {
      await finalizeGeneratedContentRun({
        runId,
        status: "failed",
        errorMessage: String(e?.message || e)
      })
    }
    throw e
  }
}

