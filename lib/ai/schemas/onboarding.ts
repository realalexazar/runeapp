import { z } from "zod"

const nonEmptyString = z.string().trim().min(1)

export const newsTopicClarifierSchema = z.object({
  assistant_message: nonEmptyString,
  done: z.coerce.boolean(),
  news_scope: z.string().trim().min(1).nullable()
}).superRefine((value, ctx) => {
  if (!value.done && value.news_scope !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["news_scope"],
      message: "news_scope must be null when done is false"
    })
  }
  if (value.done && !value.news_scope) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["news_scope"],
      message: "news_scope is required when done is true"
    })
  }
})

export const lessonTopicClarifierSchema = z.object({
  assistant_message: nonEmptyString,
  done: z.coerce.boolean(),
  lesson_scope: z.string().trim().min(1).nullable()
}).superRefine((value, ctx) => {
  if (!value.done && value.lesson_scope !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lesson_scope"],
      message: "lesson_scope must be null when done is false"
    })
  }
  if (value.done && !value.lesson_scope) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lesson_scope"],
      message: "lesson_scope is required when done is true"
    })
  }
})

export const inboxSenderRelevanceSchema = z.object({
  senders: z.array(z.object({
    address: nonEmptyString,
    content_type: nonEmptyString,
    relevance_score: z.coerce.number().min(0).max(1),
    relevance_reason: z.string().trim().default("")
  }))
})

const mappedNewsTopicSchema = z.object({
  normalized_topic: nonEmptyString,
  scope_summary: nonEmptyString,
  retrieval_hint: z.string().trim().min(1).optional(),
  retrieval_queries: z.array(nonEmptyString).optional(),
  required_terms: z.array(z.array(nonEmptyString).min(1)).optional()
})

const mappedLessonTopicSchema = z.object({
  normalized_topic: nonEmptyString,
  curriculum_goal: nonEmptyString,
  starting_level: z.preprocess(
    (value) => String(value || "").toLowerCase(),
    z.enum(["beginner", "intermediate", "advanced"])
  )
})

export const topicMappingResultSchema = z.object({
  news: mappedNewsTopicSchema.nullable(),
  lesson: mappedLessonTopicSchema.nullable()
})

export type NewsTopicClarifier = z.infer<typeof newsTopicClarifierSchema>
export type LessonTopicClarifier = z.infer<typeof lessonTopicClarifierSchema>
export type InboxSenderRelevance = z.infer<typeof inboxSenderRelevanceSchema>
export type TopicMappingResultSchema = z.infer<typeof topicMappingResultSchema>
