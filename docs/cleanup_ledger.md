# Cleanup Ledger

Last updated: 2026-05-22

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
| Package metadata | `package.json` name is `"mortgage"` | Product is Rune | Stale metadata | Rename after Phase 0a or in a tiny metadata-only commit |
| Dashboard onboarding | `app/(app)/dashboard/page.tsx` imports `components/OnboardingFlow.tsx` | User confirmed dashboard was a dev tool; app onboarding is `app/onboard/page.tsx` | Legacy/dev | Gate as dev-only or remove after onboarding state machine lands |
| Old onboarding cards | `components/OnboardingFlow.tsx`, `components/StyleSelectionCard.tsx`, `NewsletterSelectionCard`, related routes | Existing docs already mark pieces deprecated | Legacy/dev | Quarantine behind dev route or delete after Phase 0c canonical onboarding exists |
| Legacy clarifiers | `/api/onboard/clarify-news-topic`, `/api/onboard/clarify-lesson-topic`, `/api/onboard/generate-lesson-curriculum` | Used by `StyleSelectionCard`, not main `/onboard` chat | Legacy/dev | Keep measured in Phase 0a; remove when dashboard onboarding is removed |
| Duplicate summarization | `lib/digest/summarize-newsletters.ts` and `app/api/digest/generate-summaries/route.ts` | Cron and dev route have different prompts/parsing | Duplicate logic | Make `lib/digest/summarize-newsletters.ts` canonical; convert dev route to call shared module |
| News generation dead weight | `synthesizeNewsBrief` and `fetchNewsArticles` in `lib/digest/generator.ts` | `rg` shows no production callers | Likely dead | Delete after telemetry confirms no route reaches them |
| LLM batch bypass | `lib/onboard/llm-batch.ts` directly fetches OpenAI | It bypasses retry/OpenRouter wrapper | Measured but still direct | Route through Phase 0b LLM gateway |
| Anthropic fallback model | `lib/anthropic/chat.ts` fallback now uses `claude-haiku-4-5` | Previous exact fallback ID looked stale; Anthropic's Haiku page says to use `claude-haiku-4-5` | Cleaned in Phase 0a | Reconfirm during Phase 0b gateway migration |
| Console noise | `components/OnboardingFlow.tsx` has render/step `console.log` calls | Dev-era messages in a client component | Dev noise | Remove when old dashboard onboarding is quarantined |
| Product copy | Dashboard copy says `Post-onboarding dashboard coming soon...` | Dashboard is not current product surface | Outdated | Remove or mark dev-only during Phase 0c |
| Dependencies | `npm install` reports 8 moderate vulnerabilities and deprecated `@react-email/*` packages | Install output during Phase 0a verification | Dependency debt | Run `npm audit` and plan React Email package update separately from Phase 0a telemetry |

## Immediate Non-Deletes

These are intentionally not removed in Phase 0a:

- Legacy onboarding endpoints, because dashboard/dev tooling still calls them.
- Duplicate summarization code, because it may still be useful for dev iteration and needs a canonical replacement.
- Historical SQL files, because production schema history has not been reconciled yet.
