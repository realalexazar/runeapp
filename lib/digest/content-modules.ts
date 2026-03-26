import { supabaseServiceRole } from "@/lib/supabase/service"

export type ModuleType = "newsletter" | "news_topics" | "lessons"
export type RunStatus = "pending" | "running" | "completed" | "failed"

export type ModuleFlags = {
  enable_newsletter_digest: boolean
  enable_daily_news_topics: boolean
  enable_daily_lessons: boolean
}

export type ModuleDefaults = {
  news_topic_timeframe: string
  lesson_frequency: string
  lesson_curriculum_days: number
}

export type LessonStateStatus = "active" | "paused" | "completed"

export type LessonState = {
  status: LessonStateStatus
  next_day: number
  last_generated_date?: string | null
  paused_at?: string | null
  completed_at?: string | null
}

export const DEFAULT_MODULE_FLAGS: ModuleFlags = {
  enable_newsletter_digest: true,
  enable_daily_news_topics: false,
  enable_daily_lessons: false
}

export const DEFAULT_MODULE_DEFAULTS: ModuleDefaults = {
  news_topic_timeframe: "24h",
  lesson_frequency: "daily",
  lesson_curriculum_days: 10
}

/**
 * Returns module flags/defaults for a user with safe fallbacks.
 */
export async function getUserModuleConfig(userId: string): Promise<{
  moduleFlags: ModuleFlags
  moduleDefaults: ModuleDefaults
}> {
  const { data, error } = await supabaseServiceRole
    .from("digest_configs")
    .select("module_flags, module_defaults")
    .eq("user_id", userId)
    .single()

  if (error || !data) {
    return {
      moduleFlags: DEFAULT_MODULE_FLAGS,
      moduleDefaults: DEFAULT_MODULE_DEFAULTS
    }
  }

  return {
    moduleFlags: {
      ...DEFAULT_MODULE_FLAGS,
      ...(data.module_flags || {})
    },
    moduleDefaults: {
      ...DEFAULT_MODULE_DEFAULTS,
      ...(data.module_defaults || {})
    }
  }
}

/**
 * Query path for active daily-news topics by user.
 */
export async function getActiveNewsTopics(userId: string): Promise<Array<{
  id: string
  topic_text: string
  timeframe: string | null
}>> {
  const { data, error } = await supabaseServiceRole
    .from("user_news_topics")
    .select("id, topic_text, timeframe")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("Error fetching active news topics:", error)
    return []
  }

  return data || []
}

/**
 * Query path for active lesson topics by user.
 */
export async function getActiveLessonTopics(userId: string): Promise<Array<{
  id: string
  topic_text: string
}>> {
  const { data, error } = await supabaseServiceRole
    .from("user_lesson_topics")
    .select("id, topic_text")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("Error fetching active lesson topics:", error)
    return []
  }

  return data || []
}

export async function getLessonTopicById(input: {
  userId: string
  topicId: string
}): Promise<{
  id: string
  topic_text: string
  active: boolean
  topic_mapping_json: Record<string, any> | null
} | null> {
  const { data, error } = await supabaseServiceRole
    .from("user_lesson_topics")
    .select("id, topic_text, active, topic_mapping_json")
    .eq("user_id", input.userId)
    .eq("id", input.topicId)
    .maybeSingle()

  if (error) {
    console.error("Error fetching lesson topic by id:", error)
    return null
  }

  return data || null
}

export function getLessonStateFromMapping(mapping: Record<string, any> | null | undefined): LessonState {
  const raw = (mapping?.lesson_state || {}) as Partial<LessonState>
  const status = raw.status === "paused" || raw.status === "completed" ? raw.status : "active"
  const nextDay = Number(raw.next_day || 1)
  return {
    status,
    next_day: Number.isFinite(nextDay) && nextDay > 0 ? nextDay : 1,
    last_generated_date: raw.last_generated_date || null,
    paused_at: raw.paused_at || null,
    completed_at: raw.completed_at || null
  }
}

export async function updateLessonTopicMapping(input: {
  userId: string
  topicId: string
  updater: (current: Record<string, any>) => Record<string, any>
}): Promise<boolean> {
  const current = await getLessonTopicById({ userId: input.userId, topicId: input.topicId })
  if (!current) return false

  const currentMapping = (current.topic_mapping_json || {}) as Record<string, any>
  const nextMapping = input.updater(currentMapping)

  const { error } = await supabaseServiceRole
    .from("user_lesson_topics")
    .update({
      topic_mapping_json: nextMapping,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", input.userId)
    .eq("id", input.topicId)

  if (error) {
    console.error("Error updating lesson topic mapping:", error)
    return false
  }

  return true
}

export async function setLessonState(input: {
  userId: string
  topicId: string
  state: LessonState
  active?: boolean
}): Promise<boolean> {
  const current = await getLessonTopicById({ userId: input.userId, topicId: input.topicId })
  if (!current) return false

  const currentMapping = (current.topic_mapping_json || {}) as Record<string, any>
  const nextMapping = {
    ...currentMapping,
    lesson_state: input.state
  }

  const updatePayload: Record<string, any> = {
    topic_mapping_json: nextMapping,
    updated_at: new Date().toISOString()
  }

  if (typeof input.active === "boolean") {
    updatePayload.active = input.active
  }

  const { error } = await supabaseServiceRole
    .from("user_lesson_topics")
    .update(updatePayload)
    .eq("user_id", input.userId)
    .eq("id", input.topicId)

  if (error) {
    console.error("Error setting lesson state:", error)
    return false
  }

  return true
}

export async function switchActiveLessonTopic(input: {
  userId: string
  fromTopicId: string
  toTopicId: string
}): Promise<boolean> {
  const fromTopic = await getLessonTopicById({ userId: input.userId, topicId: input.fromTopicId })
  const toTopic = await getLessonTopicById({ userId: input.userId, topicId: input.toTopicId })
  if (!fromTopic || !toTopic) return false

  const now = new Date().toISOString()
  const fromState = getLessonStateFromMapping(fromTopic.topic_mapping_json)
  const toState = getLessonStateFromMapping(toTopic.topic_mapping_json)

  const deactivate = await supabaseServiceRole
    .from("user_lesson_topics")
    .update({
      active: false,
      topic_mapping_json: {
        ...(fromTopic.topic_mapping_json || {}),
        lesson_state: {
          ...fromState,
          status: "paused",
          paused_at: now
        }
      },
      updated_at: now
    })
    .eq("user_id", input.userId)
    .eq("id", input.fromTopicId)

  if (deactivate.error) {
    console.error("Error deactivating lesson topic:", deactivate.error)
    return false
  }

  const activate = await supabaseServiceRole
    .from("user_lesson_topics")
    .update({
      active: true,
      topic_mapping_json: {
        ...(toTopic.topic_mapping_json || {}),
        lesson_state: {
          ...toState,
          status: "active",
          paused_at: null
        }
      },
      updated_at: now
    })
    .eq("user_id", input.userId)
    .eq("id", input.toTopicId)

  if (activate.error) {
    console.error("Error activating lesson topic:", activate.error)
    return false
  }

  return true
}

/**
 * Creates a module run record for observability and retries.
 */
export async function createGeneratedContentRun(input: {
  userId: string
  module: ModuleType
  status?: RunStatus
}): Promise<string | null> {
  const { data, error } = await supabaseServiceRole
    .from("generated_content_runs")
    .insert({
      user_id: input.userId,
      module: input.module,
      status: input.status || "running",
      started_at: new Date().toISOString()
    })
    .select("id")
    .single()

  if (error) {
    console.error("Error creating generated content run:", error)
    return null
  }

  return data?.id || null
}

/**
 * Finalizes a module run record.
 */
export async function finalizeGeneratedContentRun(input: {
  runId: string
  status: Exclude<RunStatus, "pending" | "running">
  errorMessage?: string | null
}): Promise<void> {
  const { error } = await supabaseServiceRole
    .from("generated_content_runs")
    .update({
      status: input.status,
      error: input.errorMessage || null,
      finished_at: new Date().toISOString()
    })
    .eq("id", input.runId)

  if (error) {
    console.error("Error finalizing generated content run:", error)
  }
}

/**
 * Stores generated item payloads by user/module/date/topic.
 */
export async function upsertGeneratedContentItem(input: {
  userId: string
  module: ModuleType
  topicId?: string | null
  generatedDate: string // yyyy-mm-dd
  title: string
  content: string
  metadata?: Record<string, any> | null
}): Promise<void> {
  const topicId = input.topicId || "__none__"

  const { error } = await supabaseServiceRole
    .from("generated_content_items")
    .upsert({
      user_id: input.userId,
      module: input.module,
      topic_id: topicId,
      generated_date: input.generatedDate,
      title: input.title,
      content: input.content,
      metadata: input.metadata || {},
      updated_at: new Date().toISOString()
    }, {
      onConflict: "user_id,module,topic_id,generated_date",
      ignoreDuplicates: false
    })

  if (error) {
    console.error("Error upserting generated content item:", error)
  }
}

