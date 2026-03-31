import { callOpenAIChatCompletion } from "@/lib/openai/chat"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const CURRICULUM_PROMPT = `You are Rune's curriculum architect. You already know something about every topic - use that.

You receive a lesson_scope string that's already been clarified with the user. Your job: design a 10-day curriculum outline that a downstream lesson-writer LLM will use to generate each daily lesson.

INPUT: A single lesson_scope string containing the topic, level, day-10 outcome, and domain constraints.

OUTPUT: Return ONLY valid JSON (no markdown, no code fences) with this shape:

{
  "curriculum_title": "string",
  "target_level": "beginner|intermediate|advanced",
  "day_count": 10,
  "days": [
    { "day": 1, "lesson_title": "string", "objective": "string", "key_points": ["string"] }
  ],
  "completion_signal": "string"
}

RULES:
- days.length must be 10, numbered 1-10.
- No nulls, empty strings, or placeholders.
- key_points: 2-4 per day.
- Day 10 must deliver the outcome promised in the scope. Work backward from there.
- A good lesson_title tells you what the day is about without reading anything else.
- A good objective starts with a verb and describes a capability.
- Good key_points contain concrete claims, relationships, or techniques — not topic headers.
- Do not broaden beyond the sub-domain in the scope.`

function extractJsonObject(text: string): any | null {
  const trimmed = text.trim()
  try { return JSON.parse(trimmed) } catch {}
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)) } catch {}
  }
  return null
}

function fallbackCurriculum(topic: string, goal: string | null) {
  const days = Array.from({ length: 10 }).map((_, i) => ({
    day: i + 1,
    lesson_title: `Day ${i + 1}: ${topic}`,
    objective: `Build understanding of ${topic} through focused exploration on day ${i + 1}.`,
    key_points: [`Core concept for ${topic}`, "Practical implication"]
  }))

  return {
    curriculum_title: `10-day curriculum: ${topic}`,
    target_level: "beginner" as const,
    day_count: 10,
    days,
    completion_signal: goal || `Foundational understanding of ${topic}.`
  }
}

export async function generateCurriculumPlan(input: {
  topic: string
  startingLevel: string
  curriculumGoal: string | null
  scopeSummary: string | null
}) {
  if (!OPENAI_API_KEY) {
    return fallbackCurriculum(input.topic, input.curriculumGoal)
  }

  const scope = [
    `Topic: ${input.topic}`,
    `Level: ${input.startingLevel}`,
    input.curriculumGoal ? `Day-10 outcome: ${input.curriculumGoal}` : null,
    input.scopeSummary ? `Scope: ${input.scopeSummary}` : null,
  ].filter(Boolean).join(". ")

  try {
    const resp = await callOpenAIChatCompletion({
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o",
      temperature: 0.2,
      messages: [
        { role: "system", content: CURRICULUM_PROMPT },
        { role: "user", content: JSON.stringify({ lesson_topic: input.topic, lesson_scope: scope, curriculum_days: 10 }) }
      ]
    })

    const data = await resp.json()
    const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || "")
    if (parsed && Array.isArray(parsed.days) && parsed.days.length > 0) {
      return parsed
    }
  } catch (e) {
    console.error(`Curriculum generation failed for "${input.topic}":`, e)
  }

  return fallbackCurriculum(input.topic, input.curriculumGoal)
}
