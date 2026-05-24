import { describe, expect, it } from "vitest"
import { extractJsonObject, redactLlmRawOutput } from "@/lib/ai/json"
import { lessonCurriculumSchema } from "@/lib/ai/schemas/lesson-curriculum"

function validCurriculum() {
  return {
    curriculum_title: "10-day curriculum: Test Topic",
    target_level: "Beginner",
    day_count: "10",
    days: Array.from({ length: 10 }).map((_, index) => ({
      day: index + 1,
      lesson_title: `Lesson ${index + 1}`,
      objective: `Understand concept ${index + 1}`,
      key_points: ["Core idea", "Practical implication"]
    })),
    completion_signal: "Can explain the topic clearly."
  }
}

describe("LLM gateway helpers", () => {
  it("extracts a JSON object from fenced model output", () => {
    expect(extractJsonObject("```json\n{\"ok\":true}\n```")).toEqual({ ok: true })
  })

  it("redacts sensitive fields before raw-output capture", () => {
    const redacted = redactLlmRawOutput("email pedro@example.com access_token=secret123")
    expect(redacted).toContain("[email]")
    expect(redacted).toContain("access_token:[redacted]")
    expect(redacted).not.toContain("secret123")
  })
})

describe("lessonCurriculumSchema", () => {
  it("accepts a complete 10-day curriculum and normalizes coercible fields", () => {
    const parsed = lessonCurriculumSchema.parse(validCurriculum())
    expect(parsed.target_level).toBe("beginner")
    expect(parsed.day_count).toBe(10)
    expect(parsed.days).toHaveLength(10)
  })

  it("rejects incomplete curricula", () => {
    const invalid = validCurriculum()
    invalid.days = invalid.days.slice(0, 9)
    expect(() => lessonCurriculumSchema.parse(invalid)).toThrow()
  })
})
