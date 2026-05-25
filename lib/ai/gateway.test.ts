import { describe, expect, it } from "vitest"
import { extractJsonObject, redactLlmRawOutput } from "@/lib/ai/json"
import { lessonCurriculumSchema } from "@/lib/ai/schemas/lesson-curriculum"
import {
  inboxSenderRelevanceSchema,
  lessonTopicClarifierSchema,
  newsTopicClarifierSchema,
  topicMappingResultSchema,
} from "@/lib/ai/schemas/onboarding"

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

describe("onboarding LLM schemas", () => {
  it("enforces clarifier completion contracts", () => {
    expect(newsTopicClarifierSchema.parse({
      assistant_message: "Got it.",
      done: true,
      news_scope: "Daily updates on AI regulation."
    }).done).toBe(true)

    expect(() => lessonTopicClarifierSchema.parse({
      assistant_message: "What outcome do you want?",
      done: false,
      lesson_scope: "not allowed yet"
    })).toThrow()
  })

  it("normalizes sender relevance scores", () => {
    const parsed = inboxSenderRelevanceSchema.parse({
      senders: [{
        address: "sender@example.com",
        content_type: "market news",
        relevance_score: "0.8",
        relevance_reason: "Matches the user's stated interest."
      }]
    })

    expect(parsed.senders[0].relevance_score).toBe(0.8)
  })

  it("accepts nullable topic mapping branches", () => {
    const parsed = topicMappingResultSchema.parse({
      news: {
        normalized_topic: "AI regulation",
        scope_summary: "Daily updates on AI policy.",
        retrieval_queries: ["AI regulation"],
        required_terms: [["AI", "artificial intelligence"], ["regulation"]]
      },
      lesson: null
    })

    expect(parsed.news?.required_terms?.[0]).toContain("AI")
    expect(parsed.lesson).toBeNull()
  })
})
