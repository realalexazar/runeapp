import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { callOpenAIChatCompletion } from "@/lib/openai/chat"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const DAILY_ONLY_CADENCE = "daily"
const DEFAULT_MODULE_FLAGS = {
  enable_newsletter_digest: true,
  enable_daily_news_topics: false,
  enable_daily_lessons: false
} as const
const DEFAULT_MODULE_DEFAULTS = {
  news_topic_timeframe: "24h",
  lesson_frequency: "daily",
  lesson_curriculum_days: 10
} as const

type TopicInputs = {
  newsTopic: string | null
  lessonTopic: string | null
  newsTopicClarification: string | null
  lessonTopicClarification: string | null
  lessonCurriculumPlan: Record<string, any> | null
}

type MappedTopic = {
  normalized_topic: string
  scope_summary: string
  retrieval_hint?: string
  retrieval_queries?: string[]
  required_terms?: string[][]
}

type MappedLesson = {
  normalized_topic: string
  curriculum_goal: string
  starting_level: "beginner" | "intermediate" | "advanced"
}

type TopicMappingResult = {
  news: MappedTopic | null
  lesson: MappedLesson | null
}

function extractTopicInputs(body: any): TopicInputs {
  const newsTopic = typeof body.news_topic === "string" ? body.news_topic.trim() : ""
  const lessonTopic = typeof body.lesson_topic === "string" ? body.lesson_topic.trim() : ""
  const newsTopicClarification = typeof body.news_topic_clarification === "string"
    ? body.news_topic_clarification.trim()
    : ""
  const lessonTopicClarification = typeof body.lesson_topic_clarification === "string"
    ? body.lesson_topic_clarification.trim()
    : ""

  return {
    newsTopic: newsTopic || null,
    lessonTopic: lessonTopic || null,
    newsTopicClarification: newsTopicClarification || null,
    lessonTopicClarification: lessonTopicClarification || null,
    lessonCurriculumPlan:
      body.lesson_curriculum_plan &&
      typeof body.lesson_curriculum_plan === "object" &&
      !Array.isArray(body.lesson_curriculum_plan)
        ? body.lesson_curriculum_plan
        : null
  }
}

function buildLessonMappingJson(
  mapped: MappedLesson | null,
  lessonCurriculumPlan: Record<string, any> | null
): Record<string, any> {
  const base = mapped ? { ...mapped } : {}
  if (lessonCurriculumPlan) {
    return {
      ...base,
      curriculum_plan: lessonCurriculumPlan
    }
  }
  return base
}

function extractJsonObject(text: string): any | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

async function mapTopicsWithLLM(input: {
  newsTopic: string | null
  lessonTopic: string | null
  newsTimeframe: string
  newsClarification: string | null
  lessonClarification: string | null
}): Promise<TopicMappingResult> {
  if (!OPENAI_API_KEY || (!input.newsTopic && !input.lessonTopic)) {
    return {
      news: input.newsTopic
        ? {
            normalized_topic: input.newsTopic,
            scope_summary: `Daily ${input.newsTimeframe} brief on ${input.newsTopic}.`,
            retrieval_queries: [input.newsTopic],
            required_terms: String(input.newsTopic)
              .split(/[^a-zA-Z0-9]+/)
              .filter((term) => term.length > 2)
              .slice(0, 4)
              .map((term) => [term])
          }
        : null,
      lesson: input.lessonTopic
        ? {
            normalized_topic: input.lessonTopic,
            curriculum_goal: `Build practical understanding of ${input.lessonTopic}.`,
            starting_level: "beginner"
          }
        : null
    }
  }

  const userPayload = {
    news_topic: input.newsTopic,
    lesson_topic: input.lessonTopic,
    news_timeframe: input.newsTimeframe,
    news_topic_clarification: input.newsClarification,
    lesson_topic_clarification: input.lessonClarification
  }

  const systemPrompt = `You map user-entered topics into structured config for a content product.
Return STRICT JSON only with this shape:
{
  "news": {
    "normalized_topic": "string",
    "scope_summary": "string",
    "retrieval_hint": "string",
    "retrieval_queries": ["string"],
    "required_terms": [["string"]]
  } | null,
  "lesson": {
    "normalized_topic": "string",
    "curriculum_goal": "string",
    "starting_level": "beginner" | "intermediate" | "advanced"
  } | null
}
Rules:
- Preserve user intent; do NOT broaden scope too much.
- Use clarification answers to sharpen scope, audience, and depth when provided.
- Keep phrasing concise and practical.
- For news topics, generate 3-5 retrieval_queries that search for the same scoped topic from different lexical angles without broadening scope. Include synonym expansions, abbreviations, and industry jargon. If you can identify relevant trade publications for the topic domain, include 1-2 site-scoped queries like "site:bisnow.com AI technology".
- For news topics, generate required_terms as AND-across-groups / OR-within-group keyword groups. Each group should represent one core dimension of the topic. Include abbreviations and synonyms within each OR group (e.g., ["AI", "artificial intelligence", "machine learning"] for the AI dimension). Keep groups concise.
- If source topic is null, return null for that object.
- No markdown, no prose outside JSON.`

  try {
    const res = await callOpenAIChatCompletion({
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) }
      ]
    })

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content || ""
    const parsed = extractJsonObject(content)
    if (!parsed) throw new Error("Invalid topic mapping JSON")

    const news = parsed.news && input.newsTopic
      ? {
          normalized_topic: String(parsed.news.normalized_topic || input.newsTopic),
          scope_summary: String(parsed.news.scope_summary || `Daily ${input.newsTimeframe} brief on ${input.newsTopic}.`),
          retrieval_hint: parsed.news.retrieval_hint ? String(parsed.news.retrieval_hint) : undefined,
          retrieval_queries: Array.isArray(parsed.news.retrieval_queries)
            ? parsed.news.retrieval_queries.map((value: any) => String(value || "").trim()).filter(Boolean).slice(0, 5)
            : [String(parsed.news.normalized_topic || input.newsTopic)],
          required_terms: Array.isArray(parsed.news.required_terms)
            ? parsed.news.required_terms
                .map((group: any) => Array.isArray(group)
                  ? group.map((value: any) => String(value || "").trim()).filter(Boolean).slice(0, 6)
                  : [])
                .filter((group: string[]) => group.length > 0)
                .slice(0, 4)
            : undefined
        }
      : null

    const lesson = parsed.lesson && input.lessonTopic
      ? {
          normalized_topic: String(parsed.lesson.normalized_topic || input.lessonTopic),
          curriculum_goal: String(parsed.lesson.curriculum_goal || `Build practical understanding of ${input.lessonTopic}.`),
          starting_level: ["beginner", "intermediate", "advanced"].includes(String(parsed.lesson.starting_level))
            ? (parsed.lesson.starting_level as "beginner" | "intermediate" | "advanced")
            : "beginner"
        }
      : null

    return { news, lesson }
  } catch (e) {
    console.warn("Topic mapping fallback:", e)
    return {
      news: input.newsTopic
        ? {
            normalized_topic: input.newsTopic,
            scope_summary: `Daily ${input.newsTimeframe} brief on ${input.newsTopic}.`,
            retrieval_queries: [input.newsTopic],
            required_terms: String(input.newsTopic)
              .split(/[^a-zA-Z0-9]+/)
              .filter((term) => term.length > 2)
              .slice(0, 4)
              .map((term) => [term])
          }
        : null,
      lesson: input.lessonTopic
        ? {
            normalized_topic: input.lessonTopic,
            curriculum_goal: `Build practical understanding of ${input.lessonTopic}.`,
            starting_level: "beginner"
          }
        : null
    }
  }
}

async function persistNewsTopic(
  userId: string,
  topic: string | null,
  timeframe: string,
  mapped: MappedTopic | null
): Promise<boolean> {
  try {
    // Keep single active topic for alpha.
    await supabaseServiceRole
      .from("user_news_topics")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("active", true)

    if (!topic) return true

    const withMappingAttempt = await supabaseServiceRole
      .from("user_news_topics")
      .insert({
        user_id: userId,
        topic_text: mapped?.normalized_topic || topic,
        topic_raw_text: topic,
        timeframe,
        topic_mapping_json: mapped || {},
        active: true
      })

    // Backward-compatible fallback for missing columns.
    if (withMappingAttempt.error) {
      const errorText = String(withMappingAttempt.error.message || "").toLowerCase()
      if (
        errorText.includes("timeframe") ||
        errorText.includes("topic_raw_text") ||
        errorText.includes("topic_mapping_json")
      ) {
        const withTimeframe = await supabaseServiceRole
          .from("user_news_topics")
          .insert({
            user_id: userId,
            topic_text: mapped?.normalized_topic || topic,
            timeframe,
            active: true
          })
        if (!withTimeframe.error) return true
      }

      const fallback = await supabaseServiceRole
        .from("user_news_topics")
        .insert({
          user_id: userId,
          topic_text: mapped?.normalized_topic || topic,
          active: true
        })
      return !fallback.error
    }

    return true
  } catch {
    return false
  }
}

async function persistLessonTopic(
  userId: string,
  topic: string | null,
  mapped: MappedLesson | null,
  lessonCurriculumPlan: Record<string, any> | null
): Promise<boolean> {
  try {
    // Keep single active topic for alpha.
    await supabaseServiceRole
      .from("user_lesson_topics")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("active", true)

    if (!topic) return true

    const withMappingAttempt = await supabaseServiceRole
      .from("user_lesson_topics")
      .insert({
        user_id: userId,
        topic_text: mapped?.normalized_topic || topic,
        topic_raw_text: topic,
        curriculum_goal: mapped?.curriculum_goal || null,
        starting_level: mapped?.starting_level || "beginner",
        topic_mapping_json: buildLessonMappingJson(mapped, lessonCurriculumPlan),
        active: true
      })

    if (withMappingAttempt.error) {
      const errorText = String(withMappingAttempt.error.message || "").toLowerCase()
      if (
        errorText.includes("topic_raw_text") ||
        errorText.includes("curriculum_goal") ||
        errorText.includes("starting_level") ||
        errorText.includes("topic_mapping_json")
      ) {
        const fallback = await supabaseServiceRole
          .from("user_lesson_topics")
          .insert({
            user_id: userId,
            topic_text: mapped?.normalized_topic || topic,
            active: true
          })
        return !fallback.error
      }
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * GET /api/digest/config
 * 
 * Returns the user's digest configuration, or null if not configured.
 */
export async function GET() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { data, error } = await supabaseServiceRole
      .from("digest_configs")
      .select("*")
      .eq("user_id", user.id)
      .single()

    if (error) {
      // If no rows found, that's okay - user hasn't configured yet
      if (error.code === "PGRST116") {
        return NextResponse.json({ ok: true, config: null })
      }
      throw error
    }

    const configWithDefaults = {
      ...data,
      module_flags: data?.module_flags || DEFAULT_MODULE_FLAGS,
      module_defaults: data?.module_defaults || DEFAULT_MODULE_DEFAULTS
    }

    return NextResponse.json({ ok: true, config: configWithDefaults })
  } catch (e: any) {
    console.error("Error fetching digest config:", e)
    return NextResponse.json({ 
      ok: false, 
      error: String(e.message || e) 
    }, { status: 500 })
  }
}

/**
 * POST /api/digest/config
 * 
 * Saves or updates the user's digest configuration.
 * Body: { cadence, send_time, timezone, style, rune_name? }
 */
export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { send_time, timezone, style, rune_name } = body

    // MVP lock: newsletter cadence is daily-only for closed alpha.
    const cadence = DAILY_ONLY_CADENCE
    const moduleFlags = {
      ...DEFAULT_MODULE_FLAGS,
      ...(body.module_flags || {}),
      // Keep newsletter digest enabled in this MVP pass.
      enable_newsletter_digest: true
    }
    const moduleDefaults = {
      ...DEFAULT_MODULE_DEFAULTS,
      ...(body.module_defaults || {})
    }
    const {
      newsTopic,
      lessonTopic,
      newsTopicClarification,
      lessonTopicClarification,
      lessonCurriculumPlan
    } = extractTopicInputs(body)

    if (moduleFlags.enable_daily_news_topics && !newsTopic) {
      return NextResponse.json({
        ok: false,
        error: "news_topic is required when daily news topics are enabled"
      }, { status: 400 })
    }

    if (moduleFlags.enable_daily_lessons && !lessonTopic) {
      return NextResponse.json({
        ok: false,
        error: "lesson_topic is required when daily lessons are enabled"
      }, { status: 400 })
    }

    // Validate required fields
    if (!send_time || !timezone || !style) {
      return NextResponse.json({ 
        ok: false, 
        error: "Missing required fields: send_time, timezone, style" 
      }, { status: 400 })
    }

    // Validate send_time array
    if (!Array.isArray(send_time) || send_time.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: "send_time must be a non-empty array" 
      }, { status: 400 })
    }

    // Daily-only lock means exactly one send time.
    if (send_time.length !== 1) {
      return NextResponse.json({ 
        ok: false, 
        error: "daily cadence requires exactly 1 send time" 
      }, { status: 400 })
    }

    // Validate style
    const validStyles = ['morning-brief', 'deep-read', 'reference-mode']
    if (!validStyles.includes(style)) {
      return NextResponse.json({ 
        ok: false, 
        error: `Invalid style. Must be one of: ${validStyles.join(', ')}` 
      }, { status: 400 })
    }

    // Validate timezone (basic check - should be IANA timezone)
    if (typeof timezone !== 'string' || timezone.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: "timezone must be a non-empty string" 
      }, { status: 400 })
    }

    // Prepare upsert data
    const now = new Date().toISOString()
    const configDataBase = {
      user_id: user.id,
      cadence,
      send_time,
      timezone,
      style,
      rune_name: rune_name || null,
      updated_at: now
    }

    let moduleFlagsPersisted = true
    let moduleDefaultsPersisted = true
    let upsertData: any = null
    let upsertError: any = null

    // Try to persist module_flags if column exists.
    const withModuleFlags = {
      ...configDataBase,
      module_flags: moduleFlags,
      module_defaults: moduleDefaults
    }

    const firstAttempt = await supabaseServiceRole
      .from("digest_configs")
      .upsert(withModuleFlags, {
        onConflict: "user_id",
        ignoreDuplicates: false
      })
      .select()
      .single()

    upsertData = firstAttempt.data
    upsertError = firstAttempt.error

    // Graceful fallback for environments where module_flags column is not migrated yet.
    if (
      upsertError &&
      (
        String(upsertError.message || "").toLowerCase().includes("module_flags") ||
        String(upsertError.message || "").toLowerCase().includes("module_defaults")
      )
    ) {
      moduleFlagsPersisted = false
      moduleDefaultsPersisted = false
      const fallbackAttempt = await supabaseServiceRole
        .from("digest_configs")
        .upsert(configDataBase, {
          onConflict: "user_id",
          ignoreDuplicates: false
        })
        .select()
        .single()
      upsertData = fallbackAttempt.data
      upsertError = fallbackAttempt.error
    }

    if (upsertError) {
      console.error("Error upserting digest config:", upsertError)
      return NextResponse.json({
        ok: false,
        error: `Failed to save config: ${upsertError.message}`
      }, { status: 500 })
    }

    // Persist topic inputs (single active topic per module in alpha).
    const topicMappings = await mapTopicsWithLLM({
      newsTopic: moduleFlags.enable_daily_news_topics ? newsTopic : null,
      lessonTopic: moduleFlags.enable_daily_lessons ? lessonTopic : null,
      newsTimeframe: String(moduleDefaults.news_topic_timeframe || "24h"),
      newsClarification: moduleFlags.enable_daily_news_topics ? newsTopicClarification : null,
      lessonClarification: moduleFlags.enable_daily_lessons ? lessonTopicClarification : null
    })

    const newsTopicPersisted = await persistNewsTopic(
      user.id,
      moduleFlags.enable_daily_news_topics ? newsTopic : null,
      String(moduleDefaults.news_topic_timeframe || "24h"),
      topicMappings.news
    )
    const lessonTopicPersisted = await persistLessonTopic(
      user.id,
      moduleFlags.enable_daily_lessons ? lessonTopic : null,
      topicMappings.lesson,
      moduleFlags.enable_daily_lessons ? lessonCurriculumPlan : null
    )

    if (moduleFlags.enable_daily_news_topics && !newsTopicPersisted) {
      return NextResponse.json({
        ok: false,
        error: "Failed to persist daily news topic. Check user_news_topics migration."
      }, { status: 500 })
    }

    if (moduleFlags.enable_daily_lessons && !lessonTopicPersisted) {
      return NextResponse.json({
        ok: false,
        error: "Failed to persist daily lesson topic. Check user_lesson_topics migration."
      }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      config: {
        ...upsertData,
        module_flags: upsertData?.module_flags || moduleFlags,
        module_defaults: upsertData?.module_defaults || moduleDefaults
      },
      module_flags: moduleFlags,
      module_defaults: moduleDefaults,
      module_flags_persisted: moduleFlagsPersisted,
      module_defaults_persisted: moduleDefaultsPersisted,
      topic_inputs: {
        news_topic: newsTopic,
        lesson_topic: lessonTopic,
        news_topic_clarification: newsTopicClarification,
        lesson_topic_clarification: lessonTopicClarification,
        lesson_curriculum_plan: lessonCurriculumPlan
      },
      topic_mappings: topicMappings,
      topic_inputs_persisted: {
        news_topic: newsTopicPersisted,
        lesson_topic: lessonTopicPersisted
      },
      cadence_locked: DAILY_ONLY_CADENCE,
      message: "Digest configuration saved successfully"
    })

  } catch (e: any) {
    console.error("Error saving digest config:", e)
    
    // Handle JSON parse errors
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
