import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { callClaude } from "@/lib/anthropic/chat"
import { callOpenAIChatCompletion } from "@/lib/openai/chat"

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
  "occupation_interests": ["topic 1", "topic 2"],
  "free_interest": "topic or null",
  "learning_topic": { "topic": "string or null", "starting_level": "string or null", "goal": "string or null" },
  "inbox_preferences": { "wants_inbox_curation": true, "email_types_wanted": ["type1"], "notes": "specifics" }
}
\`\`\`

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

const TECHNICAL_CONFIG_PROMPT = `You generate search configurations for a daily news digest system. Given a user's structured intent and optional inbox scan data, produce a precise slot allocation.

Each slot is one of three types:

**email** — curates inbox newsletters.
Required fields: slot, type, focus, priority_senders (email addresses from scan results), rationale.

**news** — monitors a beat via search API.
Required fields: slot, type, focus, retrieval_queries, required_terms, scope_summary, rationale.
- retrieval_queries: 3-5 search strings using exact phrases, industry jargon, abbreviations. These go directly into the Tavily search API. Each query must approach the topic from a genuinely different angle. If query 1 is "commercial real estate deals", query 2 should NOT be "CRE transactions" (same search, different words). Query 2 should be "CMBS delinquency rates" or "commercial property foreclosure filings" — a different facet of the same beat.
- required_terms: 2-3 AND groups, each an OR list. An article must match at least one term from EVERY group to pass the pre-filter. Be specific:
  - NEVER use generic terms like "technology", "innovation", "government", "policy", "news", "market", "update" alone. They match everything.
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

function extractSignal(text: string): { type: "intent" | "recommendation" | null; data: Record<string, any> | null } {
  const completeMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```\s*$/)
  if (completeMatch) {
    try {
      const parsed = JSON.parse(completeMatch[1])
      if (parsed?.intent_ready === true) return { type: "intent", data: parsed }
      if (parsed?.recommendation_ready === true) return { type: "recommendation", data: parsed }
    } catch {}
  }

  const truncatedMatch = text.match(/```(?:json)?\s*(\{[\s\S]*)$/)
  if (truncatedMatch) {
    let jsonStr = truncatedMatch[1].trim()
    let depth = 0
    let lastValidEnd = -1
    for (let i = 0; i < jsonStr.length; i++) {
      if (jsonStr[i] === "{") depth++
      if (jsonStr[i] === "}") {
        depth--
        if (depth === 0) { lastValidEnd = i; break }
      }
    }
    if (lastValidEnd > 0) {
      try {
        const parsed = JSON.parse(jsonStr.slice(0, lastValidEnd + 1))
        if (parsed?.intent_ready === true) return { type: "intent", data: parsed }
        if (parsed?.recommendation_ready === true) return { type: "recommendation", data: parsed }
      } catch {}
    }
  }

  return { type: null, data: null }
}

function stripJsonBlock(text: string): string {
  const stripped = text.replace(/```(?:json)?\s*\{[\s\S]*\}\s*```\s*$/, "").trim()
  if (stripped !== text.trim()) return stripped

  const openIdx = text.indexOf("```json")
  if (openIdx === -1) {
    const altIdx = text.indexOf("```\n{")
    if (altIdx !== -1) return text.slice(0, altIdx).trim()
    return text.trim()
  }
  return text.slice(0, openIdx).trim()
}

function extractJsonObject(text: string): any | null {
  const trimmed = text.trim()
  try { return JSON.parse(trimmed) } catch {}
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
  try { return JSON.parse(stripped) } catch {}
  const start = stripped.indexOf("{")
  const end = stripped.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)) } catch {}
  }
  return null
}

async function generateTechnicalConfig(intentData: Record<string, any>, scanSummary: any): Promise<Record<string, any> | null> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) return null

  try {
    const resp = await callOpenAIChatCompletion({
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
      ]
    })

    const data = await resp.json()
    const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || "")
    if (parsed?.slot_allocation && Array.isArray(parsed.slot_allocation)) {
      return parsed
    }
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

    const systemPrompt = phase === "recommendation" ? RECOMMENDATION_CONVERSATIONAL_PROMPT : CONVERSATION_PROMPT

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
      const { data: profile } = await supabaseServiceRole
        .from("user_profiles")
        .select("recommended_config")
        .eq("user_id", userId)
        .single()

      const intentData = profile?.recommended_config?.raw_intent || {}

      let scanSummary = null
      try {
        const scanMsg = messages.find((m) => m.role === "user" && m.content.includes("[SYSTEM: Inbox scan complete"))
        if (scanMsg) {
          const jsonStart = scanMsg.content.indexOf("{")
          const jsonEnd = scanMsg.content.indexOf("]\n\nNow generate")
          if (jsonStart >= 0 && jsonEnd > jsonStart) {
            scanSummary = JSON.parse(scanMsg.content.slice(jsonStart, jsonEnd + 1))
          }
        }
      } catch {}

      const technicalConfig = await generateTechnicalConfig(intentData, scanSummary)

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
        recommendation_data: mergedData
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
