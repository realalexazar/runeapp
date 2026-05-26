# Phase 0b Exit Memo

Date: 2026-05-26
Status: implementation complete; pending post-migration telemetry review, waiver decisions, and human sign-off.

## Scope

Phase 0b moved production-relevant LLM call sites behind the shared gateway with telemetry, Zod validation, and validation-failure capture.

Implementation commits:

| Commit | Scope |
| --- | --- |
| `2266019` | Started Phase 0b LLM gateway |
| `9edda18` | Migrated onboarding JSON calls |
| `7cd4b5e` | Migrated digest synthesis |
| `42ea6fc` | Migrated sender classifier |
| `0f8eb81` | Validated onboarding technical config |
| `737f90c` | Completed production-relevant Phase 0b schema migration |

## Acceptance Criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| New gateway is used by at least one low-risk call site | Met | Low-risk onboarding/config calls, sender classification, and inbox relevance use `lib/ai/gateway.ts`. |
| Zod validation failures are logged with raw output | Met | `public.llm_validation_failures` and `lib/ai/llm-validation-failures.ts`. |
| Migrated call sites stay within cost threshold | Pending telemetry window | Requires post-migration real traffic review. |
| Output quality does not materially regress | Pending human review | Controlled digest generation passed; onboarding copy needs live/manual review after frontend direction. |
| Runtime rollback exists for first 7 days | Waiver needed or carried forward | Current rollback path is Vercel/Git deploy rollback, not per-call-site feature flags. |
| Existing direct provider wrappers are migrated or marked legacy | Met | App/product code now calls gateway; direct provider wrappers remain only under `lib/ai/gateway.ts`, `lib/openai/chat.ts`, and `lib/anthropic/chat.ts`. |
| New LLM calls are not allowed outside gateway | Met by convention | `rg` over `app/` and `lib/` shows direct provider calls only inside gateway/provider wrappers. |

## Telemetry Review

Cost regression review is not complete.

Known baseline evidence:

- `docs/phase0a_snapshot_2026-05-24.md` captured one controlled production module run.
- That run cost `$0.140374` in estimated LLM spend across 3 LLM calls.
- The largest known outlier was `digest.news.unified_filter_and_synthesize`, driven by a 34k-token input.

Missing evidence before clean sign-off:

- 3-5 days of post-migration real traffic, or explicit human waiver due to alpha volume.
- Per-call-site cost comparison against Phase 0a baseline where comparable.
- Production query of `public.llm_validation_failures` after the final Phase 0b migrations.

## Rollback Review

- Per-call-site feature flags were not implemented.
- No rollback event is documented in repo history or this memo as of 2026-05-26.
- Vercel/Git deployment rollback remains the emergency rollback path until a proper flag layer exists.
- Human owner should explicitly waive the per-call-site flag requirement if Phase 0c begins before that flag layer exists.

## Carried-Forward Risks

- Onboarding chat behavior changed from hidden fenced JSON to structured JSON response objects. The backend response shape to the frontend is preserved, but copy behavior should be watched in production telemetry and manual onboarding tests.
- Per-call-site runtime feature flags were not added. Use Vercel rollback for urgent regression until a proper flag layer exists.
- Cost deltas need at least a short real-traffic window before the human owner signs off Phase 0b.

## Waivers

None recorded yet.

Potential waiver candidates:

- Real-traffic cost window, if alpha volume is too low.
- Per-call-site feature flags during the first 7 days, if Vercel/Git rollback is accepted as the temporary rollback path.

## Human Owner Sign-Off

Pending.

## Next Phase

Phase 0c should not redesign onboarding yet. It should first make the product spine durable: server-side onboarding state, persistent scan artifacts, typed recommendation config, approval transition logs, dev/admin route gating, and cleanup of dashboard-era routes.
