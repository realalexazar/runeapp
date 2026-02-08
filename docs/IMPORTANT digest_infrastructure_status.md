# Digest Infrastructure Status & Verification

## ✅ What's Already Built

### Database Tables
- ✅ `digest_configs` - **EXISTS** (verified)
- ✅ `user_newsletter_selections` - **EXISTS** (verified)
- ✅ `messages_raw` - **EXISTS** (verified)
- ✅ `digests` - **EXISTS** (verified)
- ✅ `digest_items` - **EXISTS** (verified)

### API Endpoints
- ✅ `POST /api/digest/config` - Save digest configuration (includes rune_name)
- ✅ `GET /api/digest/config` - Get digest configuration
- ✅ `GET /api/digest/verify` - Verify user data completeness
- ❌ `POST /api/digest/generate` - Manual trigger (needs implementation)
- ❌ `GET /api/cron/generate-digests` - Cron job (needs implementation)

### Core Functions
- ✅ `lib/digest/utils.ts` - Lookback window calculation utilities (timezone conversion, window calculations)
- ❌ `lib/digest/generator.ts` - Digest generation logic (needs implementation)
- ❌ `lib/digest/email.ts` - Email sending via Resend (needs implementation)
- ❌ `lib/digest/formatter.ts` - HTML/text formatting (needs implementation)

### Dependencies
- ✅ `resend` - **INSTALLED** (v6.9.1)
- ✅ `@react-email/components` - **INSTALLED** (v1.0.6)
- ✅ `mailparser` - Already installed
- ✅ `googleapis` - Already installed
- ✅ `p-limit` - Already installed

---

## 🔧 What Needs to Be Done

### 1. Database Setup ✅ **DONE**
All required tables verified and exist:
- `digest_configs` ✅
- `digests` ✅
- `digest_items` ✅
- `user_newsletter_selections` ✅
- `messages_raw` ✅

### 2. Install Dependencies ✅ **DONE**
```bash
pnpm install resend @react-email/components
```

### 3. Environment Variables ✅ **DONE**
Added to `.env.local`:
```
RESEND_API_KEY=re_...
```

### 4. Build Core Functions
- `lib/digest/generator.ts` - Main generation logic
- `lib/digest/email.ts` - Resend integration
- `lib/digest/formatter.ts` - Style-based formatting

### 5. Build API Endpoints
- `app/api/digest/generate/route.ts` - Manual trigger
- `app/api/cron/generate-digests/route.ts` - Cron job

### 6. Set Up Vercel Cron
Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/generate-digests",
    "schedule": "*/15 * * * *"
  }]
}
```

---

## ✅ Verification Endpoint & UI Component

**Endpoint:** `GET /api/digest/verify`

**UI Component:** `components/DigestStatusCard.tsx` - Shows on dashboard after onboarding

**Returns:**
```json
{
  "ok": true,
  "verification": {
    "user_id": "...",
    "user_email": "...",
    "has_google_connection": true,
    "has_newsletter_selections": true,
    "newsletter_count": 45,
    "has_digest_config": true,
    "digest_config": { ... },
    "has_messages_raw": true,
    "messages_count": 400,
    "ready_for_digest": true,
    "missing_requirements": []
  },
  "summary": {
    "ready": true,
    "message": "✅ All requirements met! Ready to generate digests."
  }
}
```

**Use this to verify your data before testing digest generation.**

---

## 🚀 Quick Start Checklist

1. ✅ Run `docs/migration_create_digest_configs.sql` **DONE**
2. ✅ **VERIFY** tables exist: Run `docs/verify_all_tables.sql` **DONE - ALL TABLES EXIST**
3. ✅ Run `docs/migration_create_digest_tables.sql` **DONE**
4. ✅ Install Resend: `pnpm install resend @react-email/components` **DONE**
5. ✅ Set `RESEND_API_KEY` in `.env.local` **DONE**
6. ❌ Build `lib/digest/generator.ts` **NEXT**
7. ❌ Build `lib/digest/email.ts`
8. ❌ Build `lib/digest/formatter.ts`
9. ❌ Build `app/api/digest/generate/route.ts`
10. ❌ Build `app/api/cron/generate-digests/route.ts`
11. ❌ Set up Vercel Cron in `vercel.json`

---

## 📋 Testing Flow

1. **Verify Data:** `GET /api/digest/verify` → Should return `ready: true`
2. **Manual Test:** `POST /api/digest/generate` → Should generate and send digest
3. **Check Email:** Verify digest arrives in inbox
4. **Cron Test:** Wait for cron to run (or trigger manually)

---

## 🎯 Priority Order

**For tomorrow delivery:**
1. ✅ Database migrations - **DONE** (all tables verified)
2. ✅ Install Resend - **DONE**
3. ❌ Build generator.ts (30 min) **NEXT STEP**
4. ❌ Build email.ts (20 min)
5. ❌ Build formatter.ts (20 min)
6. ❌ Build generate endpoint (15 min)
7. ❌ Build cron endpoint (20 min)
8. ❌ Test manually (15 min)
9. ❌ **Error Handling & Retry Logic** (30 min) - See "Error Handling" section below

**Total: ~2 hours** (minus completed items = ~1.5 hours remaining)

---

## ⚠️ Error Handling & Retry Logic

### What Happens When Verification Fails in Production?

**Cron Job Behavior:**
```
Cron runs every 15 min
  ↓
For each user:
  1. Call GET /api/digest/verify
  2. If ready_for_digest = false:
     - Skip user silently
     - Log warning: "User [id] not ready: [missing requirements]"
     - Continue to next user
  3. If ready_for_digest = true:
     - Proceed with digest generation
     - If generation fails → Retry logic (see below)
```

**Missing Requirements Handling:**
- **Google connection lost:** User needs to reconnect → No action, wait for reconnect
- **No newsletter selections:** User hasn't selected yet → No action, wait for selections
- **No digest config:** User hasn't configured yet → No action, wait for config
- **No messages:** Backfill hasn't run → No action, wait for backfill

**Key Point:** Cron should **fail gracefully** - skip users who aren't ready, don't crash or spam errors.

### Retry Logic for Generation Failures

**When Generation Fails:**
1. **OAuth Token Expired (Critical):**
   - **Cannot retry** - requires user interaction
   - Skip user's digest generation silently
   - Mark digest as `status = 'failed'` with reason `'oauth_expired'`
   - Log warning: "User [id] OAuth token expired - skipping digest"
   - **TODO:** Send notification email to user: "Your digest couldn't be generated. Please reconnect your Google account."
   - Continue to next user (don't crash cron)

2. **Gmail API Error:**
   - Retry 3 times with exponential backoff
   - If still fails → Mark digest as `status = 'failed'`
   - Log error for monitoring
   - Don't send email

3. **LLM API Error:**
   - Retry 3 times with exponential backoff
   - If still fails → Mark digest as `status = 'failed'`
   - Log error
   - Don't send email

4. **Resend Email Error:**
   - Retry 3 times with exponential backoff
   - If still fails → Mark digest as `status = 'failed'`
   - Log error
   - User doesn't receive email (but digest is stored in DB)

**Database Status Tracking:**
- `digests.status` values:
  - `'pending'` - Not started yet
  - `'generated'` - Digest created, ready to send
  - `'sent'` - Email sent successfully
  - `'failed'` - Generation or sending failed

### Monitoring & Alerts

**TODO:**
- [ ] Set up error logging (Sentry or similar)
- [ ] Track failed digest rate
- [ ] Alert if failure rate > 5%
- [ ] Dashboard to view failed digests
- [ ] Manual retry button for failed digests (admin/dev mode)

**Documentation:** See `docs/feature_backlog.md` for full feature tracking
