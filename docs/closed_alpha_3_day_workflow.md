# Closed Alpha Implementation Playbook (One-Shot)

This is the step-by-step execution plan to finish the remaining product work in one full pass before testing.

## Scope Lock (Current)

- Newsletter is **daily-only** for MVP.
- Mobile is the **primary UI** for release quality; web is secondary (dev/testing/admin utility).
- Suite has 3 user-selectable modules:
  1. Daily newsletter summaries
  2. Daily news topics
  3. Daily lessons
- Final output is delivered as one combined daily digest (in-app + inbox email).

---

## Definition of Done

The suite is considered complete when:

1. A user can onboard once and enable any combination of modules.
2. A single daily backend run generates all enabled module sections.
3. A unified digest is delivered to inbox successfully.
4. Mobile UX has no blocker issues across onboarding + digest view.
5. Core failure cases are handled (auth errors, API errors, empty content).

---

## Step 1 - Finalize Config Contract (Backend + DB)

### Objective
Make user settings deterministic and persistent for all modules.

### Tasks
- Keep cadence locked to `daily` in API and UI.
- Persist module flags in `digest_configs.module_flags`:
  - `enable_newsletter_digest: true`
  - `enable_daily_news_topics: false`
  - `enable_daily_lessons: false`
- Add/confirm config fields for module-specific defaults:
  - news topic timeframe default (e.g. `24h`)
  - lesson frequency default (`daily`)

### Deliverables
- Stable config schema and API response model.
- Backward-compatible fallback for pre-migration rows.

---

## Step 2 - Add Data Models for Feature 2 and 3

### Objective
Create persistent storage for user topic inputs and generated content.

### Tasks
- Create `user_news_topics`:
  - `id`, `user_id`, `topic_text`, `timeframe`, `active`, timestamps
- Create `user_lesson_topics`:
  - `id`, `user_id`, `topic_text`, `active`, timestamps
- Create `generated_content_runs` (or equivalent):
  - `id`, `user_id`, `module`, `status`, `error`, `started_at`, `finished_at`
- Create `generated_content_items` (or module-specific tables):
  - store generated topic briefs and lessons by date.

### Deliverables
- Migrations committed.
- Query paths for active topics by user.

---

## Step 3 - Refactor Onboarding to 3-Option Module Selection

### Objective
Collect module intent and inputs in one clean onboarding flow.

### Tasks
- Keep Daily Newsletter Summaries enabled by default.
- Add two optional module toggles in onboarding:
  - Daily news topic (single topic in alpha)
  - Daily lesson (single topic in alpha)
- Show conditional input panels:
  - If news topic enabled: require exactly 1 free-text topic
  - If lessons enabled: require exactly 1 free-text topic
- Show learning expectation in UI copy:
  - "You will receive a 10-day curriculum for this topic."
- Persist `module_flags`, `module_defaults`, and topic inputs in one save action.
- Save everything in one submit transaction:
  - `digest_configs` + `user_news_topics` + `user_lesson_topics`

### Deliverables
- End-to-end onboarding API save succeeds for all option combinations.

---

## Step 4 - Build Daily News Topics Engine (Feature 2)

### Objective
Generate one daily "news topics" section based on user-entered topics.

### Tasks
- Define retrieval strategy (single provider for now).
- For each active topic:
  - retrieve latest content for timeframe
  - normalize and deduplicate items
- summarize into fixed structure:
  - one digestible paragraph (substantive, concise)
  - include references/links for deeper reading
  - optional short "why this matters" sentence
- Persist output by user/date/topic.

### Deliverables
- `generate-daily-news-topics` service/function callable by scheduler.

---

## Step 5 - Build Daily Lessons Engine (Feature 3)

### Objective
Generate one daily lesson on user-selected topic(s).

### Tasks
- For each active lesson topic:
  - generate one lesson/day in a 10-day structured curriculum
  - track curriculum day progression (1-10)
  - after day 10, prompt user to choose the next topic
- Add anti-repeat check using recent lesson history.
- Add user controls:
  - Pause
  - Switch Topic
  - I'm Done
- Persist lesson output by user/date/topic.

### Deliverables
- `generate-daily-lessons` service/function callable by scheduler.

---

## Step 6 - Unify Generation Pipeline

### Objective
Produce one combined digest from all enabled modules.

### Tasks
- Orchestrate generation order:
  1. newsletter summaries (if enabled)
  2. daily news topics (if enabled)
  3. daily lessons (if enabled)
- Ensure partial failure isolation:
  - one module failure does not cancel the whole digest
- Assemble final digest payload with section order and metadata.

### Deliverables
- Unified digest object ready for rendering + email.

---

## Step 7 - Inbox Delivery Mechanic (Whole Suite)

### Objective
Guarantee end-to-end inbox delivery for combined digest.

### Tasks
- Build/verify email formatter for all section types.
- Ensure send path writes digest status transitions:
  - `pending` -> `generated` -> `sent` (or `failed`)
- Build/verify scheduler trigger:
  - cron endpoint or job runner
  - user timezone-aware daily execution
- Add retry policy for transient send/provider failures.

### Deliverables
- One daily automated send path covering all enabled modules.
- Logs/status rows for each send attempt.

---

## Step 8 - Mobile-First Product Pass (Release Blocking)

### Objective
Make mobile UX production-ready before alpha.

### Tasks
- Onboarding mobile pass:
  - tap targets, keyboard overlap, sticky CTA, safe area
- Digest view mobile pass:
  - card hierarchy, text wrapping, no overflow, scroll behavior
- Error/loading states mobile pass:
  - skeletons, empty states, retry states
- Device coverage:
  - small width + common iPhone sizes + Android Chrome baseline

### Release-blocking checks
- No clipped controls
- No horizontal scroll bugs
- No blocked CTA path

---

## Step 9 - Hardening and Observability

### Objective
Avoid silent failures and make issues debuggable fast.

### Tasks
- Add structured logs for:
  - generation per module
  - email send attempts
  - provider/API failures
- Add lightweight health/status endpoints.
- Add operational SQL checks for:
  - unsent generated digests
  - failed module runs
  - missing daily outputs by enabled module.

### Deliverables
- Minimal operations checklist and diagnostics SQL.

---

## Step 10 - Final Full-System Verification (Build Complete, Web/Dev)

### Objective
Run one full verification pass only after all functionality is built.

### Test matrix
- module combinations:
  - newsletter only
  - topics only
  - lessons only
  - newsletter + topics
  - newsletter + lessons
  - all three
- delivery checks:
  - in-app digest render
  - inbox delivery content/format
  - status transitions in DB

### Exit criteria
- End-to-end success for all module combinations.
- Inbox delivery confirmed for combined digest.

---

## Step 11 - Dev Inbox Validation Gate (Mandatory Before Mobile)

### Objective
Run real-world validation using your own inbox in dev/web mode before starting any mobile app work.

### Required process
1. Use the web UI in dev mode only.
2. Send real combined digests to your real inbox for multiple runs.
3. Validate content quality and section usefulness for:
   - newsletters
   - daily news topics
   - daily lessons
4. Validate delivery mechanics:
   - send timing
   - formatting in inbox clients
   - status/log consistency in DB
5. Fix all blocker issues found in this phase.

### Go / No-Go criteria
- **Go to mobile only if all are true:**
  - inbox delivery is stable
  - content quality is acceptable
  - no blocker bugs in core flow
  - logs/diagnostics are sufficient for troubleshooting
- If any fail, stay in web/dev iteration until resolved.

---

## Step 12 - Domain + Buddy Alpha (Web UI Dev Mode)

### Objective
Run a controlled web-based alpha before app development.

### Tasks
1. Hook the system to your purchased domain.
2. Invite two buddies to test through web UI (dev mode).
3. Collect focused feedback:
   - relevance and quality by section
   - clarity of onboarding
   - confusing or noisy output
4. Apply final fixes from this feedback loop.

### Exit criteria
- Buddy feedback is positive enough to proceed.
- No critical web/dev issues remain.
- You explicitly approve transition to mobile app work.

---

## Execution Order (No Context Switching)

1. Config + schema
2. Onboarding refactor
3. Feature 2 engine
4. Feature 3 engine
5. Unified generation orchestration
6. Inbox delivery + scheduler
7. Hardening/observability
8. Final verification pass (web/dev)
9. **Dev Inbox Validation Gate** (mandatory)
10. Domain + buddy alpha (web/dev mode)
11. Mobile app implementation starts only after explicit go decision

---

## Notes

- This document intentionally removes day-based planning.
- Build first, test comprehensively once full functionality is in place.
- Keep scope strict: no non-essential extras until this playbook is complete.

