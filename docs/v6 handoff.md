### Beacon v6 – Handoff and Testing Guide

#### 1) Beacon overview (how it works, where to find things)

- App stack: Next.js (App Router) + Supabase (Auth, Postgres, Storage).
- Purpose: Detect newsletters in a user’s Gmail, classify each email, roll up per‑sender behavior, power a digest.
- Privacy: Google OAuth read‑only; refresh token AES‑GCM encrypted; RLS enforced; service_role used in server routes.

- Key endpoints/files (open these to reason about behavior):
  - `app/api/parse/run/route.ts` – Parse new raws → `messages_clean` and classify (v6).
  - `app/api/parse/re-enrich/route.ts` – Re‑process existing `messages_clean` to current logic (v6), fixes consistency/time‑variance and writes audit fields.
  - `app/api/export/features/route.ts` – Export dataset for model training.
  - `lib/newsletters/domain.ts` – Registrable domain + normalization helpers.
  - `lib/supabase/{server,service}.ts` – Supabase clients.

- Data model (main tables):
  - `messages_raw`: raw `.eml` storage paths.
  - `messages_clean`: parsed + classified mail. Important columns: `signals` (JSON), `features_json` (JSON), `reasons` (JSON), `confidence`, `classifier_version`, `classifier_source`, `sender_key`, `received_at`, `subject`, `headers_json`, `template_hash`.
  - `sender_profiles`: per‑sender rollups per user (`counts_7d/30d`, `min_spacing_days`, `template_centroids`, `cadence_flags`, `override_is_newsletter`, `override_ttl`).

- Classifier (Beacon) logic – waterfall summary:
  1) User override (TTL‑aware) → force label; confidence≈0.99.
  2) Transactional suppression (Auto‑Submitted, DSN, OTP/2FA/login, receipts/orders/shipping/reservations) → negative; ≈0.98.
  3) Headline alert suppression (breaking/news alert + thin body + low diversity + no list headers) → negative; ≈0.90.
  4) Positive nudges (headers, footer/ESP, tracking pixel, view‑in‑browser, many links, subject cues, entropy, cadence, similarity).
  5) Cold‑start gate (first message in 30d window) – explicit checks for footer/ESP + volume + entropy; if fail → ≈0.12.
  6) Logistic mapping on score (for non‑gated rows): `p = 1/(1+exp(-1.2*(score-3)))`; LO/HI gates at 0.15/0.85. `confidence` = p (rounded to 2 dp) on logistic path.


#### 2) What changed in Beacon v6 (why and what)

Goal: Zero‑drift, auditable scoring and time‑invariant re‑enrichment.

- Version bump: Both parse and re‑enrich write/select `classifier_version='v6'`.

- Durable rule tagging and time‑invariant cold‑start:
  - We always tag `cold_start_satisfied` in `reasons.applied_rules` when the cold‑start +1 is applied.
  - Re‑enrich recomputes historical `counts_30d` relative to each message’s `received_at` so cold‑start evaluation matches classification‑time conditions.

- Per‑signal components ledger (new):
  - As we score, we accumulate a numeric breakdown per rule into `reasons.meta.components` (JSON), e.g.:
    - `list_id:3`, `list_unsubscribe:2`, `one_click:1`, `view_in_browser:1`, `postal_address:1`, `i18n_unsubscribe:1`, `esp_fingerprint:1`, `many_links:1`, `tracking_pixel:1`, `subject_cue:0.5`, `entropy_ok:1`, `cadence:1`, `cold_start_satisfied:1`, and `negative_penalty:-N` when applicable.
  - We also continue to store `reasons.meta.score` (final float) and `reasons.applied_rules` (human‑readable tags with deterministic ordering including `cold_start_satisfied`).
  - Why: SQL audits can now sum components → exact `score` → exact p. No guessing from today’s DB state; fully time‑invariant and explainable.

- Other standardizations carried forward:
  - Header keys normalized to lowercase; subject cues are keywords (no emoji heuristics).
  - Auto‑promotion: any email with confidence ≥ 0.85 sets `sender_profiles.override_is_newsletter=true` (TTL null) for digest.


#### 3) Runbook – re‑enrich script, initial testing, full test suite (v6)

##### A) Re‑enrich script (browser console)

```js
// v6 re-enrich loop
for (let i=0;i<200;i++){
  const r = await fetch('/api/parse/re-enrich',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'include',
    body:JSON.stringify({limit:200})
  });
  if(!r.ok){ console.error('HTTP', r.status, await r.text()); break; }
  const j = await r.json();
  console.log('v6 re-enrich batch', j, j.errors?.slice(0,5)||[]);
  if(!j.ok || j.selected===0 || j.remaining===0) break;
  await new Promise(s=>setTimeout(s,250));
}
```

##### B) Initial testing steps

1) Optional: clear auto‑promotions (user overrides) to observe pure algorithm:
```sql
UPDATE sender_profiles
SET override_is_newsletter = NULL, override_ttl = NULL
WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775';
```
2) Reset versions to migrate all rows to v6, then run the re‑enrich loop above:
```sql
UPDATE messages_clean
SET classifier_version = NULL
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';
```

##### C) v6 testing suite (copy/paste)

- Version/coverage sanity
```sql
SELECT classifier_version, count(*)
FROM messages_clean
WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
GROUP BY 1 ORDER BY 1;

SELECT
  sum((sender_key IS NULL)::int) AS missing_sender_key,
  sum((subject IS NULL)::int) AS missing_subject,
  sum((headers_json IS NULL)::int) AS missing_headers,
  sum((features_json IS NULL)::int) AS missing_features
FROM messages_clean
WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND classifier_version='v6';

SELECT count(*) AS remaining
FROM messages_clean
WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND (classifier_version IS NULL OR classifier_version <> 'v6' OR sender_key IS NULL OR subject IS NULL);
```

- Logistic p alignment (sum components → score → p)
```sql
WITH logistic AS (
  SELECT confidence AS stored_confidence,
         (SELECT SUM((val)::numeric)
            FROM jsonb_each_text(reasons->'meta'->'components')) AS score_c
  FROM messages_clean
  WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
    AND classifier_version='v6'
    AND (reasons->'meta'->>'mapping')='logistic_v1'
)
SELECT COUNT(*) AS sample_size,
       SUM((ABS(stored_confidence - (1.0/(1.0+EXP(-1.2*(score_c-3.0))))) <= 0.01)::int) AS matches_tol_0p01,
       SUM((ABS(stored_confidence - (1.0/(1.0+EXP(-1.2*(score_c-3.0))))) >  0.01)::int) AS mismatches_tol_0p01,
       ROUND(AVG(ABS(stored_confidence - (1.0/(1.0+EXP(-1.2*(score_c-3.0))))) )::numeric, 4) AS avg_abs_diff
FROM logistic;
```

- List any remaining logistic outliers (> 0.01)
```sql
WITH s AS (
  SELECT id, received_at, subject, confidence,
         (SELECT SUM((val)::numeric) FROM jsonb_each_text(reasons->'meta'->'components')) AS score_c
  FROM messages_clean
  WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND classifier_version='v6'
    AND (reasons->'meta'->>'mapping')='logistic_v1'
)
SELECT id, received_at, subject,
       confidence AS stored_confidence,
       ROUND((1.0/(1.0+EXP(-1.2*(score_c-3.0))))::numeric, 4) AS p_calc_4dp,
       ROUND(ABS(confidence - (1.0/(1.0+EXP(-1.2*(score_c-3.0)))))::numeric, 4) AS abs_diff
FROM s
WHERE ABS(confidence - (1.0/(1.0+EXP(-1.2*(score_c-3.0))))) > 0.01
ORDER BY abs_diff DESC
LIMIT 50;
```

- Path breakdown (gates/overrides vs logistic)
```sql
WITH m AS (
  SELECT
    COALESCE(reasons->>'why_not_top',
      CASE
        WHEN ((reasons->'applied_rules')::jsonb ? 'transactional_suppression') THEN 'transactional_signal'
        WHEN ((reasons->'applied_rules')::jsonb ? 'headline_alert_suppression') THEN 'headline_alert'
        WHEN ((reasons->'applied_rules')::jsonb ? 'cold_start_gate') THEN 'cold_start_requirements_not_met'
        WHEN ((reasons->'applied_rules')::jsonb ? 'user_override') THEN 'user_override'
        ELSE 'logistic_v1'
      END) AS path
  FROM messages_clean
  WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND classifier_version='v6'
)
SELECT path, count(*) FROM m GROUP BY 1 ORDER BY count(*) DESC;
```

- Buckets (efficacy posture)
```sql
SELECT
  sum((confidence >= 0.85)::int) AS newsletter_high,
  sum((confidence > 0.15 AND confidence < 0.85)::int) AS grey_area,
  sum((confidence <= 0.15)::int) AS not_newsletter_low
FROM messages_clean
WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND classifier_version='v6';
```

- Cadence tags (optional checks)
```sql
-- Daily
SELECT count(*) AS daily_tagged
FROM messages_clean mc
JOIN sender_profiles sp ON sp.user_id=mc.user_id
 AND sp.sender_key = COALESCE(NULLIF(mc.headers_json->>'list_id',''), mc.sender_key)
WHERE mc.user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND mc.classifier_version='v6'
 AND sp.min_spacing_days <= 2
 AND (mc.reasons->'applied_rules')::jsonb ? 'cadence_daily';

-- Weekly/biweekly
SELECT count(*) AS weekly_tagged
FROM messages_clean mc
JOIN sender_profiles sp ON sp.user_id=mc.user_id
 AND sp.sender_key = COALESCE(NULLIF(mc.headers_json->>'list_id',''), mc.sender_key)
WHERE mc.user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND mc.classifier_version='v6'
 AND sp.min_spacing_days > 2 AND sp.min_spacing_days <= 9
 AND (mc.reasons->'applied_rules')::jsonb ? 'cadence_weekly';
```

- Promotions (auto‑promotion at ≥0.85)
```sql
SELECT sender_key, override_is_newsletter, override_ttl, updated_at
FROM sender_profiles
WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND override_is_newsletter = true
ORDER BY sender_key;
```

- Similarity signals (optional QA)
```sql
SELECT
  sum(((reasons->'applied_rules')::jsonb ? 'simhash_strong')::int) AS simhash_strong,
  sum(((reasons->'applied_rules')::jsonb ? 'simhash_weak')::int)   AS simhash_weak
FROM messages_clean
WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND classifier_version='v6';

SELECT id, sender_key, subject, reasons->'features'->>'template_hamming_distance' AS hamming
FROM messages_clean
WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND classifier_version='v6'
  AND ((reasons->'applied_rules')::jsonb ? 'simhash_strong'
       OR (reasons->'applied_rules')::jsonb ? 'simhash_weak')
ORDER BY received_at DESC LIMIT 20;
```

- Headers/features integrity (sanity)
```sql
SELECT
  sum(((headers_json->>'list_id') IS NOT NULL)::int) AS has_list_id,
  sum(((headers_json->>'list_unsubscribe') IS NOT NULL)::int) AS has_list_unsubscribe,
  sum(((features_json->>'host_entropy') IS NOT NULL)::int) AS has_host_entropy,
  sum(((features_json->>'link_count') IS NOT NULL)::int) AS has_link_count
FROM messages_clean
WHERE user_id='0c8ed9ca-7734-4d48-8cf4-7fadb778b775' AND classifier_version='v6';
```

- Logistic formula table (sanity)
```sql
WITH t(s) AS (VALUES (0),(1),(2),(3),(4),(5),(6))
SELECT s AS score, ROUND((1.0/(1.0+EXP(-1.2*(s-3))))::numeric, 4) AS p_formula
FROM t ORDER BY s;
```


