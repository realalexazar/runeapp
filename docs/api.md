# API Reference (current)

This document describes the implemented endpoints and their behavior. All routes require a valid Supabase session (user must be logged in) unless noted otherwise.

## Auth
- Supabase email/password and Google via the Connect flow
- Session is stored via cookies; server routes read it through `@supabase/ssr`

---

## POST /api/backfill/start
Start a bounded backfill of recent Gmail messages for the authenticated user (Promotions/Updates, last ~90 days, initial cap of 20 for dev).

- Auth: required
- Request body: none
- Response (200):
```json
{ "ok": true, "messages_scanned": number, "inserted": number }
```
- Errors: 401 (no session), 400 (no connected Google account), 500 (unexpected)
- Side effects:
  - Lists Gmail message IDs via Google API
  - For each id: fetches raw MIME, uploads to Storage `emails-raw/<USER_ID>/<MESSAGE_ID>.eml`
  - Upserts into `messages_raw` with unique `(user_id, provider_message_id)` (idempotent)

Notes:
- Safe to re-run (idempotent). It will not create duplicates.
- Pagination/throttling will be expanded; currently capped to 20 for fast iteration.

---

## POST /api/parse/run
Parse and sanitize raw emails that don’t yet have a cleaned record.

- Auth: required
- Request body: none
- Response (200):
```json
{ "ok": true, "parsed": number }
```
- Errors: 401 (no session), 500 (unexpected)
- Side effects:
  - Downloads `.eml` from `emails-raw` for the user
  - Parses MIME (headers/HTML/text)
  - Sanitizes HTML; derives plaintext (fallbacks to `html-to-text`)
  - Detects newsletter via high-signal rules (e.g., List-Id, List-Unsubscribe, unsubscribe link, bulk precedence)
  - Uploads sanitized files to `emails-clean/<USER_ID>/<RAW_ID>.{html,txt}`
  - Upserts into `messages_clean` with unique `(raw_id)`; stores `is_newsletter` and `signals` JSON

Notes:
- Also idempotent. If a cleaned row exists, the message is skipped.

---

## Data Model (current)

### messages_raw
- `id` bigint PK
- `user_id` uuid
- `provider` text ("google")
- `provider_message_id` text
- `received_at` timestamptz
- `raw_url` text (Storage path)
- `sha256` text
- Unique: `(user_id, provider_message_id)`

### messages_clean
- `id` bigint PK
- `user_id` uuid
- `raw_id` bigint (FK -> messages_raw.id)
- `html_url` text, `text_url` text
- `is_newsletter` boolean
- `signals` jsonb (optional)
- Unique: `(raw_id)`

### Storage
- `emails-raw` (private): raw MIME `.eml`
- `emails-clean` (private): sanitized `.html` and `.txt`

---

## Planned Next Endpoints
- `GET /api/newsletters?limit=…` — returns detected newsletters grouped by sender/list-id with counts and latest metadata for UI review
- `POST /api/backfill/start` → full pagination + throttling
- `POST /api/parse/run` → enqueue-per-item with job tracking (optional workerization)

---

## Operational notes
- All writes use upserts + unique constraints for idempotency
- Keep buckets private; service-role client performs reads/writes server-side
- Errors are logged server-side; UI can be expanded with toasts/job status
