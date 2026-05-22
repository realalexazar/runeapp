# Phase 0a External API Inventory

Last updated: 2026-05-22

This inventory covers paid or quota-sensitive non-LLM calls. Phase 0a runtime telemetry is wired for Tavily first because it is the current paid search provider in the daily news path.

## Runtime Telemetry

| Call site | File / function | Provider | Endpoint | Purpose | Telemetry |
| --- | --- | --- | --- | --- | --- |
| `digest.news.tavily_search` | `lib/digest/generator.ts` / `fetchTavilyNews` | Tavily | `https://api.tavily.com/search` | News retrieval for daily news slots | yes |

Runtime table: `public.external_api_call_telemetry`

Baseline query: `docs/phase0a_external_api_baseline.sql`

## Static Inventory Not Yet Wired

| File / function | Provider | Endpoint/API | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `lib/digest/generator.ts` / `fetchGoogleNewsForTier` | Google News RSS | `news.google.com/rss/search` | Free fallback retrieval when Tavily is thin | Latency and result health useful; direct cost likely zero |
| `lib/digest/generator.ts` / `hydrateArticlePreview` | General web | Article URLs | Hydrates article content with Readability/html-to-text | Needs scraper/provider abstraction in Phase 2 |
| `app/api/onboard/scan-inbox/route.ts` | Google OAuth | `oauth2.googleapis.com/token` | Exchanges refresh token during inbox scan | Quota/latency sensitive |
| `app/api/onboard/scan-inbox/route.ts` | Gmail | `gmail.googleapis.com/gmail/v1/users/me/messages` | Lists inbox messages and fetches metadata | Quota/latency sensitive; does not fetch full body in this path |
| `lib/digest/fetch-newsletters.ts` | Gmail | Gmail API | Fetches newsletter messages for digest | Needs runtime telemetry before Phase 0a exit |
| `app/api/digest/fetch-emails/route.ts` | Gmail | Gmail API | Dev/dashboard email fetch path | Dev path; classify before cleanup |
| `app/api/backfill/start/route.ts` | Gmail | Gmail API | Backfill fetch path | Dev/backfill path; classify before cleanup |

## Follow-Up

- Add Gmail telemetry before Phase 0a exit if inbox/digest cost or quota usage becomes material.
- Add Google News RSS telemetry if latency or fallback quality is hard to reason about.
- Move all provider calls behind provider interfaces in Phase 2, after Phase 0b schemas and Phase 0c state are stable.
