import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { callOpenAIChatCompletion } from "@/lib/openai/chat"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

/**
 * POST /api/onboard/recommend
 *
 * Generates Rune's recommended configuration based on inbox analysis
 * and user profile. Stores recommended_config in user_profiles and
 * updates onboarding_status.
 */
export async function POST() {
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (!user) {
    console.error("Auth error:", userError)
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    // 1. Read user profile
    const { data: profile, error: profileErr } = await supabaseServiceRole
      .from("user_profiles")
      .select("professional_context, stay_on_top_of, get_sharper_on")
      .eq("user_id", user.id)
      .maybeSingle()

    if (profileErr) {
      return NextResponse.json({ ok: false, error: profileErr.message }, { status: 500 })
    }
    if (!profile) {
      return NextResponse.json({
        ok: false,
        error: "User profile not found. Complete profile setup first."
      }, { status: 400 })
    }

    const professionalContext = profile.professional_context || ""
    const stayOnTopOf: string[] = Array.isArray(profile.stay_on_top_of)
      ? profile.stay_on_top_of
      : typeof profile.stay_on_top_of === "string"
        ? [profile.stay_on_top_of]
        : []
    const getSharperOn: string[] = Array.isArray(profile.get_sharper_on)
      ? profile.get_sharper_on
      : typeof profile.get_sharper_on === "string"
        ? [profile.get_sharper_on]
        : []

    // 2. Read inbox analysis, sorted by relevance
    const { data: inboxData, error: inboxErr } = await supabaseServiceRole
      .from("inbox_analysis")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_newsletter", true)
      .order("relevance_score", { ascending: false })

    if (inboxErr) {
      return NextResponse.json({ ok: false, error: inboxErr.message }, { status: 500 })
    }

    const newsletters = inboxData || []

    // 3. Build priority/deprioritized sender lists from inbox analysis
    const prioritySenders = newsletters
      .filter((n) => n.relevance_score >= 0.5)
      .slice(0, 5)
      .map((n) => n.sender_address)

    const deprioritizedSenders = newsletters
      .filter((n) => n.relevance_score < 0.3)
      .map((n) => n.sender_address)

    const otherNewsletters = newsletters
      .filter((n) => !prioritySenders.includes(n.sender_address) && !deprioritizedSenders.includes(n.sender_address))

    // 4. Generate topic mappings via OpenAI
    const newsTopic = stayOnTopOf[0] || null
    const lessonTopic = getSharperOn[0] || null

    let newsTopicMapping: Record<string, any> | null = null
    let lessonTopicMapping: Record<string, any> | null = null

    if (OPENAI_API_KEY && (newsTopic || lessonTopic)) {
      const topicMappingPrompt = buildTopicMappingPrompt({
        professionalContext,
        newsTopic,
        lessonTopic,
      })

      const llmResp = await callOpenAIChatCompletion({
        apiKey: OPENAI_API_KEY,
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "You generate structured topic configuration for a daily digest product. Return strict JSON only. No markdown, no prose, no backticks.",
          },
          { role: "user", content: topicMappingPrompt },
        ],
      })

      const llmData = await llmResp.json()
      const llmContent = llmData?.choices?.[0]?.message?.content || ""
      const parsed = extractJsonObject(llmContent)

      if (parsed) {
        if (parsed.news && newsTopic) {
          newsTopicMapping = {
            normalized_topic: String(parsed.news.normalized_topic || newsTopic),
            scope_summary: String(parsed.news.scope_summary || `Daily brief on ${newsTopic}.`),
            retrieval_queries: Array.isArray(parsed.news.retrieval_queries)
              ? parsed.news.retrieval_queries.map((q: any) => String(q).trim()).filter(Boolean).slice(0, 5)
              : [newsTopic],
            required_terms: Array.isArray(parsed.news.required_terms)
              ? parsed.news.required_terms
                  .map((group: any) =>
                    Array.isArray(group) ? group.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 6) : []
                  )
                  .filter((g: string[]) => g.length > 0)
                  .slice(0, 4)
              : [],
            retrieval_hint: parsed.news.retrieval_hint ? String(parsed.news.retrieval_hint) : undefined,
          }
        }

        if (parsed.lesson && lessonTopic) {
          lessonTopicMapping = {
            normalized_topic: String(parsed.lesson.normalized_topic || lessonTopic),
            curriculum_goal: String(parsed.lesson.curriculum_goal || `Build practical understanding of ${lessonTopic}.`),
            starting_level: ["beginner", "intermediate", "advanced"].includes(String(parsed.lesson.starting_level))
              ? parsed.lesson.starting_level
              : "beginner",
          }
        }
      }
    }

    // Fallback mappings if LLM didn't produce results
    if (!newsTopicMapping && newsTopic) {
      newsTopicMapping = {
        normalized_topic: newsTopic,
        scope_summary: `Daily brief on ${newsTopic}.`,
        retrieval_queries: [newsTopic],
        required_terms: newsTopic
          .split(/[^a-zA-Z0-9]+/)
          .filter((term) => term.length > 2)
          .slice(0, 4)
          .map((term) => [term]),
      }
    }

    if (!lessonTopicMapping && lessonTopic) {
      lessonTopicMapping = {
        normalized_topic: lessonTopic,
        curriculum_goal: `Build practical understanding of ${lessonTopic}.`,
        starting_level: "beginner",
      }
    }

    // 5. Build recommended_config
    const recommendedConfig = {
      modules: {
        newsletters: {
          enabled: newsletters.length > 0,
          priority_senders: prioritySenders,
          deprioritized_senders: deprioritizedSenders,
          max_items_in_digest: 5,
        },
        news: {
          enabled: !!newsTopic,
          topic_text: newsTopic || "",
          topic_mapping: newsTopicMapping || {},
        },
        lessons: {
          enabled: !!lessonTopic,
          topic_text: lessonTopic || "",
          topic_mapping: lessonTopicMapping || {},
        },
      },
      digest_preferences: {
        delivery_time: "07:00",
        timezone: "America/New_York",
      },
    }

    // 6. Store recommended_config in user_profiles
    const { error: updateErr } = await supabaseServiceRole
      .from("user_profiles")
      .update({
        recommended_config: recommendedConfig,
        onboarding_status: "inbox_scanned",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)

    if (updateErr) {
      console.error("Failed to update user_profiles:", updateErr)
      return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 })
    }

    // 7. Build response
    const recommendation = {
      priority_newsletters: prioritySenders.map((addr) => {
        const nl = newsletters.find((n) => n.sender_address === addr)
        return {
          address: addr,
          name: nl?.sender_name || addr,
          category: nl?.category || "other",
          relevance_score: nl?.relevance_score ?? 0,
          relevance_reason: nl?.relevance_reason || null,
        }
      }),
      other_newsletters: otherNewsletters.map((nl) => ({
        address: nl.sender_address,
        name: nl.sender_name || nl.sender_address,
        category: nl.category || "other",
        relevance_score: nl.relevance_score ?? 0,
      })),
      news_topic: newsTopic
        ? {
            text: newsTopic,
            scope: newsTopicMapping?.scope_summary || `Daily brief on ${newsTopic}.`,
          }
        : null,
      lesson_topic: lessonTopic
        ? {
            text: lessonTopic,
            curriculum_title: lessonTopicMapping?.curriculum_goal || `Learn ${lessonTopic}`,
          }
        : null,
      delivery_time: "07:00",
    }

    return NextResponse.json({
      ok: true,
      recommendation,
    })
  } catch (e: any) {
    console.error("Error generating recommendation:", e)
    return NextResponse.json({
      ok: false,
      error: String(e.message || e)
    }, { status: 500 })
  }
}

function buildTopicMappingPrompt(input: {
  professionalContext: string
  newsTopic: string | null
  lessonTopic: string | null
}): string {
  return `Given this user's professional context: "${input.professionalContext}"

Map the following topics into structured config:

${input.newsTopic ? `News topic: "${input.newsTopic}"` : "News topic: null"}
${input.lessonTopic ? `Lesson topic: "${input.lessonTopic}"` : "Lesson topic: null"}

Return STRICT JSON with this shape:
{
  "news": {
    "normalized_topic": "string",
    "scope_summary": "string",
    "retrieval_hint": "string",
    "retrieval_queries": ["string"],
    "required_terms": [["string"]]
  } | null,
  "lesson": {
    "normalized_topic": "string",
    "curriculum_goal": "string",
    "starting_level": "beginner" | "intermediate" | "advanced"
  } | null
}

Rules:
- Preserve user intent; do NOT broaden scope.
- For news, generate 3-5 retrieval_queries from different lexical angles. Include synonym expansions, abbreviations, and industry jargon.
- For news, generate required_terms as AND-across-groups / OR-within-group keyword groups. Each group represents one core dimension.
- If a topic is null, return null for that object.
- No markdown, no prose outside JSON.`
}

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
