# Rune 1.5 — Architecture Document

> Historical alpha snapshot. This document preserves the Rune 1.5 architecture for context and may mention dashboard-era routes/components that Phase 0c has since removed. Use `docs/REBUILD_PLAN.md`, `docs/ONBOARDING_SPEC.md`, and `docs/api.md` as the current build contracts.

## 1. What Rune Is

Rune is a personalized daily intelligence agent. Users onboard via a conversational chat with Claude, optionally connect their Gmail, and receive a curated daily email digest each morning. Rune has three core capabilities:

- **Inbox Curation** — Scans a user's Gmail inbox, identifies relevant newsletters and recurring email content, summarizes them, and surfaces the most important items.
- **News Monitoring** — Tracks user-defined topics daily using Google News RSS and Tavily search, filters for relevance via LLM evaluation, and synthesizes intelligence briefs.
- **Daily Learning** — Builds structured 10-day curricula on topics the user wants to learn, generating one lesson per day with progressive depth.

---

## 2. Current Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (App Router) |
| **Auth & Database** | Supabase (Auth, Postgres, service role client) |
| **Onboarding Conversation** | Anthropic Claude (claude-sonnet-4-20250514, Haiku fallback) |
| **Content Generation** | OpenAI GPT-4o-mini (news retrieval scoring, newsletter summarization, lesson generation, inbox classification, topic mapping, curriculum generation) |
| **News Retrieval** | Tavily Search API + Google News RSS |
| **Article Extraction** | @mozilla/readability + JSDOM (content hydration) |
| **Email Delivery** | Resend |
| **Styling** | Tailwind CSS + shadcn/ui (Radix primitives) |
| **Email Parsing** | Gmail API (googleapis), mailparser, html-to-text |
| **Encryption** | Node crypto (AES-256-GCM for OAuth tokens) |
| **Concurrency** | p-limit (parallel API calls) |
| **Validation** | Zod (env vars) |

---

## 3. Database Tables

All tables live in Supabase Postgres. Columns are inferred from `.from("table_name")` calls across the codebase — `select`, `insert`, `update`, `upsert`.

### `user_profiles`

Stores onboarding state and approved configuration per user.

| Column | Purpose |
|---|---|
| `user_id` | FK to auth.users (PK / unique) |
| `professional_context` | 1-2 sentence summary of user's role/industry |
| `stay_on_top_of` | Array of topics the user wants monitored |
| `get_sharper_on` | Array of topics the user wants to learn |
| `recommended_config` | JSONB — assembled config from recommendation phase (contains `raw_intent`, `slot_allocation`, etc.) |
| `approved_config` | JSONB — final config approved by user (contains `slot_allocation`, `digest_preferences`) |
| `onboarding_status` | Enum string: `conversation_done`, `config_ready`, `complete` |
| `onboarding_completed_at` | Timestamp of completion |
| `updated_at` | Last update timestamp |

**Unique constraint:** `user_id` (used in `onConflict: "user_id"`)

### `inbox_analysis`

Stores per-sender relevance scoring from the inbox scan during onboarding.

| Column | Purpose |
|---|---|
| `user_id` | FK to auth.users |
| `sender_address` | Email address of the sender |
| `sender_name` | Display name from the From header |
| `sender_domain` | Domain portion of sender address |
| `email_count` | Number of emails from this sender in scan window |
| `sample_subjects` | Array of up to 5 subject lines |
| `is_newsletter` | Boolean — true if relevance_score >= 0.3 |
| `category` | Content type string (e.g. "market news", "job alerts") |
| `estimated_frequency` | "daily", "weekly", or "occasional" |
| `relevance_score` | Float 0.0–1.0, LLM-assigned relevance to user interests |
| `relevance_reason` | One-sentence explanation from LLM |
| `disposition` | "unset" (default), "priority" (set on approve) |

**Unique constraint:** `user_id,sender_address` (used in `onConflict`)

### `connected_accounts`

Stores OAuth connections (currently Google only).

| Column | Purpose |
|---|---|
| `id` | Primary key |
| `user_id` | FK to auth.users |
| `provider` | "google" |
| `provider_account_id` | Google user ID |
| `account_email` | Google email address |
| `refresh_token` | Encrypted OAuth refresh token (legacy column) |
| `refresh_token_ciphertext` | Encrypted OAuth refresh token (preferred) |
| `status` | "connected" |

**Unique constraint:** `user_id,provider,account_email` (used in `onConflict`)

### `digest_configs`

Per-user digest delivery preferences and module toggles.

| Column | Purpose |
|---|---|
| `user_id` | FK to auth.users (PK / unique) |
| `cadence` | "daily" (locked for alpha) |
| `send_time` | Array of time strings, e.g. `["07:00"]` |
| `timezone` | IANA timezone string, e.g. "America/New_York" |
| `style` | "morning-brief", "deep-read", or "reference-mode" |
| `rune_name` | Optional custom name for the digest |
| `module_flags` | JSONB: `{ enable_newsletter_digest, enable_daily_news_topics, enable_daily_lessons }` |
| `module_defaults` | JSONB: `{ news_topic_timeframe, lesson_frequency, lesson_curriculum_days }` |
| `updated_at` | Last update timestamp |

**Unique constraint:** `user_id` (used in `onConflict: "user_id"`)

### `user_news_topics`

Active news monitoring topics. One record per news slot.

| Column | Purpose |
|---|---|
| `id` | Primary key (UUID) |
| `user_id` | FK to auth.users |
| `topic_text` | Normalized topic name |
| `topic_raw_text` | Original user-entered topic text |
| `timeframe` | "24h", "7d", etc. |
| `topic_mapping_json` | JSONB: `{ normalized_topic, scope_summary, retrieval_queries[], required_terms[][], retrieval_hint }` |
| `active` | Boolean — whether this topic is currently monitored |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |

### `user_lesson_topics`

Active learning curriculum topics. One record per lesson slot.

| Column | Purpose |
|---|---|
| `id` | Primary key (UUID) |
| `user_id` | FK to auth.users |
| `topic_text` | Normalized topic name |
| `topic_raw_text` | Original user-entered topic text |
| `curriculum_goal` | What the user should know by day 10 |
| `starting_level` | "beginner", "intermediate", or "advanced" |
| `topic_mapping_json` | JSONB: `{ normalized_topic, scope_summary, starting_level, curriculum_plan, lesson_state }` |
| `active` | Boolean — whether this topic is currently active |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |

`topic_mapping_json.lesson_state` tracks progress: `{ status: "active"|"paused"|"completed", next_day, last_generated_date, paused_at, completed_at }`.

`topic_mapping_json.curriculum_plan` stores the 10-day plan: `{ curriculum_title, target_level, day_count, days[], completion_signal }`.

### `user_newsletter_selections`

Tracks which senders the user wants curated.

| Column | Purpose |
|---|---|
| `user_id` | FK to auth.users |
| `sender_key` | Sender identifier (email address or domain key) |
| `selected` | Boolean — whether this sender is included in digest |
| `updated_at` | Last update timestamp |

**Unique constraint:** `user_id,sender_key` (used in `onConflict`)

### `digest_items`

Temporary storage for fetched email content and summaries during digest generation.

| Column | Purpose |
|---|---|
| `id` | Primary key (UUID) |
| `user_id` | FK to auth.users |
| `digest_id` | FK to digests (NULL while temporary) |
| `sender_key` | Sender identifier |
| `newsletter_name` | Display name of the sender |
| `subject` | Email subject line |
| `received_at` | When the email was received |
| `provider_message_id` | Gmail message ID |
| `html_content` | Raw HTML email body |
| `text_content` | Plain text email body |
| `links` | JSONB array of extracted URLs |
| `article_url` | First extracted link (backward compat) |
| `order_index` | Sort order within digest |
| `content_summary` | LLM-generated summary (NULL until summarized) |
| `preprocessed_content` | Cleaned content that was sent to LLM |
| `skip_reason` | "EMPTY", "SPARSE", or NULL |

### `digests`

Persisted, formatted digests ready for or already sent via email.

| Column | Purpose |
|---|---|
| `id` | Primary key (UUID) |
| `user_id` | FK to auth.users |
| `digest_date` | Date string "YYYY-MM-DD" |
| `generated_at` | Timestamp of generation |
| `status` | "generated", "sent", or "failed" |
| `html_content` | Full HTML email body |
| `text_content` | Plain text email body |
| `sent_at` | Timestamp of email delivery |
| `metadata` | JSONB: `{ newsletter_count, news_count, lesson_count, sections[], subject, email_delivery, module_errors }` |

**Unique constraint:** `user_id,digest_date` (used in `onConflict`)

### `generated_content_items`

Stores generated news briefs and lessons per user/topic/date.

| Column | Purpose |
|---|---|
| `user_id` | FK to auth.users |
| `module` | "news_topics" or "lessons" |
| `topic_id` | FK to user_news_topics or user_lesson_topics |
| `generated_date` | Date string "YYYY-MM-DD" |
| `title` | Generated content title |
| `content` | Generated content body (markdown) |
| `metadata` | JSONB — varies by module (references, article_count, lesson_day, retrieval_funnel, etc.) |
| `updated_at` | Last update timestamp |

**Unique constraint:** `user_id,module,topic_id,generated_date` (used in `onConflict`)

### `generated_content_runs`

Observability records for content generation runs.

| Column | Purpose |
|---|---|
| `id` | Primary key (UUID) |
| `user_id` | FK to auth.users |
| `module` | "newsletter", "news_topics", or "lessons" |
| `status` | "pending", "running", "completed", or "failed" |
| `started_at` | Timestamp |
| `finished_at` | Timestamp |
| `error` | Error message (if failed) |

### `messages_raw`

Stores email metadata from Gmail backfill (used for sender_key → from_email mapping in digest generation).

| Column | Purpose |
|---|---|
| `id` | Primary key |
| `user_id` | FK to auth.users |
| `sender_key` | Sender identifier |
| `from_email` | Sender email address |

### `digest_candidates`

Legacy table from the old 3-layer classification system. Stores classified sender data from `classify-senders`.

| Column | Purpose |
|---|---|
| `user_id` | FK to auth.users |
| `sender_key` | Sender identifier |
| *(other columns)* | Classification results from old LLM batch system |

### `system_state`

Simple key-value state store per user.

| Column | Purpose |
|---|---|
| `user_id` | FK to auth.users |
| `key` | State key (e.g. "default") |
| `value` | JSON-encoded value |

**Unique constraint:** `user_id` (used in `onConflict`)

---

## 4. Active Routes

### Onboarding — `/api/onboard/*`

| Route | Method | Description |
|---|---|---|
| `/api/onboard/chat` | POST | Drives the Claude conversation. Handles init (opening message), conversation turns, intent extraction, and recommendation generation. |
| `/api/onboard/scan-inbox` | POST | Scans user's Gmail primary inbox (14-day window), classifies senders against user interests via GPT-4o-mini, upserts results into `inbox_analysis`. |
| `/api/onboard/recommend` | POST | Receives Claude's recommendation JSON, enriches email slots with sender details from `inbox_analysis`, stores assembled config in `user_profiles`. |
| `/api/onboard/approve` | POST | Finalizes onboarding — creates `digest_configs`, `user_news_topics`, `user_lesson_topics`, and `user_newsletter_selections` records from the approved slot allocation. |
| `/api/onboard/preview-news-topic-density` | POST | Runs a 7-day news retrieval preview for a candidate topic and returns signal density (high/moderate/likely_sparse). |
| `/api/onboard/generate-lesson-curriculum` | POST | Generates a 10-day curriculum outline via GPT-4o-mini for a given lesson topic and scope. |
| `/api/onboard/rerun-setup` | POST | Resets onboarding/config state so user can re-onboard while keeping email history. |

### Digest Generation — `/api/digest/*`

| Route | Method | Description |
|---|---|---|
| `/api/digest/fetch-emails` | POST | Fetches full email bodies from Gmail API for selected newsletters, stores in `digest_items` with `digest_id = NULL`. |
| `/api/digest/generate-summaries` | POST | Generates LLM summaries for fetched emails in `digest_items` using GPT-4o-mini with style-specific prompts. |
| `/api/digest/generate-daily-news-topics` | POST | Generates daily news briefs for each active `user_news_topics` record using the tiered retrieval pipeline. |
| `/api/digest/generate-daily-lessons` | POST | Generates daily lessons for each active `user_lesson_topics` record using the stored curriculum plan. |
| `/api/digest/format` | POST | Builds a unified digest from all content modules, renders HTML/text, and persists to `digests` table. |
| `/api/digest/send` | POST | Sends a formatted digest via Resend email. Creates the digest if no `digest_id` is provided. |
| `/api/digest/generate` | POST | End-to-end: generates news + lessons, formats, and optionally sends. Used by both cron and manual triggers. |
| `/api/digest/config` | GET | Returns the user's current digest configuration. |
| `/api/digest/config` | POST | Saves/updates digest config, maps topics via LLM, persists `user_news_topics` and `user_lesson_topics`. |
| `/api/digest/verify` | GET | Verifies all requirements for digest generation (OAuth valid, newsletters selected, config set, messages exist). |
| `/api/digest/lesson-state` | GET | Returns lesson progress state for a given topic. |
| `/api/digest/lesson-state` | POST | Manages lesson state: pause, resume, done, switch_topic. |

### Cron — `/api/cron/*`

| Route | Method | Description |
|---|---|---|
| `/api/cron/generate-digests` | GET | Cron endpoint — iterates all `digest_configs`, checks send window, generates and sends digests for eligible users. Protected by `CRON_SECRET` bearer token. |

### Auth & Connect — `/api/connect/*`, `/auth/*`

| Route | Method | Description |
|---|---|---|
| `/api/connect/gmail/start` | GET | Initiates Google OAuth flow — redirects to Google consent screen with gmail.readonly scope. |
| `/api/connect/gmail/callback` | GET | Handles Google OAuth callback — exchanges code for tokens, encrypts refresh token, upserts `connected_accounts`. |
| `/auth/callback` | GET | Supabase auth callback — exchanges code for session, redirects to `/onboard`. |

### Backfill & Utilities

| Route | Method | Description |
|---|---|---|
| `/api/backfill/start` | POST | Fetches historical Gmail messages and stores metadata in `messages_raw` for sender_key mapping. |
| `/api/backfill/progress` | GET | Returns count of `messages_raw` records for the current user. |
| `/api/parse/progress` | GET | Returns counts from `messages_raw` and related tables for parse progress tracking. |
| `/api/export/features` | GET | Exports inbox analysis and digest data as CSV for debugging. |
| `/health` | GET | Simple health check — returns `{ status: "ok" }`. |

### Pages

| Route | Description |
|---|---|
| `/` | Landing/marketing page with hero section. |
| `/auth` | Login/register page (email+password or Google OAuth). |
| `/onboard` | Chat-based onboarding flow — full-screen conversational UI with Claude. |
| `/dashboard` | Post-onboarding dashboard — shows digest status, dev mode panel (non-prod), or legacy OnboardingFlow if config incomplete. |

---

## 5. Onboarding Flow

The current onboarding is a single-page conversational experience at `/onboard`.

### Step 1: User Signs Up
User registers via `/auth` (email+password or Google OAuth). Supabase auth callback redirects to `/onboard`.

### Step 2: Claude Conversation
The page calls `POST /api/onboard/chat` with `{ init: true }` to get Claude's opening message (randomized tone/vibe).

Claude uses `CONVERSATION_PROMPT` to learn about the user across five verticals:
1. **Occupation** — Who they are, role, industry
2. **Daily Basis I** — Work-related topics they want monitored
3. **Daily Basis II** — Non-work topics, news interests
4. **Lessons** — What they'd like to learn (10-day structured curriculum)
5. **Email Inbox** — Newsletter/recurring email curation needs

The conversation flows naturally (no forced sequence). Claude handles edge cases: vague answers, multiple topics, "I don't know" responses.

### Step 3: Intent Extraction
When Claude has enough information, it appends a hidden JSON block with `intent_ready: true` containing structured data:
```
{ professional_context, inferred_expertise_level, occupation_interests[], free_interest,
  learning_topic: { topic, starting_level, goal },
  inbox_preferences: { wants_inbox_curation, email_types_wanted[], notes } }
```

The chat route detects this signal, upserts `user_profiles` with the extracted intent, and returns `signal: "intent_ready"` to the frontend.

### Step 4: Gmail OAuth → Inbox Scan
If the user wants inbox curation, the frontend shows a "Connect Gmail" button. Clicking it redirects through `/api/connect/gmail/start` → Google consent → `/api/connect/gmail/callback` → back to `/onboard?step=scanning`.

On return, the frontend calls `POST /api/onboard/scan-inbox` which:
1. Gets the user's encrypted refresh token from `connected_accounts`
2. Lists Gmail messages from the last 14 days (primary category)
3. Groups by sender, filters by cadence (≥2 emails) and hard rules (skip transactional)
4. Scores remaining senders for relevance via GPT-4o-mini against user's stated interests
5. Upserts results into `inbox_analysis`
6. Returns a `scan_summary` with relevant senders, content types, and gaps

### Step 5: Recommendation Generation
The scan results (or a "no inbox data" note) are injected into the conversation as a system message. Claude uses `RECOMMENDATION_PROMPT` to generate a recommendation that maps the user's needs to 4 content slots (5 max overflow).

Claude's response includes a hidden JSON block with `recommendation_ready: true` containing:
```
{ slot_allocation: [{ slot, type, focus, ... }],
  allocation_notes, inbox_curation_plan, user_facing_summary[] }
```

The frontend calls `POST /api/onboard/recommend` which enriches email slots with full sender data from `inbox_analysis` and stores the assembled config in `user_profiles.recommended_config`.

### Step 6: User Approves
The frontend displays a `RecommendationCard` showing the user-facing summary and slot details. The user can type adjustments (which re-enter the Claude conversation) or click "Looks good."

On approval, the frontend calls `POST /api/onboard/approve` with the final config. This route:
1. Updates `user_profiles` with `approved_config` and `onboarding_status: "complete"`
2. Upserts `digest_configs` with delivery preferences and module flags
3. Creates one `user_news_topics` record per news slot (with `topic_mapping_json` containing retrieval_queries, required_terms, scope_summary)
4. Creates one `user_lesson_topics` record per lesson slot (with `topic_mapping_json` containing starting_level, curriculum_goal)
5. Creates `user_newsletter_selections` records for priority senders from email slots
6. Updates `inbox_analysis` disposition to "priority" for selected senders

### Step 7: Completion Screen
The frontend shows a completion screen: "You're all set. Your first delivery arrives tomorrow at 7:00 AM."

---

## 6. Digest Generation Pipeline

The daily digest is generated either manually via `/api/digest/generate` or automatically via the cron endpoint `/api/cron/generate-digests`.

### Cron Flow (`/api/cron/generate-digests`)

1. Fetches all `digest_configs`
2. For each user, checks if the current time falls within their `send_time` ± 15 minutes (timezone-aware)
3. Skips if a digest with `status: "sent"` already exists for today
4. Runs the full pipeline and sends

### Pipeline Steps

#### Step 1: Fetch Emails (`/api/digest/fetch-emails`)
- Reads `user_newsletter_selections` (selected = true) to get sender_keys
- Looks up `from_email` addresses from `messages_raw` for each sender_key
- Queries Gmail API for recent messages from those senders
- Fetches full email bodies, parses HTML/text, extracts links
- Stores in `digest_items` with `digest_id = NULL` (temporary)

#### Step 2: Generate Summaries (`/api/digest/generate-summaries`)
- Reads `digest_items` where `digest_id IS NULL` and `content_summary IS NULL`
- Converts HTML to text, strips boilerplate (unsubscribe, footers, tracking URLs)
- Applies sparse content protocol (skips LLM for empty/very short emails)
- Batches items by character count (~50k chars per batch)
- Calls GPT-4o-mini with style-specific prompts (morning-brief / deep-read / reference-mode)
- Updates `content_summary` and `preprocessed_content` on each `digest_items` row

#### Step 3: Generate Daily News (`/api/digest/generate-daily-news-topics`)
Delegates to `generateDailyNewsTopics()` in `lib/digest/generator.ts`:
- For each active `user_news_topics` record:
  - Checks for existing generated content for today (skip if exists unless force-regenerate)
  - Retrieves recently-used article URLs to avoid repeats
  - Runs **tiered freshness retrieval**: tries 24h → 72h → 7d windows until enough relevant articles are found
  - Each tier: fetches from **Google News RSS** + **Tavily** simultaneously, deduplicates cross-provider
  - Filters: substantive article check → topic pre-filter (required_terms) → article hydration (fetch full content via Readability) → LLM relevance scoring
  - Synthesizes a news brief via GPT-4o-mini from the relevant articles
  - Upserts into `generated_content_items`

#### Step 4: Generate Daily Lessons (`/api/digest/generate-daily-lessons`)
Delegates to `generateDailyLessons()` in `lib/digest/generator.ts`:
- For each active `user_lesson_topics` record:
  - Reads lesson state (next_day, status) from `topic_mapping_json.lesson_state`
  - Skips if paused or completed
  - Finds the day plan from `topic_mapping_json.curriculum_plan.days[]`
  - Calls GPT-4o-mini to write the lesson content (400-700 words, conversational tone)
  - Advances `lesson_state.next_day` and upserts into `generated_content_items`

#### Step 5: Format (`/api/digest/format`)
- `buildUnifiedDigest()` queries all three content sources in parallel:
  - `digest_items` (newsletter summaries)
  - `generated_content_items` where module = "news_topics"
  - `generated_content_items` where module = "lessons"
- Assembles sections in order: Newsletter Summaries → Daily News Topics → Daily Lesson
- `renderDigestHtml()` produces a dark-themed HTML email (background #0b0b12)
- `renderDigestText()` produces a plain-text fallback
- `persistFormattedDigest()` upserts into `digests` table

#### Step 6: Send (`/api/digest/send`)
- Fetches the formatted digest from `digests` table
- Determines recipient email (from request body or Supabase auth)
- Sends via Resend API
- Updates `digests` with `status: "sent"`, `sent_at`, and delivery metadata

---

## 7. Slot Architecture

Rune uses a **4+1 slot model** to structure each user's daily digest content.

### Model
- Each user gets **4 content slots** (a 5th is allowed as optional overflow only if 4 genuinely cannot cover the user's needs)
- Each slot is one of three types: `email`, `news`, or `lesson`
- Slots are assigned during the onboarding recommendation phase by Claude

### Storage
- The full slot allocation is stored in `user_profiles.approved_config.slot_allocation` as a JSONB array:
  ```json
  [
    { "slot": 1, "type": "email", "focus": "...", "priority_senders": ["addr1", "addr2"] },
    { "slot": 2, "type": "news", "focus": "...", "retrieval_queries": [...], "required_terms": [...], "scope_summary": "..." },
    { "slot": 3, "type": "news", "focus": "...", ... },
    { "slot": 4, "type": "lesson", "focus": "...", "starting_level": "...", "curriculum_goal": "..." }
  ]
  ```

### Record Creation on Approve
The `/api/onboard/approve` route expands slots into individual table records:

- **News slots** → One `user_news_topics` record per news slot, with `topic_mapping_json` containing the slot's `retrieval_queries`, `required_terms`, and `scope_summary`
- **Lesson slots** → One `user_lesson_topics` record per lesson slot, with `topic_mapping_json` containing `starting_level` and `curriculum_goal`
- **Email slots** → `user_newsletter_selections` records for each priority sender, plus `inbox_analysis` disposition updates

### Module Flags
The `digest_configs.module_flags` JSONB controls which modules run during digest generation:
```json
{
  "enable_newsletter_digest": true,
  "enable_daily_news_topics": true,
  "enable_daily_lessons": true
}
```
Flags are set based on which slot types exist in the approved allocation.

---

## 8. Legacy/Deprecated Code

The following files and routes appear to be from older onboarding versions (pre-chat-based flow) and may no longer be used in the primary user path.

### Routes

| Route | Status | Notes |
|---|---|---|
| `/api/onboard/classify-senders` | **Deprecated** | Old 3-layer classification system (domain + cadence + LLM batch). Replaced by `scan-inbox` which does relevance-based scoring in a single pass. Writes to `digest_candidates` table. |
| `/api/onboard/finalize-selections` | **Deprecated** | Old manual newsletter selection endpoint. Users now get automatic selections from Claude's recommendation. Reads from `digest_candidates`. |
| `/api/onboard/clarify-news-topic` | **Deprecated** | Old step-based onboarding — ran a separate GPT-4o-mini clarification conversation for news topics. Now handled inline by Claude in the unified chat. |
| `/api/onboard/clarify-lesson-topic` | **Deprecated** | Old step-based onboarding — ran a separate GPT-4o-mini clarification conversation for lesson topics. Now handled inline by Claude. |
| `/api/onboard/classified-senders` | **Deprecated** | Read endpoint for classified senders from `digest_candidates`. Used by old dashboard-based onboarding UI. |
| `/api/onboard/rerun-setup` | **Semi-active** | Resets configuration state for re-onboarding. May still be useful but not part of the primary flow. |

### Components

| Component | Status | Notes |
|---|---|---|
| `components/OnboardingFlow.tsx` | **Deprecated** | Old dashboard-based multi-step onboarding wizard (ConnectGmailCard, BackfillParseControls, etc.). Still imported by `/dashboard` as a fallback when digest config is incomplete. |
| `components/ConnectGmailCard.tsx` | **Deprecated** | Card component from old onboarding flow. |
| `components/NewsletterSelectionCard.tsx` | **Deprecated** | Manual newsletter selection UI from old onboarding. |
| `components/CadenceSelectionCard.tsx` | **Deprecated** | Cadence selection card from old onboarding (now locked to "daily"). |
| `components/StyleSelectionCard.tsx` | **Deprecated** | Style selection card from old onboarding. |
| `components/TimeSelectionCard.tsx` | **Deprecated** | Time picker card from old onboarding. |
| `components/BackfillParseControls.tsx` | **Deprecated** | Backfill/parse controls from old onboarding. |
| `components/CustomTimePicker.tsx` | **Deprecated** | Time picker used by TimeSelectionCard. |
| `components/SynthesisHero.tsx` | **Deprecated** | Hero component from old onboarding. |

### Libraries

| File | Status | Notes |
|---|---|---|
| `lib/onboard/llm-batch.ts` | **Deprecated** | Batch LLM classification for senders. Used by `classify-senders` route. |
| `lib/onboard/hard-rules.ts` | **Active** | Hard-rules filter for transactional/promotional senders. Still used by `scan-inbox`. |
| `lib/onboard/sender-extraction.ts` | **Active** | Extracts sender_key from email headers. Used by both `backfill/start` and `digest/fetch-emails`. |

### Tables

| Table | Status | Notes |
|---|---|---|
| `digest_candidates` | **Deprecated** | Used by old `classify-senders` and `finalize-selections` routes. Replaced by `inbox_analysis`. |
| `retrieval_logs` | **Not referenced in code** | Listed in docs but no `.from("retrieval_logs")` calls exist in the current codebase. |

---

## 9. Environment Variables

All required environment variables (values not included):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public, used client-side) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public API key |
| `SUPABASE_SERVICE_ROLE` | Supabase service role key (server-only, bypasses RLS) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude (onboarding conversation) |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o-mini (content generation, classification, summarization) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud OAuth 2.0 client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud OAuth 2.0 client secret |
| `NEXT_PUBLIC_SITE_URL` | Public site URL for OAuth redirect URIs (e.g. `https://yourapp.com`) |
| `ENCRYPTION_KEY` | Base64-encoded 32-byte key for AES-256-GCM encryption of OAuth tokens |
| `TAVILY_API_KEY` | Tavily Search API key (news retrieval) |
| `RESEND_API_KEY` | Resend API key (email delivery) |
| `RESEND_FROM_EMAIL` | Sender address for digest emails (defaults to `Rune <onboarding@resend.dev>`) |
| `CRON_SECRET` | Bearer token for authenticating cron endpoint calls |
| `OVERRIDE_RECIPIENT` | (Optional) If set, all digest emails go to this address instead of the user's. For alpha testing. |

---

## 10. Alpha Testing Plan

For closed alpha with ~6 users:

1. Deploy to Vercel with production domain
2. Friends complete onboarding via `/onboard` on mobile
3. Set `OVERRIDE_RECIPIENT=your@email.com` in Vercel env vars — all 6 users' digests route to your inbox for review
4. Monitor digest quality for 1-2 days
5. Remove `OVERRIDE_RECIPIENT` to release digests to users' actual inboxes
6. Users test for ~1 week, collect feedback

The override is a one-line check in `lib/digest/email.ts` — when `OVERRIDE_RECIPIENT` is set, it replaces the recipient address before sending via Resend.
