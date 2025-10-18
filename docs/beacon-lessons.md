### Beacon lessons learned (v5b2 → v5c)

- Context: We re-enriched to v5b2, then fixed cold-start (first message) and expanded transactional suppression, publishing v5c.

### What drove positives in this sample
- SimHash-only positives (grey): `linkedin.com`, `epochtimes.com`, `theepochtimes.com`, `zillow.com`, `nextdoor.com`, `investopedia.com`, `theathletic.com` all showed `simhash_strong` with:
  - No `List-Id`/`List-Unsubscribe`
  - No footer/ESP/pixel/VIB tags
  - Very low link diversity (host_entropy ≈ 0)
  - Outcome: label=true from template stability + “many links”; confidence mid (~0.56) → grey (not surfaced).
- Feature-only positives (grey): Singletons like `ufl.edu`, `saks.com`, `nationalcar.com` had long bodies, high text_to_link_ratio, entropy ≥ ~1.2, but no rule tags. With v5c cold-start fix, these first messages become NO unless footer/ESP is present.

### What drove negatives
- Cold-start hard NO: First/earliest per `sender_key` in 30 days failing (footer/ESP) AND (len≥700 OR ratio≥200) AND (entropy ≥ bar) → `why_not_top = cold_start_requirements_not_met`, confidence ≈ 0.12.
- Low entropy drag: When cold-start didn’t apply, `host_entropy ≈ 0` + no headers/footer pulled score below positive → negative at ~0.44 with `why_not_top = low host entropy` (even if `simhash_strong` fired).
- Transactional: “reservation/booking/itinerary/pickup/drop‑off/confirm” were missed before (e.g., `nationalcar.com`). v5c adds them → short‑circuit NO with `transactional_signal`.

### Cold-start behavior (why it matters)
- Before: Triggered when `counts_30d === 1` only (first‑ever could skip).
- Now (v5c): Fires on the very first message (missing profile or `counts_30d = 0`). Day‑1 must show footer/ESP + volume/ratio + entropy or it’s NO.
- Re-enrich vs parse: Parse builds `sender_profiles` (counts/spacing/centroids). Re-enrich reads rollups but doesn’t build them. After a parse pass, only the earliest message per sender_key is gated; the rest use full rules.

### Entropy vs text/length (orthogonal)
- text_to_link_ratio: how much text per link (content depth). High = text‑heavy.
- host_entropy: how links are distributed across domains (diversity). 0 = one host; ~1.0 = two hosts 50/50; ~1.58 = three hosts evenly. We use ~1.2 as a conservative “not single‑destination” bar (then adapt to per‑sender P40 with history).

### Confidence and grey-zone
- Buckets: ≥0.85 strong positive; 0.15–0.85 grey; ≤0.15 strong negative.
- Policy: Only grey feeds ML/LLM. Cold‑start/transactional are strong negatives (skip ML).

### Header/footer importance
- Strong headers (List‑Id/List‑Unsubscribe): high precision; absence kept big senders in grey even with SimHash.
- Footer/ESP/pixel/VIB: helpful positives; footer/ESP also required by cold‑start.

### Changes shipped (v5c)
- Cold‑start on first message (missing profile or counts_30d=0).
- Transactional expansion: reservation/booking/itinerary/pickup/drop‑off/confirm (+ minor account alerts).
- Version bump to `v5c`; re‑enrich predicates updated.

### Practical guidance
- Surface now: only confidence ≥ 0.85.
- Route to ML: grey (0.15–0.85), including simhash‑only positives and low‑entropy negatives.
- Ops tip: After backfill, run parse to build `sender_profiles` so cold‑start applies once per sender and SimHash can reference centroids.

### Future refinements (optional)
- Require `simhash_strong` + ≥1 of {strong_headers, footer_i18n, esp_fingerprint} for positive (tighten simhash‑only).
- Add trace tags for entropy (e.g., `low_diversity`) for faster QA.
- Pre‑seed `sender_profiles` from backfilled cleans to smooth onboarding prior to parse.