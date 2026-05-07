# Rune — architecture, dependencies, and LLM touchpoints (05/07/2026)

This document maps how the product is built, what it depends on, and **every production-relevant call path** to **Anthropic (Claude)** vs **OpenAI / Chat Completions (GPT)** so you can re-evaluate each touchpoint in isolation.

---

## Product in one paragraph

Rune is a **Next.js 15** app on **Vercel** that **onboards users** (conversational flow + optional Gmail), stores **per-user digest config** in **Supabase**, runs a **cron** to **fetch newsletters**, **generate news briefs** (Tavily + optional Google News RSS, then LLM), **generate daily lessons**, **format** a unified digest, and **email** it via **Resend**.

---

## Runtime stack and dependencies (high level)

| Layer | Technology |
|--------|------------|
| Framework | Next.js (App Router), React 18, TypeScript |
| Auth / DB | Supabase (`@supabase/ssr`, `@supabase/supabase-js`), service-role server client for cron and privileged writes |
| Email | Resend, `@react-email/components` |
| Gmail | Google OAuth + REST (`googleapis` not required for all paths; raw `fetch` to Gmail API is used in places) |
| News retrieval | Tavily Search API, Google News RSS (XML parse in-app) |
| HTML / text | `html-to-text`, `@mozilla/readability`, `jsdom`, `sanitize-html`, `mailparser`, `tldts` |
| LLM — Anthropic | `@anthropic-ai/sdk` → `lib/anthropic/chat.ts` (`callClaude`) |
| LLM — OpenAI-shaped | `lib/openai/chat.ts` (`callOpenAIChatCompletion`): **OpenAI** or **OpenRouter** when `OPENROUTER_API_KEY` is set |
| UI | Tailwind, Radix, `lucide-react`, `gsap`, `next-themes`, `sonner` |
| Validation / utils | `zod`, `p-limit`, `undici` (custom fetch agent / timeouts) |

`package.json` still names the project `"mortgage"` — legacy noise, not the product name.

---

## Architecture (data and control flow)

### Onboarding

1. **`POST /api/onboard/chat`** — primary UX: Claude drives conversation and emits hidden JSON signals (`intent_ready`, `recommendation_ready`). On recommendation, **`generateTechnicalConfig`** calls **GPT-4o** to produce **`slot_allocation`** (news / lesson / email slots).
2. **`POST /api/onboard/approve`** — validates news slots, calls **`generateCurriculumPlan`** (GPT-4o) per lesson slot, then **`commit_onboard_approval`** RPC for an atomic DB write (profile + digest_config + topics + selections).

### Digest pipeline

1. **`GET /api/cron/generate-digests`** — `CRON_SECRET` Bearer auth; for each user in send window: optional newsletter fetch + summarize → `generateDailyNewsTopics` → `generateDailyLessons` → `buildUnifiedDigest` / persist → **`sendDigestEmail`**. Ten-second stagger between users.

2. **`lib/digest/generator.ts`** — news: Tavily-first, optionally Google RSS when substantive Tavily count is low; hydration (fetch + Readability/html-to-text); **`unifiedFilterAndSynthesize`** (GPT-4o) for filter + brief in one pass. Lessons: **`synthesizeLessonContent`** via **Claude Sonnet**.

3. **Newsletters** — `fetchNewslettersForUser` → rows in `digest_items`; **`summarizeNewslettersForUser`** (`lib/digest/summarize-newsletters.ts`) batches and calls **GPT-4o**.

### Parallel / legacy UX paths

The **dashboard** `OnboardingFlow` still wires **StyleSelectionCard** to older endpoints (`clarify-news-topic`, `clarify-lesson-topic`, `generate-lesson-curriculum`, `preview-news-topic-density`). **`POST /api/digest/config`** maps topics with **gpt-4o-mini**. These overlap conceptually with the main `/onboard` chat flow — easy source of drift.

---

## Environment variables that matter

- **Anthropic:** `ANTHROPIC_API_KEY`
- **OpenAI / OpenRouter:** `OPENAI_API_KEY`, optionally `OPENROUTER_API_KEY` (switches chat-completions base URL)
- **News:** `TAVILY_API_KEY`
- **Cron:** `CRON_SECRET`
- **Email:** `RESEND_API_KEY` (and related Resend settings per `lib/digest/email.ts`)
- **Gmail:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, scopes
- **Supabase:** `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE`
- **Site:** `NEXT_PUBLIC_SITE_URL` (OAuth redirect hygiene)

---

## Claude (Anthropic) — every touchpoint

| Location | Model | Role |
|----------|--------|------|
| `lib/anthropic/chat.ts` | `claude-sonnet-4-20250514`, fallback `claude-haiku-4-5-20251001` on 529/503/connect timeout | Single wrapper `callClaude` |
| `app/api/onboard/chat/route.ts` | Via `callClaude` | Opening message, conversation, recommendation copy; parses trailing ```json blocks for signals |
| `lib/digest/generator.ts` → `synthesizeLessonContent` | Via `callClaude` | Daily lesson body (JSON or fallback parse) |

**Critical evaluation (Claude)**

- **Strengths:** Onboarding voice and multi-turn nuance; lesson prose quality vs template fills.
- **Risks:** Hidden JSON-in-markdown contract is brittle (truncation/repair logic exists but remains fragile). Sonnet + Haiku fallback changes quality mid-outage without explicit product signaling.
- **Debt:** Narrow surface area — good — but onboarding and lessons are unrelated codepaths sharing no shared “LLM output schema” layer.

---

## ChatGPT / OpenAI-shaped API — every touchpoint

All of these use **`callOpenAIChatCompletion`** unless noted.

| Location | Typical model | Role |
|----------|----------------|------|
| `app/api/onboard/chat/route.ts` → `generateTechnicalConfig` | gpt-4o | Slot allocation + retrieval config from intent + inbox scan summary |
| `app/api/onboard/approve/route.ts` → `generateCurriculumPlan` | gpt-4o (in `lib/onboard/generate-curriculum.ts`) | 10-day curriculum at approve time |
| `lib/onboard/generate-curriculum.ts` | gpt-4o | Same curriculum helper (also used by `backfill-curricula`) |
| `lib/digest/generator.ts` → `filterRelevantNewsArticles` | gpt-4o | Relevance scoring (still used by `previewNewsTopicSignal`) |
| `lib/digest/generator.ts` → `unifiedFilterAndSynthesize` | gpt-4o | Primary daily news filter + synthesize |
| `lib/digest/generator.ts` → `synthesizeNewsBrief` | gpt-4o | **Legacy / unused in main daily path** — dead weight risk |
| `lib/digest/summarize-newsletters.ts` | gpt-4o | Newsletter batch summaries (cron path) |
| `app/api/digest/generate-summaries/route.ts` | gpt-4o-mini (default) or override gpt-4o | Dev/dashboard batch summaries; large file, duplicate concerns with `summarize-newsletters.ts` |
| `app/api/onboard/scan-inbox/route.ts` | gpt-4o-mini | Per-sender relevance scoring after heuristics |
| `app/api/digest/config/route.ts` | gpt-4o-mini | Topic → `topic_mapping_json` for legacy dashboard config POST |
| `app/api/onboard/clarify-news-topic/route.ts` | gpt-4o-mini | Scoped news clarifier JSON |
| `app/api/onboard/clarify-lesson-topic/route.ts` | gpt-4o-mini | Scoped lesson clarifier JSON |
| `app/api/onboard/generate-lesson-curriculum/route.ts` | gpt-4o-mini | Standalone curriculum JSON (overlaps `generate-curriculum.ts` + approve path) |

**Separate path (does NOT use `lib/openai/chat.ts`):**

| Location | Model | Role |
|----------|--------|------|
| `lib/onboard/llm-batch.ts` | Hardcoded `fetch` to `api.openai.com`, gpt-4o-mini | Batch sender classification for `/api/onboard/classify-senders` — **no OpenRouter**, no shared retry dispatcher |

**Critical evaluation (OpenAI / GPT)**

- **Strengths:** One “chat completions” shape works for structured JSON tasks; OpenRouter toggle is useful for rate/cost.
- **Risks:** **Three parallel newsletter summarization implementations** (`summarize-newsletters.ts`, `generate-summaries/route.ts`, divergent prompts) = behavior drift and double maintenance. **`llm-batch.ts` bypasses** the shared client (no OpenRouter, no undici retry). **`generator.ts`** still contains **`synthesizeNewsBrief`** + **`filterRelevantNewsArticles`** while production news uses **`unifiedFilterAndSynthesize`** — confusion and accidental edits.
- **JSON contracts:** Repeated ad-hoc `extractJsonObject` copies across files — no single parser/validator (Zod is in deps but underused for LLM outputs).

---

## Strategic cleanup order (if “no more shitty code”)

1. **One OpenAI entrypoint** — route `llm-batch.ts` through `callOpenAIChatCompletion` or a thin shared `postChatCompletion`.
2. **One newsletter summarization path** — merge cron + dev route or extract `lib/digest/newsletter-summarize.ts` with one prompt module.
3. **Delete or quarantine** dead news paths in `generator.ts` (`synthesizeNewsBrief`; clarify whether `filterRelevantNewsArticles` stays only for preview).
4. **Single curriculum generator** — choose approve-time `generate-curriculum.ts` vs `generate-lesson-curriculum` route; deprecate the other for product paths.
5. **Schema layer** — Zod (or similar) for every LLM JSON boundary; fail closed with logged payloads.

---

## Related docs

- `docs/architecture.md` — broader system map (may be slightly stale vs code).
- `docs/may-7-2026-update.md` — narrative snapshot of the same era.

---

*Internal engineering note — 05/07/2026.*
