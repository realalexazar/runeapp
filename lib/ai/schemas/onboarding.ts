import { z } from "zod"

const nonEmptyString = z.string().trim().min(1)

export const inboxSenderRelevanceSchema = z.object({
  senders: z.array(z.object({
    address: nonEmptyString,
    content_type: nonEmptyString,
    relevance_score: z.coerce.number().min(0).max(1),
    relevance_reason: z.string().trim().default("")
  }))
})

const slotTypeSchema = z.preprocess(
  (value) => String(value || "").trim().toLowerCase(),
  z.enum(["email", "news", "lesson"])
)

const technicalConfigSlotSchema = z.object({
  slot: z.coerce.number().int().min(1),
  type: slotTypeSchema,
  focus: nonEmptyString,
  rationale: z.string().trim().optional(),
  priority_senders: z.array(nonEmptyString).optional().default([]),
  retrieval_queries: z.array(nonEmptyString).optional().default([]),
  required_terms: z.array(z.array(nonEmptyString).min(1)).optional().default([]),
  scope_summary: z.string().trim().optional(),
  tracked_entities: z.array(nonEmptyString).optional().default([]),
  starting_level: z.string().trim().optional(),
  curriculum_goal: z.string().trim().optional()
}).passthrough()

export const onboardTechnicalConfigSchema = z.object({
  slot_allocation: z.array(technicalConfigSlotSchema),
  allocation_notes: z.string().trim().default(""),
  inbox_curation_plan: z.object({
    priority_senders: z.array(nonEmptyString).optional().default([]),
    email_types_to_surface: z.array(nonEmptyString).optional().default([]),
    gap_note: z.string().trim().default("")
  }).passthrough().default({
    priority_senders: [],
    email_types_to_surface: [],
    gap_note: ""
  })
}).passthrough()

const expertiseLevelSchema = z.preprocess(
  (value) => String(value || "").trim().toLowerCase(),
  z.enum(["junior", "mid", "senior"])
)

const nullableTrimmedString = z.preprocess((value) => {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  if (!trimmed || trimmed.toLowerCase() === "null") return null
  return trimmed
}, z.string().min(1).nullable())

export const onboardIntentSignalSchema = z.object({
  intent_ready: z.literal(true),
  professional_context: nonEmptyString,
  inferred_expertise_level: expertiseLevelSchema,
  occupation_interests: z.array(nonEmptyString).default([]),
  free_interest: nullableTrimmedString.default(null),
  learning_topic: z.object({
    topic: nullableTrimmedString.default(null),
    starting_level: nullableTrimmedString.default(null),
    goal: nullableTrimmedString.default(null)
  }).default({
    topic: null,
    starting_level: null,
    goal: null
  }),
  inbox_preferences: z.object({
    wants_inbox_curation: z.coerce.boolean(),
    email_types_wanted: z.array(nonEmptyString).default([]),
    notes: z.string().trim().default("")
  })
})

export const onboardConversationTurnSchema = z.object({
  rune_message: nonEmptyString,
  intent: onboardIntentSignalSchema.nullable().default(null)
})

export const onboardRecommendationSignalSchema = z.object({
  recommendation_ready: z.literal(true),
  user_facing_summary: z.array(nonEmptyString).default([])
})

export const onboardRecommendationTurnSchema = z.object({
  rune_message: nonEmptyString,
  recommendation: onboardRecommendationSignalSchema.nullable().default(null)
})

export const onboardOpeningMessageSchema = z.object({
  rune_message: nonEmptyString
})

export const onboardingRefinementPatchSchema = z.object({
  summary: nonEmptyString,
  operations: z.array(z.object({
    op: z.literal("update_card"),
    card_id: nonEmptyString,
    fields: z.record(z.unknown()).default({})
  })).default([]),
  clarifying_question: z.string().trim().optional().nullable()
}).superRefine((value, ctx) => {
  if (value.operations.length === 0 && !value.clarifying_question) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["operations"],
      message: "operations or clarifying_question is required"
    })
  }
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

export type InboxSenderRelevance = z.infer<typeof inboxSenderRelevanceSchema>
export type OnboardTechnicalConfig = z.infer<typeof onboardTechnicalConfigSchema>
export type OnboardIntentSignal = z.infer<typeof onboardIntentSignalSchema>
export type OnboardRecommendationSignal = z.infer<typeof onboardRecommendationSignalSchema>
export type OnboardingRefinementPatch = z.infer<typeof onboardingRefinementPatchSchema>
export type TopicMappingResultSchema = z.infer<typeof topicMappingResultSchema>
