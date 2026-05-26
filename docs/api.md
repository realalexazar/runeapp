# API Reference

Last updated: 2026-05-26

This document describes the current implemented HTTP surface. User routes require a valid Supabase session unless a route explicitly says otherwise.

## Auth And Connect

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/auth/callback` | GET | Supabase OAuth callback | Exchanges a Supabase auth code for a session and redirects to onboarding. |
| `/api/connect/gmail/start` | GET | Supabase session | Starts Google OAuth for Gmail readonly access. |
| `/api/connect/gmail/callback` | GET | OAuth state cookie | Exchanges Google OAuth code, encrypts refresh token, and stores the connected account. |

## Onboarding

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/onboard/state` | GET | Returns the server-owned onboarding snapshot for the current user. |
| `/api/onboard/chat` | POST | Persists a chat turn, updates structured intent, and returns the updated snapshot. |
| `/api/onboard/build` | POST | Runs the minimum intent gate for the user-triggered Build my Rune action. |
| `/api/onboard/inbox-preference` | POST | Persists `wanted`, `not_wanted`, or `skipped` inbox preference. |
| `/api/onboard/scan-inbox` | POST | Scans Gmail metadata for recurring senders and persists a scan artifact. |
| `/api/onboard/recommend` | POST | Generates and persists typed recommendation cards from current intent and scan context. |
| `/api/onboard/refine` | POST | Applies a schema-validated natural-language patch to recommendation cards. |
| `/api/onboard/cards/[cardId]` | PATCH | Applies a direct card edit with stale-version checks. |
| `/api/onboard/approve` | POST | Commits one validated onboarding config into digest config, topics, lessons, and newsletter selections. |
| `/api/onboard/rerun-setup` | POST | Resets onboarding/config state so the user can re-run setup. |
| `/api/onboard/backfill-curricula` | GET | Dev/admin repair helper for lesson topics missing curriculum plans. Requires `CRON_SECRET` bearer in production. |

## Digest

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/digest/config` | GET | Returns the current user's digest configuration. |
| `/api/digest/config` | POST | Saves digest configuration and maps topics into durable topic records. |
| `/api/digest/verify` | GET | Verifies digest readiness: config, Gmail status, selected senders, and content prerequisites. |
| `/api/digest/generate` | POST | Dev/admin manual end-to-end digest generation and optional send. Requires `CRON_SECRET` bearer in production. |
| `/api/digest/generate-summaries` | POST | Dev/admin manual summary generation route. Requires `CRON_SECRET` bearer in production. |
| `/api/digest/generate-daily-news-topics` | POST | Dev/admin manual route for daily news topic generation. Requires `CRON_SECRET` bearer in production. |
| `/api/digest/generate-daily-lessons` | POST | Dev/admin manual route for daily lesson generation. Requires `CRON_SECRET` bearer in production. |
| `/api/digest/format` | POST | Formats generated modules into a persisted HTML/text digest. |
| `/api/digest/send` | POST | Sends a formatted digest through Resend. |
| `/api/digest/lesson-state` | GET | Reads lesson progress state for a topic. |
| `/api/digest/lesson-state` | POST | Pauses, resumes, completes, or switches a lesson topic. |

## Cron, Export, Health

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/cron/generate-digests` | GET | `CRON_SECRET` bearer | Scheduled digest generation and delivery. |
| `/api/export/features` | GET | Supabase session plus `CRON_SECRET` bearer in production | Debug CSV export for inbox analysis and digest data. |
| `/health` | GET | Public | Lightweight health check returning `{ "status": "ok" }`. |

## Removed Phase 0c Dev Routes

The dashboard-era development routes below were removed during Phase 0c cleanup and should remain absent unless a new admin surface is designed:

- `/api/digest/fetch-emails`
- `/api/backfill/start`
- `/api/backfill/progress`
- `/api/parse/progress`

Newsletter fetching now belongs to the shared digest service path in `lib/digest/fetch-newsletters.ts`, and onboarding inbox discovery belongs to `/api/onboard/scan-inbox`.
