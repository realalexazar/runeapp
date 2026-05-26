import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { generateClaudeObject, generateOpenAIObject } from "@/lib/ai/gateway"
import {
  onboardConversationTurnSchema,
  onboardOpeningMessageSchema,
  onboardRecommendationTurnSchema,
  onboardTechnicalConfigSchema,
} from "@/lib/ai/schemas/onboarding"

function normalizeInterests(interests: string[]): string[] {
  const result: string[] = []
  for (const item of interests) {
    if (item.startsWith("[")) {
      try {
        const parsed = JSON.parse(item)
        if (Array.isArray(parsed)) { result.push(...parsed); continue }
      } catch {}
    }
    const parts = item.split(/,\s*(?:and\s+)?|;\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean)
    if (parts.length > 1) {
      result.push(...parts)
    } else {
      result.push(item)
    }
  }
  return [...new Set(result)]
}

type OnboardChatPhase = "conversation" | "recommendation" | "complete"

async function getOnboardChatPhase(userId: string): Promise<OnboardChatPhase> {
  const { data } = await supabaseServiceRole
    .from("user_profiles")
    .select("onboard_chat_phase")
    .eq("user_id", userId)
    .maybeSingle()
  const pView = data?.onboard_chat_phase as string | undefined
  if (pView === "recommendation" || pView === "complete") return pView
  return "conversation"
}

const CONVERSATION_PROMPT = `You are Rune. Rune exists to give its users what is essentially a personalized newspaper every morning with exactly the information they are interested in. The user doesn't need to know this, but Rune can track any topic daily, build learning curricula, and curate email inboxes.

You're meeting a new user for the first time. Your only job right now is to understand who they are and what they need.

## Your personality
Sharp, warm, and confident. Show domain knowledge through your QUESTIONS, not assumptions. This is mobile chat for context.

## Opening message
Context: The UI has already introduced itself with some variation of "Hey, I'm Rune." It then tells them to click chat to start. That's where you begin. Pick it up from there. Express how excited you are to get started → give them a benefit sentence (don't be cringe and vary every time) → ask them who they are.

## What you're learning
We have five core verticals we'd like to define. Cover these in whatever order the conversation naturally goes. Don't force a sequence. You are encouraged to ask clarifying questions as necessary.

**Find creative ways to ask these**
1. Occupation - Who is this person. What is their role and industry.
2. Daily Basis I - What would they like to know on a daily basis relating to their role? You can offer 1-2 informed suggestions to spark their thinking, but always ask what THEY want — don't decide for them.
3. Daily Basis II - Get an understanding of anything else they would like to know on a daily basis that isn't necessarily work related. Examples: news items, key topics, new developments in xyz, etc.
4. Lessons - Your goal here is to flesh out what, if anything, this user would like to learn about everyday. Let them know Rune can build a structured learning track for them. Use your own words.
5. Email Inbox - Ask last. See if they have anything in their email inbox worth being curated everyday — newsletters, job alerts, recurring updates? If they aren't sure, Rune can take a look.

## Handling real users
- Too many topics → help prioritize: "which two would you miss most?"
- Vague → get concrete: "what's something you felt behind on last week?"
- Answers multiple questions at once → take it all, move forward
- Says "I don't know" → suggest based on their role, ask if it resonates
- Asks about Rune → answer naturally, don't break flow

## When you have enough
Close naturally and transition to the inbox connection (or to wrapping up if they don't want inbox curation). Then append:

\`\`\`json
{
  "intent_ready": true,
  "professional_context": "1-2 sentence summary",
  "inferred_expertise_level": "junior | mid | senior",
  "occupation_interests": ["topic 1", "topic 2"],  // MUST be atomic — one interest per string, never comma-separated
  "free_interest": "topic or null",
  "learning_topic": { "topic": "string or null", "starting_level": "string or null", "goal": "string or null" },
  "inbox_preferences": { "wants_inbox_curation": true, "email_types_wanted": ["type1"], "notes": "specifics" }
}
\`\`\`

CRITICAL: Each entry in occupation_interests must be ONE atomic topic. Never combine multiple interests into one string. "AI race, quantum computing, Iran conflict" is WRONG — it must be ["AI race", "quantum computing", "Iran conflict"]. Same for free_interest — one topic only.

Set fields to null when not wanted. NEVER mention the JSON to the user.`

const RECOMMENDATION_CONVERSATIONAL_PROMPT = `## Who you are

You are Rune. You just finished a conversation with a user about what they need in their morning message. Now you're telling them what you'd build for them.

## What you're doing

Address them directly. Reference things they said. If inbox was scanned, be honest about what was found and any gaps. Use natural language, not bullet lists.

Tell them what their daily Rune will include — the topics you'll track, any newsletters you'll curate, and what they'll learn. Be specific to what they told you.

Close with two things:
1. They're in control — this is their experience and they can change anything.
2. The promise — five minutes with Rune every morning makes their day better. Put this in your own words.

Be rich, but be concise. You don't need to be verbose.

After your message, append this EXACT JSON block (the user never sees it):

\`\`\`json
{
  "recommendation_ready": true,
  "user_facing_summary": [
    "Plain language description of each thing they're getting"
  ]
}
\`\`\`

Never say: modules, features, slots, allocation, pipeline, configuration. Never mention the JSON.

If the user requests changes, adjust your description and emit a new recommendation_ready JSON.`

const ONBOARDING_OPENING_JSON_PROMPT = `${CONVERSATION_PROMPT}

## Output contract override
For this opening-message request, return STRICT JSON only. No markdown, no prose outside JSON:
{
  "rune_message": "the exact user-visible chat message"
}`

const CONVERSATION_JSON_PROMPT = `${CONVERSATION_PROMPT}

## Output contract override
Ignore the earlier instruction to append a fenced JSON block. Return STRICT JSON only. No markdown, no prose outside JSON:
{
  "rune_message": "the exact user-visible chat message",
  "intent": null
}

When you have enough information, set "intent" to:
{
  "intent_ready": true,
  "professional_context": "1-2 sentence summary",
  "inferred_expertise_level": "junior | mid | senior",
  "occupation_interests": ["topic 1", "topic 2"],
  "free_interest": "topic or null",
  "learning_topic": { "topic": "string or null", "starting_level": "string or null", "goal": "string or null" },
  "inbox_preferences": { "wants_inbox_curation": true, "email_types_wanted": ["type1"], "notes": "specifics" }
}

Set "intent" to null until the intent is ready. The user only sees rune_message, so never refer to JSON or internal fields inside rune_message.`

const RECOMMENDATION_JSON_PROMPT = `${RECOMMENDATION_CONVERSATIONAL_PROMPT}

## Output contract override
Ignore the earlier instruction to append a fenced JSON block. Return STRICT JSON only. No markdown, no prose outside JSON:
{
  "rune_message": "the exact user-visible recommendation message",
  "recommendation": {
    "recommendation_ready": true,
    "user_facing_summary": [
      "Plain language description of each thing they're getting"
    ]
  }
}

The user only sees rune_message, so never refer to JSON or internal fields inside rune_message.`

const TECHNICAL_CONFIG_PROMPT = `You generate search configurations for a daily news digest system. Given a user's structured intent and optional inbox scan data, produce a precise slot allocation.

Each slot is one of three types:

**email** — curates inbox newsletters.
Required fields: slot, type, focus, priority_senders (email addresses from scan results), rationale.

**news** — monitors a beat via search API.
Required fields: slot, type, focus, retrieval_queries, required_terms, scope_summary, rationale.
Optional: tracked_entities — string array of proper names the user explicitly tracks (NFL team, ticker, court, company). Example: ["Dallas Cowboys","Cowboys"]. Used at synthesis time: if nothing in the pull clearly concerns them, Rune says so in one honest sentence.

- retrieval_queries: 3-5 search strings using exact phrases, industry jargon, abbreviations. These go directly into the Tavily search API. Each query must approach the topic from a genuinely different angle. If query 1 is "commercial real estate deals", query 2 should NOT be "CRE transactions" (same search, different words). Query 2 should be "CMBS delinquency rates" or "commercial property foreclosure filings" — a different facet of the same beat.
- PROFESSION LENS (mandatory when professional_context implies a role): retrieval_queries MUST be filtered through that role — not generic Google News fodder. Examples: investment banking + industrials → queries must cite industrials verticals, OEMs, supply chain, grid/transmission, aerospace & defense procurement, chemicals, multi-industry conglomerates, ratings actions on industrial credits — never standalone "emerging technology" or "tech trends" without an industrial anchor (factories, capex, industrials M&A, industrial automation vendors serving manufacturing). Equity research / IB → tie to issuers, sectors, deals, regulatory filings, sell-side catalysts. Law student / attorney → tie to courts, circuits, dockets, bar-relevant institutions — not "breaking news" alone.
- required_terms: 2-3 AND groups, each an OR list. An article must match at least one term from EVERY group to pass the pre-filter. Be specific:
  - NEVER use generic terms like "technology", "innovation", "government", "policy", "news", "market", "update", "major", "headlines" alone. They match everything.
  - Slots about "major news" or "what's going on" still need concrete anchors: jurisdiction + institution + domain (e.g. federal courts + SCOTUS + circuit split + ABA), not (news AND legal).
  - First group: specific domain entities (company names, specific sectors, named concepts).
  - Second group: action/event words (deal, launch, ruling, funding, acquisition, breakthrough).
  - If the user's context implies a geographic focus, add a geographic group: ["US", "United States", "American", "federal"] etc.
- scope_summary: 2-3 sentences defining exactly what this beat covers and what it excludes.

**lesson** — a 10-day learning curriculum.
Required fields: slot, type, focus, starting_level, curriculum_goal, rationale.

Rules:
- Soft target is 4 slots. Use up to 6 if needed.
- Each news slot must be ONE coherent topic. NEVER combine unrelated interests (e.g. "sports and policy") into one slot. The retrieval system runs one query set per slot.
- If they didn't ask for something, don't create a slot for it.
- Only create email slots if inbox scan data contains relevant senders.

Return STRICT JSON only. No prose, no markdown, no explanation:
{
  "slot_allocation": [...],
  "allocation_notes": "brief trade-off reasoning",
  "inbox_curation_plan": {
    "priority_senders": [],
    "email_types_to_surface": [],
    "gap_note": "gaps between what user wanted and what inbox contained"
  }
}`

async function generateTechnicalConfig(userId: string, intentData: Record<string, any>, scanSummary: any): Promise<Record<string, any> | null> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) return null

  try {
    const parsed = await generateOpenAIObject({
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o",
      temperature: 0.15,
      messages: [
        { role: "system", content: TECHNICAL_CONFIG_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            intent: intentData,
            inbox_scan: scanSummary || null,
          })
        }
      ],
      schema: onboardTechnicalConfigSchema,
      outputShapeName: "OnboardTechnicalConfig",
      telemetry: {
        userId,
        callSiteName: "onboard.chat.technical_config",
        filePath: "app/api/onboard/chat/route.ts",
        functionName: "generateTechnicalConfig"
      }
    })

    return parsed
  } catch (e) {
    console.error("Technical config generation failed:", e)
  }
  return null
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()

  try {
    const authResult = await supabase.auth.getUser()
    if (authResult.error || !authResult.data.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const userId = authResult.data.user.id
    const body = await req.json().catch(() => ({}))

    if (body.init === true) {
      const onboardChatPhase = await getOnboardChatPhase(userId)
      const vibes = [
        "Tone: like you just sat down across from someone at a coffee shop.",
        "Tone: short and punchy. Five words if you can.",
        "Tone: warm curiosity.",
        "Tone: quiet confidence.",
        "Tone: playful energy.",
        "Tone: straight to business."
      ]
      const vibe = vibes[Math.floor(Math.random() * vibes.length)]

      const response = await generateClaudeObject({
        system: ONBOARDING_OPENING_JSON_PROMPT,
        messages: [
          { role: "user", content: `[SYSTEM: Generate your opening message to a new user. No prior context. ${vibe}]` }
        ],
        temperature: 1.0,
        schema: onboardOpeningMessageSchema,
        outputShapeName: "OnboardOpeningMessage",
        telemetry: {
          userId,
          callSiteName: "onboard.chat.opening_message",
          filePath: "app/api/onboard/chat/route.ts",
          functionName: "POST"
        }
      })

      return NextResponse.json({
        ok: true,
        rune_message: response.rune_message,
        signal: null,
        onboard_chat_phase: onboardChatPhase,
      })
    }

    const userMessage = typeof body.message === "string" ? body.message.trim() : ""
    const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> =
      Array.isArray(body.conversation_history) ? body.conversation_history : []

    if (!userMessage) {
      return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 })
    }

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...conversationHistory.slice(-30),
      { role: "user", content: userMessage }
    ]

    const serverPhase = await getOnboardChatPhase(userId)
    const useRecommendationPrompt = serverPhase === "recommendation"
    const baseTelemetry = {
      userId,
      callSiteName: useRecommendationPrompt
        ? "onboard.chat.recommendation_copy"
        : "onboard.chat.conversation_turn",
      filePath: "app/api/onboard/chat/route.ts",
      functionName: "POST",
      metadata: {
        onboard_chat_phase: serverPhase
      }
    }

    let signalType: "intent" | "recommendation" | null = null
    let signalData: Record<string, any> | null = null
    let userFacingMessage: string

    if (useRecommendationPrompt) {
      const turn = await generateClaudeObject({
        system: RECOMMENDATION_JSON_PROMPT,
        messages,
        temperature: 0.7,
        schema: onboardRecommendationTurnSchema,
        outputShapeName: "OnboardRecommendationTurn",
        telemetry: baseTelemetry
      })
      userFacingMessage = turn.rune_message
      signalType = turn.recommendation ? "recommendation" : null
      signalData = turn.recommendation
    } else {
      const turn = await generateClaudeObject({
        system: CONVERSATION_JSON_PROMPT,
        messages,
        temperature: 0.7,
        schema: onboardConversationTurnSchema,
        outputShapeName: "OnboardConversationTurn",
        telemetry: baseTelemetry
      })
      userFacingMessage = turn.rune_message
      signalType = turn.intent ? "intent" : null
      signalData = turn.intent
    }

    if (signalType === "intent") {
      const rawInterestsFromIntent = [
        ...(signalData?.occupation_interests || []),
        ...(signalData?.free_interest ? [signalData.free_interest] : [])
      ]
      const interests = normalizeInterests(rawInterestsFromIntent)

      await supabaseServiceRole
        .from("user_profiles")
        .upsert({
          user_id: userId,
          professional_context: signalData?.professional_context || "",
          stay_on_top_of: interests,
          get_sharper_on: signalData?.learning_topic?.topic
            ? [signalData.learning_topic.topic]
            : [],
          recommended_config: { raw_intent: signalData },
          onboarding_status: "conversation_done",
          onboard_chat_phase: "recommendation",
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" })

      return NextResponse.json({
        ok: true,
        rune_message: userFacingMessage,
        signal: "intent_ready",
        intent_data: signalData,
        onboard_chat_phase: "recommendation" as const,
      })
    }

    if (signalType === "recommendation" && signalData) {
      const { data: profile } = await supabaseServiceRole
        .from("user_profiles")
        .select("recommended_config, stay_on_top_of")
        .eq("user_id", userId)
        .single()

      const intentData = profile?.recommended_config?.raw_intent || {}
      const scanSummary = body.scan_results || null

      const rawInterests = Array.isArray(profile?.stay_on_top_of) ? profile.stay_on_top_of : []
      const normalizedInterests = normalizeInterests(rawInterests)
      if (normalizedInterests.length !== rawInterests.length) {
        await supabaseServiceRole
          .from("user_profiles")
          .update({ stay_on_top_of: normalizedInterests, updated_at: new Date().toISOString() })
          .eq("user_id", userId)

        if (intentData.occupation_interests) {
          intentData.occupation_interests = normalizedInterests.filter(
            (i: string) => !intentData.free_interest || i !== intentData.free_interest
          )
        }
      }

      const technicalConfig = await generateTechnicalConfig(userId, intentData, scanSummary)

      const mergedData: Record<string, any> = {
        ...(signalData || {}),
        ...(technicalConfig || {}),
        user_facing_summary: signalData?.user_facing_summary || [],
      }

      if (technicalConfig?.slot_allocation) {
        mergedData.slot_allocation = technicalConfig.slot_allocation
        mergedData.allocation_notes = technicalConfig.allocation_notes
        mergedData.inbox_curation_plan = technicalConfig.inbox_curation_plan
      }

      return NextResponse.json({
        ok: true,
        rune_message: userFacingMessage,
        signal: "recommendation_ready",
        recommendation_data: mergedData,
        onboard_chat_phase: "recommendation" as const,
      })
    }

    return NextResponse.json({
      ok: true,
      rune_message: userFacingMessage,
      signal: null,
      onboard_chat_phase: serverPhase,
    })

  } catch (e: any) {
    console.error("Onboarding chat error:", e)
    return NextResponse.json({
      ok: false,
      error: "Something went wrong. Please try again."
    }, { status: 500 })
  }
}
