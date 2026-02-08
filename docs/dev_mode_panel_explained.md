# Dev Mode Panel Explained

## What It Is

A step-by-step testing panel that appears **only in development mode** on the post-onboarding dashboard. Allows you to test digest generation incrementally.

## Where It Fits

### In Production Flow:
- **Cron job** runs every 15 minutes
- **Verifies** user is ready (via verification endpoint)
- **If ready:** Generates digest → Sends email
- **If not ready:** Skips silently, logs issue

### In New User Flow:
1. User completes onboarding → Config saved
2. **First cron check:** Verifies readiness
3. **If ready:** Generates digest at next scheduled time
4. **If not ready:** Waits until requirements met

### In Dev/Testing Flow:
- **Manual verification** via "Check Status" button
- **Step-by-step testing** via dev panel buttons
- **Full test** via "Generate Full Digest" button

---

## Panel Features

### 1. Lookback Override
- **Purpose:** Test with different time windows without changing your config
- **Default:** 14 days
- **Use case:** Test with 1 day, 7 days, etc. to see different results

### 2. Step-by-Step Buttons

**1. Check Status**
- Calls `GET /api/digest/verify`
- Shows verification results
- Must pass before other buttons work

**2. Fetch Selected Emails**
- Calls `POST /api/digest/fetch-emails`
- Fetches full email bodies from Gmail for selected newsletters
- Uses lookback override for date range
- Stores in temporary location (or directly in `digest_items`)

**3. Generate Summaries (LLM)**
- Calls `POST /api/digest/generate-summaries`
- Takes fetched emails
- Generates LLM summaries
- Stores in `digest_items.content_summary`

**4. Format Digest (Style-based)**
- Calls `POST /api/digest/format`
- Takes summaries + user's style preference
- Formats according to style (morning-brief, deep-read, reference-mode)
- Generates HTML + text versions
- Stores in `digests` table

**5. Send to Inbox (Resend)**
- Calls `POST /api/digest/send`
- Takes formatted digest
- Sends via Resend
- Updates `digests.sent_at` and `digests.status`

**🚀 Generate Full Digest (All Steps)**
- Calls `POST /api/digest/generate`
- Does all steps in sequence
- One-click full test

---

## API Endpoints Needed

These endpoints don't exist yet - we'll build them piecemeal:

1. `POST /api/digest/fetch-emails` - Fetch emails from Gmail
2. `POST /api/digest/generate-summaries` - LLM summarization
3. `POST /api/digest/format` - Style-based formatting
4. `POST /api/digest/send` - Email sending
5. `POST /api/digest/generate` - Full pipeline (calls all above)

---

## Why Separate Steps?

**For Dev/Testing:**
- ✅ See results at each step
- ✅ Debug specific failures
- ✅ Test formatting without re-generating summaries
- ✅ Test email sending without re-fetching

**For Production:**
- We'll optimize later (can combine steps for speed)
- But having separate functions makes testing easier

---

## Lookback Override Logic

**How it works:**
- Dev panel has input field: "Lookback Override (days)"
- When you click any button, it passes `lookback_days` to the endpoint
- Endpoint uses override **instead of** calculating from config
- **Example:** Config says "daily" (24h), but override says "7 days" → Uses 7 days for testing

**Why useful:**
- Test with different data volumes
- Test edge cases (very short/long windows)
- Don't have to change your actual config

---

## Next Steps

1. ✅ Dev panel UI created
2. ❌ Build `POST /api/digest/fetch-emails` endpoint
3. ❌ Build `POST /api/digest/generate-summaries` endpoint
4. ❌ Build `POST /api/digest/format` endpoint
5. ❌ Build `POST /api/digest/send` endpoint
6. ❌ Build `POST /api/digest/generate` endpoint (orchestrates all)

We'll build these one at a time and test each step.
