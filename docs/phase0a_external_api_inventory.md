# Phase 0a External API Inventory

Last updated: 2026-05-24

This inventory covers paid or quota-sensitive non-LLM calls. Phase 0a runtime telemetry is wired for the production Tavily, Gmail, and Google OAuth paths. Metadata is intentionally sanitized: no OAuth tokens, message ids, subjects, sender addresses, private email bodies, or raw Gmail queries.

## Runtime Telemetry

| Call site | File / function | Provider | Endpoint | Purpose | Telemetry |
| --- | --- | --- | --- | --- | --- |
| `digest.news.tavily_search` | `lib/digest/generator.ts` / `fetchTavilyNews` | Tavily | `https://api.tavily.com/search` | News retrieval for daily news slots | yes |
| `connect.gmail.google_oauth_get_token` | `app/api/connect/gmail/callback/route.ts` / `GET` | Google OAuth | `oauth2.getToken` | Exchanges Google OAuth code for tokens during Gmail connect | yes |
| `connect.gmail.google_oauth_userinfo` | `app/api/connect/gmail/callback/route.ts` / `GET` | Google OAuth | `userinfo.get` | Fetches Google account id/email after Gmail connect | yes |
| `digest.verify.gmail_profile` | `app/api/digest/verify/route.ts` / `GET` | Gmail | `users.getProfile` | Lightweight OAuth validation in digest status tooling | yes |
| `onboard.scan_inbox.google_oauth_token` | `app/api/onboard/scan-inbox/route.ts` / `POST` | Google OAuth | `token` | Exchanges refresh token for onboarding inbox scan | yes |
| `onboard.scan_inbox.gmail_messages_list` | `app/api/onboard/scan-inbox/route.ts` / `POST` | Gmail | `messages.list` | Lists primary inbox messages for sender discovery | yes |
| `onboard.scan_inbox.gmail_messages_get_metadata` | `app/api/onboard/scan-inbox/route.ts` / `POST` | Gmail | `messages.get.metadata` | Fetches sender/subject metadata for onboarding sender scoring | yes |
| `digest.newsletters.gmail_profile` | `lib/digest/fetch-newsletters.ts` / `fetchNewslettersForUser` | Gmail | `users.getProfile` | Validates Gmail token before newsletter fetch | yes |
| `digest.newsletters.gmail_messages_list` | `lib/digest/fetch-newsletters.ts` / `fetchNewslettersForUser` | Gmail | `messages.list` | Lists selected sender messages for newsletter digest | yes |
| `digest.newsletters.gmail_messages_get_metadata` | `lib/digest/fetch-newsletters.ts` / `fetchNewslettersForUser` | Gmail | `messages.get.metadata` | Filters selected sender messages before full fetch | yes |
| `digest.newsletters.gmail_messages_get_full` | `lib/digest/fetch-newsletters.ts` / `fetchNewslettersForUser` | Gmail | `messages.get.full` | Fetches newsletter bodies for digest item staging | yes |

Runtime table: `public.external_api_call_telemetry`

Baseline query: `docs/phase0a_external_api_baseline.sql`

## Static Inventory Not Yet Wired

| File / function | Provider | Endpoint/API | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `lib/digest/generator.ts` / `fetchGoogleNewsForTier` | Google News RSS | `news.google.com/rss/search` | Free fallback retrieval when Tavily is thin | Latency and result health useful; direct cost likely zero |
| `lib/digest/generator.ts` / `hydrateArticlePreview` | General web | Article URLs | Hydrates article content with Readability/html-to-text | Needs scraper/provider abstraction in Phase 2 |
| `app/api/digest/fetch-emails/route.ts` | Gmail | Gmail API | Dev/dashboard email fetch path | Dev path; classify before cleanup |
| `app/api/backfill/start/route.ts` | Gmail | Gmail API | Backfill fetch path | Dev/backfill path; classify before cleanup |

## Follow-Up

- Add Google News RSS telemetry if latency or fallback quality is hard to reason about.
- Decide whether `app/api/digest/fetch-emails` and `app/api/backfill/start` remain dev-only or should be removed/repointed to the shared newsletter fetch path.
- Move all provider calls behind provider interfaces in Phase 2, after Phase 0b schemas and Phase 0c state are stable.
