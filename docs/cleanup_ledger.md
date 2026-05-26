# Cleanup Ledger

Last updated: 2026-05-26

This ledger tracks stale migrations, antiquated code paths, and outdated product messages discovered during Phase 0a. Cleanup should be deliberate: classify first, remove only after the canonical path and rollback story are clear.

## Rules

- Do not delete a route, component, or SQL file until its current callers are known.
- If a file is kept only for dev tooling, label it as dev-only in code or docs.
- If a SQL file is not a canonical migration, move it toward `docs/` archival or promote it into `supabase/migrations/`.
- User-facing copy cleanup is allowed when it removes obsolete product framing, but avoid redesigning onboarding during Phase 0a.

## Items

| Area | Item | Evidence | Current status | Proposed action |
| --- | --- | --- | --- | --- |
| Migrations | `supabase/migrations/` contains only `20260401120000_onboard_phase_and_commit_approval.sql` plus the new Phase 0a telemetry migration | Current production schema appears to live mostly outside repo migrations | Needs schema ground truth | Export current Supabase schema before deleting or rewriting migration history |
| SQL docs | `docs/migrations/*.sql` and many root `docs/*.sql` files | SQL files are documentation/helper scripts, not canonical Supabase migrations | Ambiguous | Classify each as `historical`, `query`, or `promote-to-migration` |
| Package metadata | `package.json` name was `"mortgage"` | Product is Rune | Cleaned | Renamed package to `runeapp` |
| Dashboard onboarding | `app/(app)/dashboard/page.tsx` imported legacy onboarding/dev surfaces | User confirmed dashboard was a dev tool; app onboarding is `app/onboard/page.tsx` | Cleaned in Phase 0c | Dashboard now redirects unfinished users to `/onboard`; legacy wizard and dev panel imports removed |
| Old onboarding cards | `components/OnboardingFlow.tsx`, `components/StyleSelectionCard.tsx`, `NewsletterSelectionCard`, related routes | Existing docs already mark pieces deprecated | Cleaned in Phase 0c | Deleted dashboard-era onboarding card components after canonical `/onboard` state machine landed |
| Legacy clarifiers | `/api/onboard/clarify-news-topic`, `/api/onboard/clarify-lesson-topic`, `/api/onboard/generate-lesson-curriculum` | Used by `StyleSelectionCard`, not main `/onboard` chat | Cleaned in Phase 0c | Deleted with old dashboard onboarding route callers |
| Legacy sender selection | `/api/onboard/classify-senders`, `/api/onboard/classified-senders`, `/api/onboard/finalize-selections`, `lib/onboard/llm-batch.ts` | Old manual newsletter selection path; current onboarding uses `/api/onboard/scan-inbox` and recommendation cards | Cleaned in Phase 0c | Deleted old sender classification/selection endpoints and batch classifier |
| Legacy topic preview | `/api/onboard/preview-news-topic-density` and `previewNewsTopicSignal` | Only called by deleted `StyleSelectionCard` | Cleaned in Phase 0c | Deleted preview route and unused relevance-filter schema/path |
| Duplicate summarization | `lib/digest/summarize-newsletters.ts` and `app/api/digest/generate-summaries/route.ts` | Cron and dev route have different prompts/parsing | Duplicate logic | Make `lib/digest/summarize-newsletters.ts` canonical; convert dev route to call shared module |
| Dev mode panel | `components/DevModePanel.tsx` manually called digest generation and historical fetch/backfill routes | Non-production UI was keeping obsolete manual paths alive | Cleaned in Phase 0c | Deleted; dashboard now only shows configured digest status |
| Dev Gmail fetch route | `app/api/digest/fetch-emails/route.ts` fetched Gmail bodies directly | Dashboard-era endpoint had no callers after dev panel removal | Cleaned in Phase 0c | Deleted; shared newsletter fetching remains in `lib/digest/fetch-newsletters.ts` |
| Backfill start route | `app/api/backfill/start/route.ts` backfilled Gmail metadata directly | Dev/backfill endpoint had no callers after dev panel removal | Cleaned in Phase 0c | Deleted; onboarding inbox discovery remains in `/api/onboard/scan-inbox` |
| Backfill/parse progress routes | `app/api/backfill/progress` and `app/api/parse/progress` reported dashboard-era progress counts | Only useful for deleted manual backfill/parse UI | Cleaned in Phase 0c | Deleted with the dev panel and historical backfill route |
| News generation dead weight | `_synthesizeNewsBrief` in `lib/digest/generator.ts` | `rg` showed no production callers | Cleaned | Removed the unused legacy synthesis path; current production news uses `unifiedFilterAndSynthesize` |
| LLM batch bypass | `lib/onboard/llm-batch.ts` directly fetched OpenAI | It bypassed retry/OpenRouter wrapper | Cleaned | Routed through the Phase 0b LLM gateway with `SenderClassificationBatch` schema validation |
| Anthropic fallback model | `lib/anthropic/chat.ts` fallback now uses `claude-haiku-4-5` | Previous exact fallback ID looked stale; Anthropic's Haiku page says to use `claude-haiku-4-5` | Cleaned in Phase 0a | Reconfirm during Phase 0b gateway migration |
| Console noise | Client onboarding components and digest retrieval emitted dev-era `console.log` noise | Build lint warnings and noisy prod/dev logs | Cleaned | Removed redundant logs where telemetry or UI state already covers the signal |
| Product copy | Dashboard copy said `Post-onboarding dashboard coming soon...` | Dashboard is not current product surface | Cleaned | Removed obsolete card from configured dashboard state |
| External API telemetry | Production retrieval paths lacked complete external API telemetry | Inbox scan, newsletter fetch, fallback search, and article hydration are quota-sensitive or latency-sensitive | Cleaned | Added runtime telemetry for Tavily, Google News RSS, web article hydration, Gmail connect, inbox scan, digest verify, and shared newsletter fetch |
| Dependencies | `npm install` reports 8 moderate vulnerabilities and deprecated `@react-email/*` packages | Install output during Phase 0a verification | Dependency debt | Run `npm audit` and plan React Email package update separately from Phase 0a telemetry |
| Production data | User `0c8ed9ca-7734-4d48-8cf4-7fadb778b775` had a duplicate active lesson topic missing `curriculum_plan` | Controlled 2026-05-24 generation produced a `Lesson setup needed` fallback item | Cleaned | Deactivated duplicate topic `76fc2e37-7e84-4cb0-9ba2-30c4af741082` and deleted generated fallback item `444d6910-0a46-47ac-b883-ae295826f876` |

## Immediate Non-Deletes

These are intentionally not removed in Phase 0a:

- Legacy onboarding docs, because they preserve rebuild history even after code deletion. Historical docs that claim deleted routes are active should be archived or updated when touched.
- Duplicate summarization code, because it may still be useful for dev iteration and needs a canonical replacement.
- Historical SQL files, because production schema history has not been reconciled yet.
