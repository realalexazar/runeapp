# Phase 0a LLM Call Inventory

Last updated: 2026-05-24

This is the static inventory for Phase 0a. It maps every production-relevant LLM call site found in `app/` and `lib/`, the output contract currently expected, and whether runtime telemetry is wired.

## Summary

- Runtime telemetry table: `public.llm_call_telemetry`
- Migration: `supabase/migrations/20260522090000_phase0a_telemetry.sql`
- Baseline query: `docs/phase0a_llm_cost_baseline.sql`
- Shared telemetry helper: `lib/ai/llm-telemetry.ts`
- Current validation posture: one low-risk call site has Phase 0b schema validation. The rest of the live system is mostly `regex` / ad hoc JSON extraction.

## Inventory

| Call site | File / function | Provider | Model | Purpose | Validation | Output shape | Telemetry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `onboard.chat.opening_message` | `app/api/onboard/chat/route.ts` / `POST` | Anthropic | `claude-sonnet-4-20250514` | First Rune chat message | `none` | `OnboardOpeningMessage` | yes |
| `onboard.chat.conversation_turn` | `app/api/onboard/chat/route.ts` / `POST` | Anthropic | `claude-sonnet-4-20250514` | Main onboarding conversation and intent signal | `regex` | `OnboardIntentSignal` | yes |
| `onboard.chat.recommendation_copy` | `app/api/onboard/chat/route.ts` / `POST` | Anthropic | `claude-sonnet-4-20250514` | User-facing recommendation copy | `regex` | `OnboardRecommendationSignal` | yes |
| `onboard.chat.technical_config` | `app/api/onboard/chat/route.ts` / `generateTechnicalConfig` | OpenAI/OpenRouter | `gpt-4o` | Slot allocation and retrieval config | `regex` | `OnboardTechnicalConfig` | yes |
| `onboard.scan_inbox.sender_relevance` | `app/api/onboard/scan-inbox/route.ts` / `POST` | OpenAI/OpenRouter | `gpt-4o-mini` | Score inbox senders against user intent | `schema` | `InboxSenderRelevance` | yes |
| `onboard.classify_senders.batch` | `lib/onboard/llm-batch.ts` / `callOpenAI` | OpenAI | `gpt-4o-mini` | Batch newsletter vs. non-newsletter classification | `regex` | `SenderClassificationArray` | yes |
| `onboard.clarify_news_topic` | `app/api/onboard/clarify-news-topic/route.ts` / `POST` | OpenAI/OpenRouter | `gpt-4o-mini` | Legacy/dashboard news topic clarifier | `schema` | `NewsTopicClarifier` | yes |
| `onboard.clarify_lesson_topic` | `app/api/onboard/clarify-lesson-topic/route.ts` / `POST` | OpenAI/OpenRouter | `gpt-4o-mini` | Legacy/dashboard lesson topic clarifier | `schema` | `LessonTopicClarifier` | yes |
| `onboard.generate_lesson_curriculum` | `app/api/onboard/generate-lesson-curriculum/route.ts` / `POST` | OpenAI/OpenRouter | `gpt-4o-mini` | Legacy/dashboard standalone curriculum generation | `schema` | `LessonCurriculum` | yes |
| `onboard.approve.curriculum_plan` | `lib/onboard/generate-curriculum.ts` / `generateCurriculumPlan` | OpenAI/OpenRouter | `gpt-4o` | Approve/backfill curriculum plan generation | `schema` | `LessonCurriculum` | yes |
| `digest.config.topic_mapping` | `app/api/digest/config/route.ts` / `mapTopicsWithLLM` | OpenAI/OpenRouter | `gpt-4o-mini` | Legacy/dashboard topic mapping into digest config | `schema` | `TopicMappingResult` | yes |
| `digest.newsletters.summarize_chunk` | `lib/digest/summarize-newsletters.ts` / `summarizeChunk` | OpenAI/OpenRouter | `gpt-4o` | Cron newsletter batch summaries | `regex` | `NewsletterSummaryMap` | yes |
| `digest.dev_generate_summaries.batch` | `app/api/digest/generate-summaries/route.ts` / `summarizeBatchSingle` | OpenAI/OpenRouter | `gpt-4o-mini` or `gpt-4o` | Dev/dashboard batch summaries | `regex` | `NewsletterSummaryArray` | yes |
| `digest.news.relevance_filter` | `lib/digest/generator.ts` / `filterRelevantNewsArticles` | OpenAI/OpenRouter | `gpt-4o` | Legacy/preview news relevance filter | `regex` | `NewsRelevanceEvaluations` | yes |
| `digest.news.synthesize_brief_legacy` | `lib/digest/generator.ts` / `synthesizeNewsBrief` | OpenAI/OpenRouter | `gpt-4o` | Legacy news synthesis path | `regex` | `NewsBrief` | yes |
| `digest.news.unified_filter_and_synthesize` | `lib/digest/generator.ts` / `unifiedFilterAndSynthesize` | OpenAI/OpenRouter | `gpt-4o` | Current daily news filter + synthesis path | `regex` | `UnifiedNewsBrief` | yes |
| `digest.lessons.synthesize_content` | `lib/digest/generator.ts` / `synthesizeLessonContent` | Anthropic | `claude-sonnet-4-20250514` | Current daily lesson content generation | `regex` | `DailyLessonContent` | yes |

## Pricing Notes

`lib/ai/llm-telemetry.ts` uses a static Phase 0a rate card for the models currently in the repo. Rates should be reviewed before Phase 0b and whenever model names change.

- OpenAI `gpt-4o`: $2.50 / 1M input tokens, $10.00 / 1M output tokens.
- OpenAI `gpt-4o-mini`: $0.15 / 1M input tokens, $0.60 / 1M output tokens.
- Anthropic `claude-sonnet-4-20250514`: $3.00 / 1M input tokens, $15.00 / 1M output tokens.
- Anthropic `claude-haiku-4-5`: $1.00 / 1M input tokens, $5.00 / 1M output tokens.
- Anthropic `claude-3-5-haiku-*`: $0.80 / 1M input tokens, $4.00 / 1M output tokens.

The Anthropic fallback in `lib/anthropic/chat.ts` is `claude-haiku-4-5`, matching Anthropic's current Haiku 4.5 API guidance.

Sources checked on 2026-05-22:
- https://platform.openai.com/docs/pricing/
- https://docs.anthropic.com/en/docs/about-claude/models/overview
- https://www.anthropic.com/claude/haiku

## Follow-Up For Phase 0b

- Replace `regex` extraction with named Zod schemas.
- Raw-output capture for schema validation failures is now available in `public.llm_validation_failures` with 30-day retention metadata.
- Route `lib/onboard/llm-batch.ts` through the future LLM gateway; it is still direct OpenAI fetch for Phase 0a measurement.
- Use `docs/phase0a_external_api_inventory.md` for non-LLM API call tracking; Tavily runtime telemetry is wired, Gmail remains static inventory.
