# Phase 0b Exit Memo

Date: 2026-05-26
Status: implementation complete; pending post-migration telemetry review and human sign-off.

## Scope

Phase 0b moved production-relevant LLM call sites behind the shared gateway with telemetry, Zod validation, and validation-failure capture.

## Acceptance Criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| New gateway is used by at least one low-risk call site | Met | Low-risk onboarding/config calls, sender classification, and inbox relevance use `lib/ai/gateway.ts`. |
| Zod validation failures are logged with raw output | Met | `public.llm_validation_failures` and `lib/ai/llm-validation-failures.ts`. |
| Migrated call sites stay within cost threshold | Pending telemetry window | Requires post-migration real traffic review. |
| Output quality does not materially regress | Pending human review | Controlled digest generation passed; onboarding copy needs live/manual review after frontend direction. |
| Runtime rollback exists for first 7 days | Carried forward | Current rollback path is Vercel/Git deploy rollback, not per-call-site feature flags. |
| Existing direct provider wrappers are migrated or marked legacy | Met | App/product code now calls gateway; direct provider wrappers remain only under `lib/ai/gateway.ts`, `lib/openai/chat.ts`, and `lib/anthropic/chat.ts`. |
| New LLM calls are not allowed outside gateway | Met by convention | `rg` over `app/` and `lib/` shows direct provider calls only inside gateway/provider wrappers. |

## Carried-Forward Risks

- Onboarding chat behavior changed from hidden fenced JSON to structured JSON response objects. The backend response shape to the frontend is preserved, but copy behavior should be watched in production telemetry and manual onboarding tests.
- Per-call-site runtime feature flags were not added. Use Vercel rollback for urgent regression until a proper flag layer exists.
- Cost deltas need at least a short real-traffic window before the human owner signs off Phase 0b.

## Next Phase

Phase 0c should not redesign onboarding yet. It should first make the product spine durable: server-side onboarding state, persistent scan artifacts, typed recommendation config, approval transition logs, dev/admin route gating, and cleanup of dashboard-era routes.
