import { z } from "zod"

const nonEmptyString = z.string().trim().min(1)

export const newsletterSummaryMapSchema = z.record(nonEmptyString, nonEmptyString)

export const dailyLessonContentSchema = z.object({
  title: nonEmptyString,
  content: nonEmptyString
})

export const newsReferenceSchema = z.object({
  title: nonEmptyString,
  url: nonEmptyString,
  source: nonEmptyString
})

export const unifiedNewsBriefSchema = z.object({
  relevant_indexes: z.array(z.coerce.number().int().min(0)).default([]),
  title: nonEmptyString.optional(),
  content: nonEmptyString,
  references: z.array(newsReferenceSchema).default([]),
  articles_used: z.coerce.number().int().min(0).optional()
})

export const newsRelevanceEvaluationsSchema = z.object({
  evaluations: z.array(z.object({
    index: z.coerce.number().int().min(0),
    relevant: z.coerce.boolean(),
    confidence: z.coerce.number().min(0).max(1),
    reason: z.string().trim().default("")
  }))
})

export type NewsletterSummaryMap = z.infer<typeof newsletterSummaryMapSchema>
export type DailyLessonContent = z.infer<typeof dailyLessonContentSchema>
export type UnifiedNewsBrief = z.infer<typeof unifiedNewsBriefSchema>
export type NewsRelevanceEvaluations = z.infer<typeof newsRelevanceEvaluationsSchema>
