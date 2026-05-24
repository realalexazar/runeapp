# Phase 0a Snapshot: Controlled Production Run

Date: 2026-05-24

User: `0c8ed9ca-7734-4d48-8cf4-7fadb778b775`

Scope: direct module generation only. No digest email was sent.

## What Ran

- `generateDailyNewsTopics({ forceRegenerate: true })`
- `generateDailyLessons({ forceRegenerate: true })`

Generated output:

| Module | Generated count | Run id |
| --- | ---: | --- |
| `news_topics` | 2 | `0f43f32e-ddbc-4cac-a75d-17d67c7a85bb` |
| `lessons` | 2 | `da3ec465-1524-4036-9830-4e790180e279` |

## Cost And Latency

| Surface | Calls | Input tokens | Output tokens | Estimated cost | Total latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| LLM total | 3 | 47,685 | 1,644 | `$0.140374` | 33.0s |
| External API total | 9 | n/a | n/a | n/a | 15.0s |

LLM by call site:

| Call site | Calls | Estimated cost | Input tokens | Output tokens | Total latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| `digest.news.unified_filter_and_synthesize` | 2 | `$0.125335` | 47,102 | 758 | 7.9s |
| `digest.lessons.synthesize_content` | 1 | `$0.015039` | 583 | 886 | 25.2s |

Tavily:

| Call site | Calls | Request units | Total latency |
| --- | ---: | ---: | ---: |
| `digest.news.tavily_search` | 9 | 9 | 15.0s |

## Observations

- News synthesis dominates measured LLM cost: about 89% of this run's LLM spend.
- One news topic produced a very large prompt: 34,166 input tokens for a single `gpt-4o` synthesis call.
- Tavily calls are now measured for latency and request units, but no dollar estimate is recorded yet because the current plan/rate is not encoded.
- Only one lesson topic hit Claude. The second active lesson topic lacks a stored curriculum plan, so it generated setup-needed fallback content instead of calling the model.
- Telemetry is correctly carrying `run_id` for both module runs.

## Cleanup / Follow-Up

- Add Tavily rate-card support once the account plan/rate is known.
- Add a guardrail around news candidate prompt size before Phase 0b migration, because the 34k-token call is the cost outlier.
- Completed during snapshot cleanup: deactivated duplicate lesson topic `76fc2e37-7e84-4cb0-9ba2-30c4af741082` and deleted its generated fallback item `444d6910-0a46-47ac-b883-ae295826f876`.
- Keep collecting real usage before Phase 0a exit; this is a controlled sample, not the required 5-day baseline.
