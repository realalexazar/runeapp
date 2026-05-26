# Phase 0a Exit Memo

Date: 2026-05-26
Status: instrumentation implementation complete; full alpha baseline pending production data or human waiver.

## Scope

Phase 0a established static inventories, runtime telemetry tables, telemetry helpers, baseline SQL queries, a cleanup ledger, and one controlled production snapshot.

## Acceptance Criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Every current LLM call is inventoried | Met | `docs/phase0a_llm_call_inventory.md` |
| Every current intelligence-relevant search/API call is inventoried | Met for production paths; dev paths static-only | `docs/phase0a_external_api_inventory.md` lists production runtime telemetry and static dev/backfill paths |
| Runtime records can answer cost by run and call site | Met by implementation | `public.llm_call_telemetry`, `docs/phase0a_llm_cost_baseline.sql` |
| Runtime records can answer run health, latency, and failure state | Met by implementation | `docs/phase0a_run_health.sql`, `public.generated_content_runs` |
| Baseline covers 5 consecutive days and at least 3 users | Not met | Only one controlled production snapshot exists in repo evidence |
| Existing behavior unchanged | Met by scope | Phase 0a was instrumentation and cleanup only; no product behavior rewrite |

## Current Alpha Evidence

The only recorded alpha-volume evidence in the repo is `docs/phase0a_snapshot_2026-05-24.md`.

| Field | Known value |
| --- | --- |
| Controlled user | `0c8ed9ca-7734-4d48-8cf4-7fadb778b775` |
| Scope | Direct module generation only; no digest email sent |
| Generated modules | 2 `news_topics`, 2 `lessons` |
| LLM calls | 3 |
| LLM estimated cost | `$0.140374` |
| External API calls | 9 Tavily calls |
| Baseline status | Controlled sample only, not a real 5-day baseline |

Active user count and average scheduled Rune runs/day are not recorded in repo artifacts. They require production Supabase access or a separate exported snapshot.

## Waivers

No Phase 0a waiver is recorded as of this memo.

If Phase 0b and Phase 0c continue before the default 5-day/3-user baseline exists, the human owner should either:

- populate this memo with production counts and baseline results, or
- record an explicit alpha-volume waiver with date and rationale.

## Carried-Forward Risks

- The cost baseline is anchored by one controlled module run, not real scheduled digests.
- Tavily request-unit telemetry exists, but dollar cost requires account plan/rate input.
- Dev/backfill Gmail paths remain static inventory only and need Phase 0c classification.

## Human Owner Sign-Off

Pending.
