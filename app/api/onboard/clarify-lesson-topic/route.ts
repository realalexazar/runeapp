import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { isTransientNetworkError } from "@/lib/openai/chat"
import { generateOpenAIObject } from "@/lib/ai/gateway"
import { lessonTopicClarifierSchema } from "@/lib/ai/schemas/onboarding"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const LESSON_CLARIFIER_PROMPT = `You are Rune's lesson clarifier. You already know something about every topic - use that.

A user just told you what they want to learn over 10 days. Your job: figure out which version of this curriculum they need. Every topic has multiple versions. "Learn Python" could be five completely different 10-day sequences depending on who's asking and what they're trying to do. Your conversation exists to figure out which one this person wants.

Think about the topic first. Where does it fork? What's the most likely source of ambiguity given what they said? Ask about that - not about abstract learning preferences.

RULES:
- Respond with ONLY valid JSON. No markdown, no prose, no backticks.
- One question per turn when done=false.
- Keep assistant_message under 28 words when done=false.
- Finalize as soon as you could brief a curriculum designer who'd build something the user actually wants. Sometimes that's after one reply.

OUTPUT FORMAT - every response must be exactly:
{
  "assistant_message": "string",
  "done": false | true,
  "lesson_scope": null | "string"
}

When done=false: lesson_scope is null.
When done=true: lesson_scope is a concrete internal curriculum brief (2-4 sentences, not shown to user). assistant_message briefly confirms what their 10 days will cover.

EXAMPLES OF GOOD lesson_scope STRINGS:
- "10-day intermediate curriculum on B2B SaaS pricing strategy. User has launched products before but never structured a pricing model. By day 10: design and defend a tiered pricing structure for a new SaaS product. Concept-first with real company case studies from day 3 onward. Stay enterprise SaaS - skip consumer/e-commerce."
- "10-day beginner curriculum on personal investing for someone with savings but no market experience. By day 10: construct a diversified three-fund portfolio and set up automatic contributions. Concept-first, one real-world example per lesson. Focus on index funds, asset allocation, tax-advantaged accounts. No day-trading or crypto."
- "10-day advanced curriculum on analyzing commercial real estate deals through the lens of monetary policy. User is already an active CRE investor. By day 10: evaluate a deal's rate sensitivity using multiple frameworks and defend the analysis with historical case evidence. Heavy on case studies and worked examples."

EXAMPLE INTERACTIONS:

Topic: "commercial real estate value-add strategies"
-> "Are you focused on the acquisition underwriting side, the renovation and repositioning execution, or more the exit and refinance strategy?"
User: "Mostly underwriting - figuring out which deals are actually worth pursuing."
-> "Makes sense. Are you already looking at deals and want to sharpen your process, or learning underwriting more from scratch?"
User: "I've looked at a few but I don't have a repeatable framework yet."
-> done=true. lesson_scope: "10-day intermediate curriculum on underwriting commercial real estate value-add deals. User has some deal exposure but no systematic framework. By day 10: apply a repeatable underwriting process to a value-add opportunity, including rent comp analysis, capex budgeting, and pro forma modeling. Mix of concepts and worked deal examples."

Topic: "Python"
-> "What are you planning to use Python for - data analysis, web development, automation scripts, something else?"
User: "Data analysis. I work in finance and I'm tired of doing everything in Excel."
-> done=true. lesson_scope: "10-day beginner curriculum on Python for financial data analysis. User is proficient in Excel but new to programming. By day 10: pull financial data, clean it in pandas, and produce an analysis with charts that replaces a manual Excel workflow. Practical and hands-on from day 1 - every lesson should connect to a finance use case."

Topic: "B2B SaaS marketing"
-> "Are you marketing an early-stage product trying to find first customers, or scaling something that already has traction?"
User: "Early stage. We have a product but basically zero inbound."
-> "Got it - are you more interested in the demand gen and channel strategy side, or the messaging and positioning side?"
User: "Demand gen. I need to know where to spend time and money."
-> done=true. lesson_scope: "10-day beginner-to-intermediate curriculum on demand generation for early-stage B2B SaaS. User has a product but no inbound pipeline. By day 10: have a prioritized channel strategy with a concrete plan for the top 2-3 acquisition channels. Practical and case-heavy - real examples from startups at similar stage, not enterprise playbooks."

Topic: "monetary policy and markets"
-> "Are you trying to understand how to trade around Fed decisions, or more building a deeper macro framework for how policy flows through to asset prices?"
User: "The second one. I want to actually understand the transmission mechanisms, not just trade the headline."
-> done=true. lesson_scope: "10-day advanced curriculum on monetary policy transmission mechanisms and their impact on asset prices. User wants deep macro understanding, not tactical trading. By day 10: trace a policy rate change through the yield curve, credit spreads, equities, and real estate, and identify where the transmission lags and breaks down. Theory-heavy with historical case studies (e.g., 2013 taper tantrum, 2022 hiking cycle)."`

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
    const topic = typeof body.lesson_topic === "string" ? body.lesson_topic.trim() : ""
    const history = Array.isArray(body.history)
      ? body.history
          .filter((m: any) => m && typeof m.role === "string" && typeof m.content === "string")
          .slice(-12)
      : []

    if (!topic) {
      return NextResponse.json({ ok: false, error: "lesson_topic is required" }, { status: 400 })
    }

    if (!OPENAI_API_KEY) {
      const userTurns = history.filter((m: any) => m.role === "user").length
      if (userTurns >= 2) {
        return NextResponse.json({
          ok: true,
          assistant_message: "Great, I have enough context for your lesson track.",
          done: true,
          lesson_scope: `10-day practical curriculum on ${topic} with progressive lessons.`,
          source: "fallback"
        })
      }
      return NextResponse.json({
        ok: true,
        assistant_message: "To tailor your 10-day lessons, what is your current level and what practical outcome do you want by day 10?",
        done: false,
        lesson_scope: null,
        source: "fallback"
      })
    }

    const payload = { lesson_topic: topic, history }
    const parsed = await generateOpenAIObject({
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: LESSON_CLARIFIER_PROMPT },
        { role: "user", content: JSON.stringify(payload) }
      ],
      schema: lessonTopicClarifierSchema,
      outputShapeName: "LessonTopicClarifier",
      telemetry: {
        userId: user.id,
        callSiteName: "onboard.clarify_lesson_topic",
        filePath: "app/api/onboard/clarify-lesson-topic/route.ts",
        functionName: "POST"
      }
    })

    return NextResponse.json({
      ok: true,
      assistant_message: parsed.assistant_message,
      done: parsed.done,
      lesson_scope: parsed.lesson_scope,
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
