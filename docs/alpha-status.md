# Rune Alpha — Status & Review Guide

## Current State (March 31, 2026)

### Users
- 8 onboarded users, all `complete`
- 2 users have email curation (Gmail connected + priority senders selected)
- 6 users are news + lessons only
- All 8 have verified `digest_configs`, `user_news_topics`, `user_lesson_topics` with curriculum plans

### Infrastructure
- Deployed on Vercel at `runeapp.co` (custom domain)
- Resend verified domain for email delivery
- `OVERRIDE_RECIPIENT` set — all digests route to founder inbox for review
- `force=true` param on cron endpoint for on-demand digest generation
- Backfill endpoint at `/api/onboard/backfill-curricula` for missing curriculum plans

### What's Working
- Onboarding chat (Claude) → intent extraction → recommendation → approval
- News retrieval (Tavily + Google News RSS) with tiered freshness
- Lesson curriculum generation (GPT-4o-mini) during approval
- Newsletter fetch + summarize wired into cron pipeline
- Digest formatting (HTML + text) and delivery via Resend
- `OVERRIDE_RECIPIENT` for alpha email review
- Google OAuth for signup + Gmail connect

### What Was Fixed During Alpha
- `OVERRIDE_RECIPIENT` — was documented but never coded
- Curriculum generation — wasn't wired into the approve flow
- Newsletter fetch/summarize — wasn't callable from cron (extracted to service-role functions)
- `starting_level` constraint — freeform strings from Claude caused silent insert failures
- Auth flow — email signup redirected before session existed
- ESLint build errors — suppressed `no-explicit-any`, fixed `prefer-const`
- Next.js CVE — upgraded 15.5.2 → 15.5.14
- Mobile chat UX — pinned composer, viewport handling, 16px inputs to prevent iOS zoom

---

## Systematic Review Needed

### Priority 1: Silent Failure Audit
The approve route (`/api/onboard/approve`) had silent failures where DB inserts failed but the user was still marked `complete`. This was the root cause of missing lesson topics.

**Review needed:**
- Add verification step at end of approve that counts created rows vs expected rows
- If any insert failed, return error instead of `{ ok: true }`
- Ensure `console.error` calls are surfaced, not swallowed
- Check ALL insert/upsert calls in approve for potential constraint violations
- Review what happens if curriculum generation times out during approve (Vercel function timeout)

### Priority 2: Error Handling Across All Routes
Scan every API route for the same pattern: operations that `console.error` and continue instead of failing the request.

**Files to audit:**
- `app/api/onboard/approve/route.ts` — partially fixed, needs verification step
- `app/api/onboard/chat/route.ts` — check intent extraction error handling
- `app/api/onboard/recommend/route.ts` — check enrichment failures
- `app/api/onboard/scan-inbox/route.ts` — check Gmail API error paths
- `app/api/cron/generate-digests/route.ts` — check per-user error isolation
- `app/api/digest/fetch-emails/route.ts` — check Gmail token expiry handling
- `lib/digest/fetch-newsletters.ts` — new file, needs review
- `lib/digest/summarize-newsletters.ts` — new file, needs review

### Priority 3: Data Integrity Checks
- Verify every `onboarding_status: "complete"` user has matching rows in `digest_configs`, `user_news_topics`, and `user_lesson_topics`
- Check for orphaned rows (active topics for users who don't have digest configs)
- Verify `user_newsletter_selections` match `inbox_analysis` dispositions

### Priority 4: Conversation Logging
- Chat history is NOT persisted — lives in `useRef` on the client, lost when tab closes
- For product iteration, add conversation logging to a `conversation_logs` table
- This is critical for understanding onboarding quality and debugging user issues

### Priority 5: Mobile UX Polish
- Onboard chat composer behavior on iOS/Android — tested but needs more device coverage
- Landing page performance on low-end devices (GSAP animation element count)
- Auth dialog keyboard behavior on various mobile browsers

### Priority 6: Production Hardening
- Remove `force=true` and backfill endpoints before public launch (or add admin auth)
- Set up Vercel Cron for automated daily digest delivery
- Add rate limiting on public API routes
- Review Supabase RLS policies for all tables
- Google OAuth app verification (currently in "Testing" mode, max 100 test users)
- Move from Resend `onboarding@resend.dev` to verified domain sender (done)

---

## Next Steps
1. Fire test digests to founder inbox via `force=true` cron
2. Review digest quality across all 8 users
3. Remove `OVERRIDE_RECIPIENT` to release digests to real users (Tue-Fri test week)
4. Collect user feedback
5. Final UI walkthrough and finishing touches
6. Systematic code review (this document)
7. Marketing prep and launch campaign
