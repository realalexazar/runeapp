import { z } from "zod"

const nonEmptyString = z.string().trim().min(1)

export const lessonCurriculumSchema = z.object({
  curriculum_title: nonEmptyString,
  target_level: z.preprocess(
    (value) => String(value || "").toLowerCase(),
    z.enum(["beginner", "intermediate", "advanced"])
  ),
  day_count: z.coerce.number().int().refine((value) => value === 10, "day_count must be 10"),
  days: z.array(z.object({
    day: z.coerce.number().int().min(1).max(10),
    lesson_title: nonEmptyString,
    objective: nonEmptyString,
    key_points: z.array(nonEmptyString).min(2).max(6)
  })).length(10),
  completion_signal: nonEmptyString
}).superRefine((value, ctx) => {
  const seen = new Set<number>()
  for (const day of value.days) {
    if (seen.has(day.day)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["days"],
        message: `Duplicate day ${day.day}`
      })
    }
    seen.add(day.day)
  }

  for (let day = 1; day <= 10; day++) {
    if (!seen.has(day)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["days"],
        message: `Missing day ${day}`
      })
    }
  }
})

export type LessonCurriculum = z.infer<typeof lessonCurriculumSchema>
