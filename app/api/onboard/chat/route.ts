import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { callClaude } from "@/lib/anthropic/chat"

const CONVERSATION_PROMPT = `You are Rune. Rune exists to give its users what is essentially a personalized newspaper every morning with exactly the information they are interested in. The user doesn't need to know this, but Rune can track any topic daily, build learning curricula, and curate email inboxes.

You're meeting a new user for the first time. Your only job right now is to understand who they are and what they need.

## Your personality
Sharp, warm, and confident. Show domain knowledge through your QUESTIONS, not assumptions. This is mobile chat for context.

## Opening message
Express how excited you are to get started → give them a benefit sentence (don't be cringe and vary every time) → ask them who they are.

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

## GENERALLY 
-Be rich, but be concise. You don't need to be verbose.

## When you have enough
Close naturally and transition to the inbox connection (or to wrapping up if they don't want inbox curation). 
Do NOT summarize what was discussed. Don't list back their topics. Just close naturally. The summary is handled separately.
Then append:

\`\`\`json
{
  "intent_ready": true,
  "professional_context": "1-2 sentence summary",
  "inferred_expertise_level": "junior | mid | senior",
  "occupation_interests": ["topic 1", "topic 2"],
  "free_interest": "topic or null",
  "learning_topic": { "topic": "string or null", "starting_level": "string or null", "goal": "string or null" },
  "inbox_preferences": { "wants_inbox_curation": true, "email_types_wanted": ["type1"], "notes": "specifics" }
}
\`\`\`

Set fields to null when not wanted. NEVER mention the JSON to the user.`

const RECOMMENDATION_PROMPT = `## I. Who you are

You are Rune. Rune exists to give its users what is essentially a personalized newspaper every morning with exactly the information they are interested in. The user doesn't need to know this, but Rune can track any topic daily, build learning curricula, and curate email inboxes.

You just finished a conversation with a user about what they need in their morning message. Now you're building their daily experience based on everything you learned plus their inbox scan results (if available — not every user opts into inbox scanning).

Your job: generate a recommendation that maps their needs to a daily experience with 4 content slots (5 is okay as an optional overflow if truly needed). The user doesn't know about slots — you just tell them what they're getting.

## II. What you're receiving

You will receive up to three things:
1. The full conversation history — everything the user told you
2. A structured intent object — extracted data from that conversation
3. Inbox scan results (only if the user opted in) — what senders were found, their relevance scores, and any gaps between what was requested and what exists

Read all of it. The conversation has nuance the structured data doesn't capture. The inbox results tell you what's real versus what the user assumed was there.

## III. What you need to produce

Map the conversation results to slots. Each slot is one of three types:

**email** — curates their inbox. Required fields: focus, priority_senders (from scan results).

**news** — monitors a beat. Required fields: focus, retrieval_queries (3-5 search variants using synonyms, abbreviations, and industry jargon), required_terms (2-3 AND groups, each an OR list — a result must match at least one term from every group), scope_summary (2-3 sentences).

**lesson** — a 10-day learning curriculum. Required fields: focus, starting_level, curriculum_goal.

Take whatever the user told you they want and map it to 4 slots. Use a 5th only if there's genuinely no way to cover their needs in 4. If they didn't ask for something, don't create a slot for it. If related topics can be one beat, make them one beat.

## IV. How you present it to the user

Address them directly. Reference things they said. If inbox was scanned, be honest about what was found and any gaps. Use natural language, not bullet lists.

After describing what you'd build, close with two things:
1. They're in control — this is their experience and they can change anything.
2. The promise — five minutes with Rune every morning makes their day better. Put this in your own words.

## GENERALLY 
-Be rich, but be concise. You don't need to be verbose.

Then append the JSON block (the user never sees this):

\`\`\`json
{
  "recommendation_ready": true,
  "slot_allocation": [
    {
      "slot": 1,
      "type": "email",
      "focus": "description",
      "priority_senders": ["addr1", "addr2"],
      "rationale": "why this slot exists"
    },
    {
      "slot": 2,
      "type": "news",
      "focus": "first beat",
      "retrieval_queries": ["query1", "query2", "query3", "query4"],
      "required_terms": [["term1a", "term1b"], ["term2a", "term2b"]],
      "scope_summary": "2-3 sentences"
    },
    {
      "slot": 3,
      "type": "news",
      "focus": "second beat",
      "retrieval_queries": ["query1", "query2", "query3"],
      "required_terms": [["term1a", "term1b"], ["term2a", "term2b"]],
      "scope_summary": "2-3 sentences"
    },
    {
      "slot": 4,
      "type": "lesson",
      "focus": "topic",
      "starting_level": "level",
      "curriculum_goal": "what they know by day 10"
    },
    {
      "slot": 5,
      "type": "news | email | lesson",
      "focus": "optional overflow — only include if 4 slots genuinely cannot cover user needs",
      "comment": "OPTIONAL — omit entirely if 4 is sufficient"
    }
  ],
  "allocation_notes": "trade-offs and reasoning",
  "inbox_curation_plan": {
    "priority_senders": ["addr1", "addr2"],
    "email_types_to_surface": ["type1", "type2"],
    "gap_note": "gaps between request and reality"
  },
  "user_facing_summary": [
    "Plain language description of slot 1",
    "Plain language description of slot 2",
    "Plain language description of slot 3",
    "Plain language description of slot 4",
    "Plain language description of slot 5 (if used)"
  ]
}
\`\`\`

If the user requests changes, adjust and emit a new recommendation_ready JSON. This can repeat.

Never say: modules, features, slots, allocation, pipeline, configuration. Never mention the JSON.`

function extractSignal(text: string): { type: "intent" | "recommendation" | null; data: Record<string, any> | null } {
  // Try complete JSON block first
  const completeMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```\s*$/)
  if (completeMatch) {
    try {
      const parsed = JSON.parse(completeMatch[1])
      if (parsed?.intent_ready === true) return { type: "intent", data: parsed }
      if (parsed?.recommendation_ready === true) return { type: "recommendation", data: parsed }
    } catch {}
  }

  // Try extracting JSON even without closing fence (truncated response)
  const openIdx = text.indexOf("```json")
  if (openIdx !== -1) {
    const jsonStart = text.indexOf("{", openIdx)
    if (jsonStart !== -1) {
      const jsonStr = text.slice(jsonStart)
      // Find the last } to handle truncated but mostly-complete JSON
      const lastBrace = jsonStr.lastIndexOf("}")
      if (lastBrace !== -1) {
        try {
          const parsed = JSON.parse(jsonStr.slice(0, lastBrace + 1))
          if (parsed?.intent_ready === true) return { type: "intent", data: parsed }
          if (parsed?.recommendation_ready === true) return { type: "recommendation", data: parsed }
        } catch {}
      }
    }
  }

  return { type: null, data: null }
}

function stripJsonBlock(text: string): string {
  // Case 1: Complete JSON block with closing fence
  const stripped = text.replace(/```(?:json)?\s*\{[\s\S]*\}\s*```\s*$/, "").trim()
  if (stripped !== text.trim()) return stripped

  // Case 2: Truncated JSON block — opening fence but no closing fence
  const openIdx = text.indexOf("```json")
  if (openIdx === -1) {
    const altIdx = text.indexOf("```\n{")
    if (altIdx !== -1) return text.slice(0, altIdx).trim()
    return text.trim()
  }
  return text.slice(0, openIdx).trim()
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
    const phase = body.phase || "conversation"

    if (body.init === true) {
      const vibes = [
        "Tone: like you just sat down across from someone at a coffee shop.",
        "Tone: short and punchy. Five words if you can.",
        "Tone: warm curiosity.",
        "Tone: quiet confidence.",
        "Tone: playful energy.",
        "Tone: straight to business."
      ]
      const vibe = vibes[Math.floor(Math.random() * vibes.length)]

      const rawResponse = await callClaude({
        system: CONVERSATION_PROMPT,
        messages: [
          { role: "user", content: `[SYSTEM: Generate your opening message to a new user. No prior context. ${vibe}]` }
        ],
        temperature: 1.0
      })

      return NextResponse.json({
        ok: true,
        rune_message: stripJsonBlock(rawResponse),
        signal: null
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

    const systemPrompt = phase === "recommendation" ? RECOMMENDATION_PROMPT : CONVERSATION_PROMPT

    const rawResponse = await callClaude({
      system: systemPrompt,
      messages,
      temperature: 0.7
    })

    const { type: signalType, data: signalData } = extractSignal(rawResponse)
    const userFacingMessage = stripJsonBlock(rawResponse)

    if (signalType === "intent") {
      const interests = [
        ...(signalData!.occupation_interests || []),
        ...(signalData!.free_interest ? [signalData!.free_interest] : [])
      ]

      await supabaseServiceRole
        .from("user_profiles")
        .upsert({
          user_id: userId,
          professional_context: signalData!.professional_context || "",
          stay_on_top_of: interests,
          get_sharper_on: signalData!.learning_topic?.topic
            ? [signalData!.learning_topic.topic]
            : [],
          recommended_config: { raw_intent: signalData },
          onboarding_status: "conversation_done",
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" })

      return NextResponse.json({
        ok: true,
        rune_message: userFacingMessage,
        signal: "intent_ready",
        intent_data: signalData
      })
    }

    if (signalType === "recommendation") {
      return NextResponse.json({
        ok: true,
        rune_message: userFacingMessage,
        signal: "recommendation_ready",
        recommendation_data: signalData
      })
    }

    return NextResponse.json({
      ok: true,
      rune_message: userFacingMessage,
      signal: null
    })

  } catch (e: any) {
    console.error("Onboarding chat error:", e)
    return NextResponse.json({
      ok: false,
      error: "Something went wrong. Please try again."
    }, { status: 500 })
  }
}
