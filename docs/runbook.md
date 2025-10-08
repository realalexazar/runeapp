Backfill / Parse / Re‑Enrich Runbook + Rule Flags

This guide covers how to run backfill/parse/re‑enrich and export training data.

1) Backfill (Gmail → Storage + messages_raw)
- Dashboard: Start Backfill.
- First run ~30 days; next runs ~2 days overlap (idempotent).
- API: POST /api/backfill/start
- Example: { ok: true, messages_scanned: 57, uploaded: 57, inserted: 57, failed: 0 }

2) Parse (raw .eml → cleaned + classification)
- Dashboard: Parse Until Done (limit default 300).
- API: POST /api/parse/run  body { "limit": 300 }
- Writes messages_clean: features_json, signals, is_newsletter, confidence, classifier_source, classifier_version, reasons (applied_rules ordered, top_reasons, optional why_not_top, features).
- Current version: v5c (cold‑start fires on first message, SimHash, monthly + daily/weekly tags, LO/HI gating, sender_key normalization; expanded transactional suppression).

3) Re‑Enrich (refresh old rows to current rules)
- API: POST /api/parse/re-enrich  body { "limit": 200 }
- Console loop:
```js
(async () => {
  for (let i = 0; i < 2000; i++) {
    const res = await fetch('/api/parse/re-enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ limit: 500 }) });
    if (!res.ok) break;
    const r = await res.json();
    console.log('re-enrich batch', r);
    if (!r.ok || r.selected === 0 || r.remaining === 0) break;
    await new Promise(r => setTimeout(r, 250));
  }
})();
```
- Selection and remaining share the same predicate (v5c + missing metadata).

4) Progress + Quick Checks
- GET /api/parse/progress returns raw/clean/newsletters/remaining.
- Use the SQL evaluation pack for counts, cold‑start, gray‑zone, similarity, suppressions.

5) Feature Export (for model training)
- CSV:  GET /api/export/features?format=csv&limit=2000
- JSON: GET /api/export/features?format=json&limit=10
- Columns: label_is_newsletter, confidence, features, signals, applied_rules, template_hamming_distance, metadata.

6) Rule Flags (in app/api/parse/run/route.ts)
- ENABLE_MONTHLY (true): adds cadence_monthly nudge.
- ENABLE_MODEL (false): gray‑zone model; tags "model", sets classifier_source=model, stamps reasons.meta.model_version.
- ENABLE_LLM (false): gray‑zone LLM; tags "llm", sets classifier_source=llm, stamps reasons.meta.llm_prompt_version.

Notes
- Sender key normalized to registrable Unicode; duplicate TLDs collapse (example.com.com → example.com).
- SimHash similarity records template_hamming_distance and tags simhash_strong/weak.
- Strict cold‑start (day‑1): footer/ESP AND (len ≥ 700 OR ratio ≥ 200) AND host_entropy ≥ 1.2, else cold_start_gate.

7) Troubleshooting
- 401 Unauthorized: refresh + login; ensure same origin.
- Studio snippet errors: open a new query tab instead of a stale snippet link.
- Tag ordering: re‑enrich once; applied_rules are deterministic.

Last updated: v5c

