import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { callOpenAIChatCompletion, isTransientNetworkError } from "@/lib/openai/chat"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const NEWS_CLARIFIER_PROMPT = `You are Rune's news clarifier. You already know something about every topic - use that.

A user just told you what they want daily news updates on. Your job: figure out which version of this topic they mean. Every topic has multiple versions. "AI news" could be five completely different daily briefs depending on who's asking. Your conversation exists to figure out which one this person wants.

Think about the topic first. Where does it fork? What's the most likely source of ambiguity given what they said? Ask about that - not about abstract preferences.

RULES:
- Respond with ONLY valid JSON. No markdown, no prose, no backticks.
- One question per turn when done=false.
- Keep assistant_message under 28 words when done=false.
- This is a conversation, not an intake form. React to what the user actually said. Your next question should be the one that most reduces your uncertainty about what they want-not the next item on some internal list.
- Finalize as soon as you could write a search instruction that wouldn't return noise. Sometimes that's after one reply.

YOUR TARGET:
When you set done=true, you must produce a news_scope string-an internal instruction (not shown to the user) that tells a downstream system exactly what to search for each day. A good news_scope is specific enough that two reasonable people reading it would run roughly the same search and return roughly the same results.

Here is an example of a GOOD final news_scope:
"Daily updates on US federal AI regulation and executive policy actions, including proposed legislation, agency guidance (e.g., NIST, FTC), and lobbying activity by major tech companies. Policy impact focus, not technical research."

Here is an example of a BAD final news_scope:
"AI news and updates, focusing on important developments." (Too vague. What counts as important? Which slice of AI? This would return noise.)

Look at the gap between those two. Your conversation exists to close that gap. Every question you ask should meaningfully narrow the space between "vague topic" and "precise search instruction."

GOOD QUESTION EXAMPLES:
These are good because they react to a specific ambiguity in what the user said:
- User said "tariffs" -> "Are you tracking how tariffs hit specific industries you care about, or more the geopolitical strategy behind them?"
- User said "AI news" -> "When you say AI-are you following the research side, the startup and funding side, or more regulation and policy?"
- User said "crypto regulation" and implied US focus -> finalizing already makes sense; maybe one question about whether they care about SEC enforcement specifically or broader legislative moves.

BAD QUESTION EXAMPLES:
These are bad because they'd be asked regardless of what the user said:
- "Can you tell me more about what you're interested in?" (too open-ended, forces the user to do your job)
- "What region do you want to focus on?" (this might matter, or might be obvious from context-asking it robotically every time is the problem)
- "What kind of signal matters to you-business impact, technical, or policy?" (this is a menu, not a conversation)

OUTPUT FORMAT - every response must be exactly this JSON object:
{
  "assistant_message": "string",
  "done": false | true,
  "news_scope": null | "string"
}

- When done=false: news_scope must be null.
- When done=true: news_scope must be a concrete, actionable search instruction (1-3 sentences). assistant_message should briefly confirm what they'll receive.`

function extractJsonObject(text: string): any | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()

  try {
    const authResult = await supabase.auth.getUser()
    if (authResult.error) {
      const status = isTransientNetworkError(authResult.error) ? 503 : 500
      return NextResponse.json({
        ok: false,
        error: isTransientNetworkError(authResult.error)
          ? "Temporary auth connectivity issue. Please retry."
          : "Failed to validate session."
      }, { status })
    }

    const user = authResult.data.user
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const topic = typeof body.news_topic === "string" ? body.news_topic.trim() : ""
    const history = Array.isArray(body.history)
      ? body.history
          .filter((m: any) => m && typeof m.role === "string" && typeof m.content === "string")
          .slice(-12)
      : []

    if (!topic) {
      return NextResponse.json({ ok: false, error: "news_topic is required" }, { status: 400 })
    }

    if (!OPENAI_API_KEY) {
      const userTurns = history.filter((m: any) => m.role === "user").length
      if (userTurns >= 2) {
        return NextResponse.json({
          ok: true,
          assistant_message: "Great, I have enough context for your daily news scope.",
          done: true,
          news_scope: `Daily brief on ${topic} with practical trend + execution focus.`,
          source: "fallback"
        })
      }
      return NextResponse.json({
        ok: true,
        assistant_message: "To tailor your daily news brief, should I focus on a specific geography and decision context (investor, operator, lender, policy)?",
        done: false,
        news_scope: null,
        source: "fallback"
      })
    }

    const payload = { news_topic: topic, history }
    const resp = await callOpenAIChatCompletion({
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: NEWS_CLARIFIER_PROMPT },
        { role: "user", content: JSON.stringify(payload) }
      ],
      telemetry: {
        userId: user.id,
        callSiteName: "onboard.clarify_news_topic",
        filePath: "app/api/onboard/clarify-news-topic/route.ts",
        functionName: "POST",
        validationStatus: "regex",
        outputShapeName: "NewsTopicClarifier"
      }
    })

    const data = await resp.json()
    const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || "")
    if (!parsed) throw new Error("Invalid clarifier JSON")

    return NextResponse.json({
      ok: true,
      assistant_message: String(parsed.assistant_message || "").trim(),
      done: !!parsed.done,
      news_scope: parsed.news_scope ? String(parsed.news_scope) : null,
      source: "llm"
    })
  } catch (e: any) {
    if (isTransientNetworkError(e)) {
      return NextResponse.json({
        ok: false,
        retryable: true,
        error: "Temporary network issue while generating clarifier response. Please retry."
      }, { status: 503 })
    }

    return NextResponse.json({
      ok: false,
      error: String(e.message || e)
    }, { status: 500 })
  }
}
