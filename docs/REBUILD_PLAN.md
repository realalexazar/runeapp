# Rune Rebuild Plan

Last updated: 2026-05-26
Version: 1.14
File: `docs/REBUILD_PLAN.md`

This document is the source of truth for the Rune rebuild. It pins down the sequence, scope, exit criteria, and architectural direction so the team does not keep re-litigating the plan in chat.

The core principle: measure first, enforce structure second, stabilize product state third, then build the graph-backed intelligence system through domain APIs before committing to graph infrastructure.

## North Star

Rune should become a daily intelligence system with durable memory, not a daily prompt over loose text blobs.

Current shape:

```text
user topic text + Gmail/news results + prompt -> daily output
```

Target shape:

```text
Rune slots track entities, concepts, and sources
Stories mention entities and events
Runs produce observations
User engagement updates relevance and trust
Next run queries prior context, novelty, source credibility, and graph neighborhood
Digest/lesson output explains what changed and why it matters
```

The graph is a domain model first. AGE, Neo4j, pgvector, or plain relational storage are implementation choices that come later after access patterns are real.

## Definitions

**Rune:** A durable user-owned intelligence object. A user may eventually have multiple Runes, each with its own slots, sources, cadence, and memory. Until the durable Rune model is finalized, the current user-level daily digest behaves as a temporary single-Rune equivalent.

**Slot:** A configured unit of interest inside a Rune, such as inbox curation, a news/intelligence beat, or a lesson track.

**Rune run:** One scheduled or manually triggered execution for a single Rune at a specific time. A Rune run includes all enabled slots for that Rune, all retrieval/search/scrape calls, all LLM calls, graph reads/writes, ranking, synthesis, formatting, and delivery attempts. `run_id` groups telemetry across the whole execution, not a single slot or a single LLM call.

**Slot run:** The execution of one slot inside a Rune run. Use `slot_id` and, when needed, a future `slot_run_id` to inspect per-slot cost and health.

## Current Diagnosis

The codebase is a working prototype with useful pieces, but the core product spine is brittle.

- Onboarding state is mostly client-side and session-based.
- LLM outputs rely on hidden JSON, regex extraction, and ad hoc parsing.
- Inbox scan results are not durable enough to survive follow-up recommendation edits.
- Newsletter fetch and summarization paths are duplicated.
- Tavily/news retrieval is hardcoded rather than provider-routed.
- Entity extraction and continuity memory are not first-class systems.
- Cost per Rune run is not measured.
- Dev tools are hidden in UI but many dev endpoints are still only user-auth gated.
- Supabase schema assumptions are not fully captured in repo migrations.

The rebuild should not start by adding graph infrastructure. It starts by making the current system measurable and structurally reliable.

## Current Alpha State

Current alpha volume is not yet recorded in this plan. Phase 0a must document active user count, average Rune runs per day, and expected baseline sample size in its Phase Exit Memo. If alpha volume is too low to meet the default 5-day/3-user baseline, the waiver must be recorded in the Decision Log with date and rationale.

## Non-Goals

These are intentionally out of scope until the relevant phase says otherwise.

- No AGE or Neo4j commitment before Phase 3.
- No broad product feature expansion during Phase 0.
- No new onboarding capabilities during Phase 0c beyond stabilization.
- No multi-provider search expansion before call-site telemetry and LLM schemas exist.
- No entity graph visualization before durable entity extraction and resolution exist.
- No pricing or Stripe work in this rebuild plan unless separately prioritized.

## Phase Overview

| Phase | Owner | Objective | Primary Output | Exit Criteria |
| --- | --- | --- | --- | --- |
| 0a | Grok ships, GPT reviews completeness | Measure existing system | Static LLM/external API inventory plus runtime telemetry | Every LLM/search call site is mapped and telemetry records real runs |
| 0b | Grok ships, GPT reviews contracts | Enforce structured LLM contracts | LLM gateway with cost logging and Zod validation | Call sites migrate one by one with schema fixtures and no cost regression |
| 0c | Grok ships, GPT reviews architecture | Stabilize product spine | Server-side onboarding state and one digest pipeline | Onboarding and digest flows are durable, gated, and testable |
| 1 | GPT leads interface design, Grok implements | Define graph domain APIs | Graph-facing application interfaces backed by Postgres | Product code depends on graph APIs, not graph database details |
| 2 | Shared | Rebuild intelligence layer | Search providers, query decomposition, cache, signal classifier | Retrieval and ranking are modular, measured, and fallback-capable |
| 3 | Shared, benchmark-driven | Commit graph infra and continuity | AGE/Neo4j/relational benchmark, memory, credibility | Real access patterns determine graph storage choice |

## Roles

- **Grok:** default implementation lead for Phase 0 execution and incremental migration work.
- **GPT:** architecture/interface reviewer during Phase 0, graph-domain interface lead in Phase 1.
- **Human owner:** approves phase transitions, cost thresholds, infrastructure commitments, and product-scope changes.
- **Tie-breaker:** the human owner resolves architectural or execution disagreements between agents during a phase.
- **Rule:** a phase does not begin because someone is eager to build it. It begins when the prior phase exit criteria are met or explicitly waived by the human owner.

## Phase Transitions

Each phase transition requires a one-page Phase Exit Memo stored under `docs/phase-exits/`.

The memo must include:

- Acceptance criteria status: met, waived, or carried forward.
- Evidence links: telemetry queries, inventory docs, tests, or implementation references.
- Waivers with date, owner, and rationale.
- Carried-forward risks and the phase responsible for resolving them.
- Human owner sign-off.

Waivers are not valid if they only live in chat. They must also be recorded in the Decision Log or the relevant Phase Exit Memo.

## Phase 0a: Instrumentation First

Goal: establish ground truth before refactoring.

Scope:

- Static call-site mapping today.
- Runtime telemetry once the logger lands.
- No product behavior refactors.
- No prompt rewrites.
- No provider routing refactor.

Deliverables:

- `docs/phase0a_llm_call_inventory.md` with every LLM call site.
- `docs/phase0a_external_api_inventory.md` with paid/quota-sensitive API call sites.
- `docs/cleanup_ledger.md` for stale migrations, antiquated code paths, and outdated messages.
- `supabase/migrations/20260522090000_phase0a_telemetry.sql` telemetry storage migration.
- Minimal logging helper used by existing call sites.
- `docs/phase0a_llm_cost_baseline.sql` query for LLM cost per run and cost by call site.
- `docs/phase0a_external_api_baseline.sql` query for quota-sensitive external API usage.
- `docs/phase0a_run_health.sql` query joining generated runs to LLM and external API telemetry.
- `docs/phase0a_snapshot_YYYY-MM-DD.md` snapshots for controlled or real baseline runs.
- End-to-end run health query covering run success rate, slot success rate, total latency, total estimated cost, and failure reasons.

Call-site inventory columns:

| Field | Meaning |
| --- | --- |
| File/function | Where the call is made |
| Product path | Onboarding, inbox scan, newsletter summary, news topic, lesson, cron, dev tool |
| Provider | Anthropic, OpenAI, OpenRouter, Tavily, Google News, Gmail, etc. |
| Model/API | Exact model or API endpoint |
| Purpose | What the call decides or generates |
| Prompt/source size | Approximate input size if available |
| Expected output | Prose, JSON object, JSON array, score, HTML/text, etc. |
| Validation status | `none`, `regex`, `schema`, or `manual` |
| Retry behavior | None, shared wrapper, SDK retry, custom retry |
| Estimated risk | Low, medium, high |

Runtime telemetry fields:

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Event id |
| `run_id` | yes | Groups calls into one Rune/digest/onboarding run |
| `user_id` | when available | Supabase user id |
| `rune_id` | when available | Future durable Rune id |
| `slot_id` | when available | Future slot/topic id |
| `slot_run_id` | no | Future per-slot execution id for inspecting slot-level cost and health |
| `call_site` | yes | Stable name, e.g. `onboard.chat.recommendation_config` |
| `file_function` | yes | Human-readable source reference |
| `provider` | yes | Anthropic, OpenAI, OpenRouter, Tavily, Gmail, etc. |
| `model` | when applicable | Exact model name |
| `input_tokens` | when available | Provider-reported preferred |
| `output_tokens` | when available | Provider-reported preferred |
| `estimated_cost_usd` | yes | Use price table fallback if provider does not return cost |
| `latency_ms` | yes | End-to-end call latency |
| `success` | yes | Boolean |
| `error_code` | no | Provider or internal code |
| `validation_status` | yes | `none`, `regex`, `schema`, or `manual` |
| `output_shape` | no | Schema or expected output name |
| `created_at` | yes | Timestamp |

Run health fields:

| Field | Required | Notes |
| --- | --- | --- |
| `run_id` | yes | Same grouping id used by call telemetry |
| `user_id` | when available | Supabase user id |
| `rune_id` | when available | Future durable Rune id |
| `trigger` | yes | `scheduled`, `manual`, `onboarding`, `dev`, or `backfill` |
| `started_at` | yes | Run start |
| `finished_at` | no | Null if still running or crashed |
| `status` | yes | `running`, `succeeded`, `partial`, `failed`, or `cancelled` |
| `slot_count` | when available | Enabled slots attempted |
| `slot_success_count` | when available | Slots completed successfully |
| `estimated_cost_usd` | yes | Sum of child call telemetry |
| `latency_ms` | no | End-to-end duration |
| `failure_reason` | no | Stable reason string |

Telemetry retention:

- Keep aggregate call/run telemetry indefinitely unless storage costs force a later policy.
- Keep raw failed-validation outputs for 30 days by default.
- Never store decrypted OAuth tokens, secrets, or full private email bodies in telemetry.
- Redact or hash sensitive payload fields before storing raw validation failures.

Acceptance criteria:

- Every current LLM call is inventoried.
- Every current search/API retrieval call relevant to intelligence is inventoried.
- Runtime records can answer: "What did a Rune run cost, by call site?"
- Runtime records can answer: "Which call sites have no schema validation?"
- Runtime records can answer: "What is the end-to-end success rate and latency per Rune run?"
- Baseline data covers at least 5 consecutive days of real runs across at least 3 users, unless the human owner explicitly waives this due to alpha volume constraints. Waivers must be recorded in the Decision Log with date and rationale.
- Existing behavior is unchanged.

## Phase 0b: LLM Gateway And Schema Enforcement

Goal: replace ad hoc LLM calls with a single measured, validated gateway.

Scope:

- Build new LLM gateway/wrapper.
- Migrate existing call sites one at a time.
- Add Zod schemas for structured outputs.
- Capture raw outputs on validation failure.
- Add fixtures for prompt/schema regression tests.

Gateway responsibilities:

- Provider/model routing.
- Timeouts and retries.
- Cost accounting.
- Structured logging to Phase 0a telemetry tables.
- Zod validation for structured outputs.
- Raw-output capture for failed validations.
- Normalized error objects.
- Test fixture support.

Suggested module shape:

```text
lib/llm/
  gateway.ts
  providers/
    anthropic.ts
    openai.ts
    openrouter.ts
  schemas/
    onboarding.ts
    digest.ts
    news.ts
    lessons.ts
    entities.ts
  fixtures/
    onboarding/
    news/
    lessons/
  cost.ts
  telemetry.ts
```

Migration order:

1. Low-risk classification and mapping calls.
2. Onboarding technical config generation.
3. Onboarding conversational JSON signals.
4. Newsletter summarization.
5. Daily news synthesis.
6. Lesson generation.

Migration rationale: move from lowest-risk and highest-volume calls toward the most user-visible synthesis calls. The gateway should prove cost accounting, validation, retries, and rollback behavior before it touches final editorial outputs.

Acceptance criteria:

- New gateway is used by at least one low-risk call site.
- Zod validation failures are logged with raw output.
- Migrated call sites must not exceed the Phase 0a per-call-site cost baseline by more than 15% over a 3-day post-migration window, unless the human owner approves the regression with documented rationale.
- Migrated call sites must not materially reduce output quality against Phase 0a fixtures and human review.
- Each migrated call site has a feature flag or equivalent runtime switch allowing instant rollback to the legacy path for the first 7 days after migration.
- Existing direct OpenAI/Anthropic wrappers are either migrated or marked legacy.
- New LLM calls are not allowed outside the gateway.

## Phase 0c: Product Spine Stabilization

Goal: make the existing product durable before adding major intelligence features.

This phase is stabilization only. Do not add new product capabilities here.

Scope:

- `docs/ONBOARDING_SPEC.md` as the implementation contract.
- Server-side onboarding state machine.
- Persistent inbox scan artifacts.
- Durable typed recommendation config.
- One canonical digest fetch/summarize pipeline.
- Dev/admin endpoint gating.
- State-machine and approval-path tests.

Minimum test coverage:

- Every valid onboarding state transition has at least one test.
- Every invalid onboarding state transition has at least one rejection test.
- Recommendation approval has an integration test for news-only, inbox-only, lesson-only, and mixed-slot configs.
- Refresh/resume behavior has a test proving critical onboarding state survives client reload.
- Dev/admin endpoint gating has a test proving ordinary authenticated users cannot trigger expensive manual routes.

Server-side onboarding states:

```text
conversation
intent_ready
gmail_needed
scanning
scan_complete
recommendation_ready
approved
complete
failed
```

Persisted artifacts:

- Conversation summary.
- Structured intent.
- Gmail connection status.
- Inbox scan summary.
- Candidate senders.
- Generated recommendation config.
- Approved config.
- State transition log.

Key fixes:

- Stop relying on `sessionStorage` for critical onboarding recovery.
- Store scan results server-side and reuse them during recommendation edits.
- Make recommendation approval validate the complete slot config.
- Remove or quarantine duplicate digest fetch/summarize routes.
- Require dev/admin authorization for manual expensive endpoints.

Acceptance criteria:

- Refreshing during onboarding does not lose critical state.
- A user can adjust a recommendation without losing inbox scan context.
- Recommendation config is validated before display and before approval.
- There is one canonical production digest pipeline.
- Expensive dev routes cannot be triggered by ordinary authenticated users.

## Phase 1: Graph Domain APIs

Goal: introduce the graph as an application/domain API, backed initially by plain Postgres.

No AGE or Neo4j decision in this phase.

Prerequisite decision:

- Decide the first durable `Rune` data model before interface implementation begins: one Rune per user for alpha, or many Runes per user from day one. This decision changes interface signatures, ownership boundaries, and telemetry grouping.

Core interfaces:

```ts
extractEntities(content): Promise<EntityCandidate[]>
resolveEntities(candidates): Promise<ResolvedEntity[]>
upsertStoryGraph(story, entities, relations): Promise<StoryGraphWriteResult>
getRuneContext(runeId, options): Promise<RuneContext>
rankCandidateStories(slotId, stories, context): Promise<RankedStory[]>
getContinuitySummary(runeId, window): Promise<ContinuitySummary>
recordUserFeedback(target, signal): Promise<void>
```

Initial domain objects:

- `Rune`
- `Slot`
- `Topic`
- `Entity`
- `Story`
- `Source`
- `Observation`
- `Run`
- `UserFeedback`

Initial relation types:

- `MENTIONS`
- `RELATES_TO`
- `COVERS`
- `TRUSTS`
- `CONTAINS`
- `COMPETES_WITH`
- `EMPLOYS`
- `CORROBORATES`
- `NOVEL_VS`

Backing store:

- Plain Supabase Postgres tables.
- Optional pgvector for embeddings if already available.
- SQL first, graph API boundary always.

Deliverables:

- Graph domain API interfaces and TypeScript types.
- Plain Postgres backing tables and migrations.
- Access pattern log for each graph domain API call.

Access pattern logging fields:

| Field | Notes |
| --- | --- |
| `api_name` | Stable domain API name, e.g. `getRuneContext` |
| `query_shape` | Normalized shape, not raw private content |
| `filters` | Entity type, slot id, date window, source type, etc. |
| `graph_depth` | Number of relationship hops requested, if applicable |
| `frequency_bucket` | Countable bucket for repeated access pattern analysis |
| `latency_ms` | End-to-end API latency |
| `result_count` | Result-set size |
| `storage_backend` | `postgres`, `postgres_pgvector`, future `age`, future `neo4j` |

Acceptance criteria:

- Product code calls graph domain APIs, not raw graph-specific queries.
- Entity extraction output is schema-validated.
- Entity resolution has deterministic rules plus an LLM fallback only for ambiguous cases.
- Continuity summary can answer what changed since prior runs.
- Access patterns are logged for Phase 3 infrastructure benchmarking.

## Phase 2: Intelligence Layer Rebuild

Goal: make retrieval, ranking, caching, and signal/noise decisions modular and measurable.

Components:

- `SearchProvider` interface.
- Tavily provider.
- Exa provider.
- Direct scraper provider.
- Provider router.
- Query decomposition engine.
- Two-layer cache.
- Signal/noise classifier v1.
- Source credibility scoring v1.

Search provider interface:

```ts
type SearchProvider = {
  name: string
  search(input: SearchInput): Promise<SearchResult[]>
  fetch?(input: FetchInput): Promise<FetchedDocument>
}
```

Provider routing:

- Semantic topic discovery -> Exa.
- Broad web/news retrieval -> Tavily.
- Known source or known URL -> direct scraper.
- Fallback on provider failure or insufficient result quality.

Open scoring problem:

- Define "good enough" per query type.
- Candidate heuristics: minimum result count, source diversity, recency, relevance score, duplicate rate, and content depth.
- Tune with real run data, not vibes.
- Deliverable: `docs/search-result-scoring-rubric.md` with thresholds per query type, reviewed against at least 50 real queries before the signal/noise classifier ships.

Caching:

- Raw scrape cache keyed by `(source, url, fetch_date)` with 24 hour TTL.
- Intelligence cache keyed by `(topic_embedding_hash, date_bucket)` with semantic similarity matching.
- Similarity threshold must be empirically tuned.

Signal/noise classifier v1:

- Heuristic prefilter.
- LLM judge only for ambiguous or high-value clusters.
- Output: ranked clusters with confidence, novelty, corroboration count, source weights, and rationale.

Acceptance criteria:

- Search can use multiple providers behind one interface.
- Fallback decisions are logged and inspectable.
- Cache hit/miss rate is measured.
- Signal/noise output is schema-validated.
- Cost per run remains within defined thresholds.

## Phase 3: Graph Infrastructure And Continuity

Goal: choose graph infrastructure based on real access patterns and add deeper continuity memory.

Benchmark candidates:

- Plain relational Postgres plus indexes.
- Plain relational Postgres plus indexes plus pgvector similarity where embeddings are needed.
- Postgres plus Apache AGE.
- Neo4j AuraDB.

Benchmark against real queries:

- Entities shared across multiple slots/runes.
- Story novelty versus prior runs.
- Source credibility by topic.
- Continuity summary over 7, 30, and 90 day windows.
- Cross-rune entity boosting.
- User feedback propagation.

Continuity memory:

- Rolling 7 day state summary.
- Longer-term entity/source preference profile.
- Prior lesson/day state.
- Recent covered stories to avoid repetition.
- Explicit "last mentioned" context for synthesis.

Source credibility:

- Per-source baseline.
- Per-topic source strength.
- Correction/quality feedback where available.
- Time-to-publish versus corroborated clusters.
- User feedback impact.

Acceptance criteria:

- Infrastructure decision is backed by benchmark data.
- Continuity summaries are available to synthesis without large prompt stuffing.
- Source credibility affects ranking in a measured way.
- Graph API boundary remains stable regardless of storage choice.

## Engineering Guardrails

- Every new LLM structured output must have a schema.
- Every expensive provider call must produce telemetry.
- Every new retrieval source must implement the provider interface.
- Product code should depend on domain interfaces, not provider/database specifics.
- Avoid prompt sprawl. Prefer shared prompt modules with fixtures.
- Do not hide dev-only work behind UI alone. Gate endpoints.
- Do not add graph infrastructure before graph access patterns exist.
- Do not build feature work in Phase 0c.

## Immediate Next Tasks

1. Review and approve `docs/ONBOARDING_SPEC.md` before Phase 0c implementation begins.
2. Monitor Phase 0b validation failures and cost deltas for the newly migrated onboarding chat and preview relevance call sites.
3. Draft the Phase 0b Exit Memo after the post-migration telemetry window is reviewed or explicitly waived.
4. Classify `app/api/digest/fetch-emails` and `app/api/backfill/start` as either dev-only routes to gate/remove or production routes to repoint to shared modules during Phase 0c.
5. Decide whether Google News RSS/web hydration metadata should keep raw public queries or move to hashed query labels in Phase 0c.

## Decision Log

| Decision | Status | Rationale |
| --- | --- | --- |
| Measure before refactor | Locked | Current cost and call behavior are unknown |
| Zod schemas before graph extraction | Locked | Graph memory must not be built from unvalidated LLM output |
| Graph APIs before graph database | Locked | Preserve optionality and reveal real access patterns |
| Plain Postgres backing in Phase 1 | Locked | Fastest way to validate domain model |
| No Phase 0c feature expansion | Locked | Stabilization must stay scoped |
| Gmail/OAuth telemetry must be privacy-minimal | Locked | Measure quota, latency, and failure rates without storing message ids, subjects, sender addresses, OAuth tokens, private bodies, or raw Gmail queries |
| Phase 0b migrations start with low-risk call sites | Locked | Build confidence in the gateway before touching expensive or user-visible synthesis paths |

## Open Questions

1. What is the current cost per complete Rune run by call site?
2. Which current LLM outputs are most failure-prone?
3. What minimum validation schema is needed for each existing call site?
4. How should slots map to news topics, inbox curation, and lessons long term?
5. What is the cost threshold per run and per user per month?
6. What similarity threshold makes topic cache reuse safe?
7. What source providers are legally and economically acceptable for X, Reddit, LinkedIn, and paywalled sources?

## Change Log

| Version | Date | Changes |
| --- | --- | --- |
| 1.14 | 2026-05-26 | Tightened `docs/ONBOARDING_SPEC.md` to v1.1 with card status rules, recommendation versioning, conversation summary generation, mutation response contracts, refinement gate validation, telemetry debounce, abandonment semantics, and accessibility/initial-state notes. |
| 1.13 | 2026-05-26 | Added `docs/ONBOARDING_SPEC.md` as the Phase 0c onboarding/product spine implementation contract. |
| 1.12 | 2026-05-26 | Completed Phase 0b code migration for production-relevant LLM call sites: onboarding chat turns now return schema-validated structured messages, preview news relevance uses schema validation, and dead legacy news synthesis was removed. |
| 1.11 | 2026-05-25 | Migrated onboarding technical config generation onto the Phase 0b gateway with a schema-validated slot allocation contract. |
| 1.10 | 2026-05-25 | Migrated sender batch classification from direct OpenAI fetch and regex parsing onto the Phase 0b gateway with schema validation. |
| 1.9 | 2026-05-25 | Migrated newsletter summaries, daily lesson synthesis, and current daily news synthesis onto schema validation; added daily-news prompt-size guardrails. |
| 1.8 | 2026-05-25 | Migrated low-risk onboarding/config JSON call sites and inbox sender relevance onto the Phase 0b schema gateway. |
| 1.7 | 2026-05-24 | Started Phase 0b gateway with schema validation, validation-failure capture, and first low-risk call-site migration. |
| 1.6 | 2026-05-24 | Added Google News RSS and web article hydration telemetry to Phase 0a coverage. |
| 1.5 | 2026-05-24 | Added Gmail/OAuth runtime telemetry coverage, privacy-minimal telemetry decision, and updated immediate Phase 0a tasks. |
| 1.4 | 2026-05-24 | Added Phase 0a run-health query and snapshot artifact for controlled production measurement. |
| 1.3 | 2026-05-22 | Updated Phase 0a artifact names to match implementation, added external API inventory/baseline and cleanup ledger as explicit Phase 0a artifacts, and clarified scope as no product behavior refactors. |
| 1.2 | 2026-05-22 | Added file path, current alpha state placeholder, human tie-breaker role, Phase Exit Memo process, `slot_run_id`, waiver recording requirements, 15% post-migration cost threshold, graph access pattern logging fields, and numbered open questions. |
| 1.1 | 2026-05-22 | Added Rune run definition, phase ownership, telemetry baseline duration, run health metrics, retention policy, migration rollback requirement, Phase 0c minimum tests, Phase 1 Rune-model prerequisite, Phase 2 scoring rubric deliverable, and changelog. |
| 1.0 | 2026-05-22 | Initial rebuild plan locked. |
