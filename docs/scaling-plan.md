# Rune Scaling Plan — API Rate Limits & Cost

## Current State (Alpha)

- 8 users, GPT-4o for all daily content generation
- ~30-40 GPT-4o API calls per full cron run (news synthesis + lessons + newsletter summaries)
- Hitting OpenAI per-minute rate limits at Tier 1
- Monthly spend: ~$0.70/day at current volume

## Problem

OpenAI rate limits are per-minute, per-model, and tier-based. Tier 1 (new accounts) has tight limits. Moving to higher tiers requires cumulative spend history — no way to buy your way up instantly. At 100+ users on GPT-4o, both cost and rate limits become blocking.

## Alpha Solution: Staggered Generation

Added a 10-second delay between users in the cron loop. This spreads API calls across minutes instead of spiking all at once. Works for 8-20 users. Not a long-term solution.

## Production Solution: OpenAI Batch API

OpenAI's Batch API is purpose-built for this use case:

- **50% cost reduction** vs real-time API
- **Significantly higher rate limits** (separate pool from real-time)
- **Tradeoff:** Results return in minutes to hours, not seconds

### Proposed Pipeline

```
00:00 UTC  — Cron triggers batch job submission
             For each user: submit news retrieval + synthesis as batch tasks
             Submit lesson generation as batch tasks
             Submit newsletter summarization as batch tasks

~03:00 UTC — Poll for batch completion
             Collect all results

05:00 UTC  — Assemble digests from batch results
             Persist to digests table

06:00-07:00 — Send digests per user timezone
```

### Benefits
- Same GPT-4o quality at half the cost
- No per-minute rate limit issues (batch has its own limits)
- Scales to 1000+ users without API throttling
- Overnight processing — users never wait

### Implementation Complexity
- Moderate. Requires refactoring generation functions to submit batch jobs instead of awaiting responses
- Need a polling mechanism or webhook to collect results
- Need a two-phase cron: submit phase + collect/assemble phase
- Estimated effort: 1-2 focused sessions

## Alternative: Model Tier Strategy

If Batch API is deferred, use a model split:

| Call Type | Model | Frequency | Rationale |
|---|---|---|---|
| News filter + synthesize | GPT-4o-mini | Per topic per day | High volume, prompts do the heavy lifting |
| Newsletter summarization | GPT-4o-mini | Per newsletter per day | High volume |
| Lesson writing | GPT-4o | Per topic per day | Quality matters most here, lower volume |
| Technical config (onboarding) | GPT-4o | Once per user | One-time, precision matters |
| Curriculum planning | GPT-4o | Once per user | One-time, quality matters |
| Inbox scoring | GPT-4o-mini | Once per user | High volume, structured output |

This keeps daily costs low while preserving quality where users notice it most (lessons).

## OpenAI Tier Progression

| Tier | Qualification | GPT-4o RPM | GPT-4o TPM |
|---|---|---|---|
| Tier 1 | $5+ spend | 500 RPM | 30,000 TPM |
| Tier 2 | $50+ spend, 7+ days | 5,000 RPM | 450,000 TPM |
| Tier 3 | $100+ spend, 7+ days | 5,000 RPM | 800,000 TPM |
| Tier 4 | $250+ spend, 14+ days | 10,000 RPM | 2,000,000 TPM |
| Tier 5 | $1,000+ spend, 30+ days | 10,000 RPM | 12,000,000 TPM |

Contact OpenAI support to request accelerated tier progression if needed.
