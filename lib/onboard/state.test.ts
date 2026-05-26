import { describe, expect, it } from "vitest"
import {
  evaluateMinimumIntentGate,
  inferInboxPreference,
  isMeaningfulFocus,
  recommendationToCards,
} from "@/lib/onboard/state"

const meaningfulIntent = {
  professional_context: "The user invests in commercial real estate.",
  inferred_expertise_level: "senior",
  occupation_interests: ["commercial real estate distress in Florida"],
  free_interest: null,
  learning_topic: {
    topic: null,
    starting_level: null,
    goal: null,
  },
  inbox_preferences: {
    wants_inbox_curation: false,
    email_types_wanted: [],
    notes: "Skip inbox for now.",
  },
}

describe("onboarding minimum intent gate", () => {
  it("rejects generic focus words", () => {
    expect(isMeaningfulFocus("AI")).toBe(false)
    expect(isMeaningfulFocus("technology")).toBe(false)
    expect(isMeaningfulFocus("commercial real estate distress in Florida")).toBe(true)
  })

  it("passes when a concrete focus and inbox preference are present", () => {
    const gate = evaluateMinimumIntentGate(meaningfulIntent, "not_wanted")

    expect(gate.passed).toBe(true)
    expect(gate.missing_fields).toEqual([])
  })

  it("asks for an inbox preference when intent leaves inbox unknown", () => {
    const gate = evaluateMinimumIntentGate({
      ...meaningfulIntent,
      inbox_preferences: { wants_inbox_curation: null },
    }, "unknown")

    expect(gate.passed).toBe(false)
    expect(gate.missing_fields).toContain("inbox_preference")
  })

  it("infers wanted, not wanted, and unknown inbox preferences", () => {
    expect(inferInboxPreference({ inbox_preferences: { wants_inbox_curation: true } })).toBe("wanted")
    expect(inferInboxPreference({ inbox_preferences: { wants_inbox_curation: false } })).toBe("not_wanted")
    expect(inferInboxPreference({ inbox_preferences: {} })).toBe("unknown")
  })
})

describe("recommendation card projection", () => {
  it("creates valid news, lesson, inbox, and delivery cards from a typed recommendation", () => {
    const cards = recommendationToCards("rune-1", {
      slot_allocation: [
        {
          slot: 1,
          type: "news",
          focus: "commercial real estate distress in Florida",
          scope_summary: "Track distressed CRE signals across Florida lenders, owners, and courts.",
          retrieval_queries: ["Florida commercial real estate distress"],
          required_terms: [["Florida"], ["distress", "foreclosure", "default"]],
          rationale: "Matches the user's investment focus.",
        },
        {
          slot: 2,
          type: "lesson",
          focus: "monetary policy transmission for real estate investors",
          starting_level: "intermediate",
          curriculum_goal: "Understand how rates affect cap rates, credit, and transaction volume.",
          rationale: "Builds the user's analytical base.",
        },
        {
          slot: 3,
          type: "email",
          focus: "Inbox updates",
          priority_senders: ["research@example.com"],
          rationale: "Useful recurring research.",
        },
      ],
      inbox_curation_plan: {
        email_types_to_surface: ["market research"],
        gap_note: "",
      },
      user_facing_summary: ["A focused CRE morning read."],
    }, 3)

    expect(cards.map((card) => card.type)).toEqual(["news", "lesson", "inbox", "delivery"])
    expect(cards.every((card) => card.status === "valid")).toBe(true)
    expect(cards.every((card) => card.rune_id === "rune-1")).toBe(true)
    expect(cards.every((card) => card.config_version === 3)).toBe(true)
  })

  it("marks cards invalid when required hidden retrieval fields are missing", () => {
    const cards = recommendationToCards("rune-1", {
      slot_allocation: [
        {
          slot: 1,
          type: "news",
          focus: "AI",
          scope_summary: "",
          retrieval_queries: [],
          required_terms: [],
        },
      ],
    }, 1)

    const newsCard = cards.find((card) => card.type === "news")
    expect(newsCard?.status).toBe("invalid")
    expect(newsCard?.validation_errors).toEqual([
      "focus must be specific",
      "scope_summary is required",
      "retrieval_queries are required",
      "required_terms are required",
    ])
  })
})
