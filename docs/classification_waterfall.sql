-- Classification Waterfall Analysis
-- Reconstructs the 3-layer sieve to see how many senders pass through each stage
-- User ID: 0c8ed9ca-7734-4d48-8cf4-7fadb778b775

-- ============================================================================
-- LAYER 1: CANDIDATE GENERATION (Domain + Cadence Filter)
-- ============================================================================

WITH fourteen_days_ago AS (
  SELECT NOW() - INTERVAL '14 days' AS cutoff
),
raw_messages AS (
  SELECT 
    sender_key,
    subject,
    from_name,
    from_email,
    received_at
  FROM messages_raw
  WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
    AND sender_key IS NOT NULL
    AND received_at >= (SELECT cutoff FROM fourteen_days_ago)
),
sender_stats AS (
  SELECT 
    sender_key,
    COUNT(*) as count_14d,
    COUNT(subject) FILTER (WHERE subject IS NOT NULL AND subject != '') as subjects_with_content,
    ARRAY_AGG(subject ORDER BY received_at DESC) FILTER (WHERE subject IS NOT NULL AND subject != '') AS all_subjects
  FROM raw_messages
  GROUP BY sender_key
),
layer1_candidates AS (
  SELECT 
    sender_key,
    count_14d,
    subjects_with_content,
    -- Take up to 5 most recent subjects (matching code logic)
    (all_subjects)[1:LEAST(5, array_length(all_subjects, 1))] as sample_subjects
  FROM sender_stats
  WHERE count_14d >= 2  -- Cadence filter: >= 2 messages
    AND subjects_with_content > 0  -- Must have at least 1 subject
)

-- ============================================================================
-- LAYER 2: HARD RULES FILTER (Transactional/Promotional Keywords)
-- ============================================================================

, transaction_keywords AS (
  SELECT unnest(ARRAY[
    'receipt', 'invoice', 'order', 'confirmation', 'security', 'verification', 
    'verify', 'login', 'otp', 'password', 'reset', 'shipped', 'tracking', 
    'delivery', 'package', 'payment', 'transaction', 'statement', 'alert', 'notification'
  ]) AS keyword
),
discount_keywords AS (
  SELECT unnest(ARRAY[
    '% off', '% discount', 'sale', 'deal', 'limited time', 'free shipping', 
    'buy now', 'special offer', 'promo', 'coupon', 'discount code', 'save', 'clearance'
  ]) AS keyword
),
-- Check each subject against transaction keywords (subject matches if ANY keyword matches)
subject_transaction_matches AS (
  SELECT DISTINCT
    l1.sender_key,
    s.subject,
    TRUE AS matches_transaction
  FROM layer1_candidates l1
  CROSS JOIN LATERAL unnest(l1.sample_subjects) AS s(subject)
  INNER JOIN transaction_keywords tk ON LOWER(s.subject) LIKE '%' || tk.keyword || '%'
),
-- Check each subject against discount keywords (subject matches if ANY keyword matches)
subject_discount_matches AS (
  SELECT DISTINCT
    l1.sender_key,
    s.subject,
    TRUE AS matches_discount
  FROM layer1_candidates l1
  CROSS JOIN LATERAL unnest(l1.sample_subjects) AS s(subject)
  INNER JOIN discount_keywords dk ON LOWER(s.subject) LIKE '%' || dk.keyword || '%'
),
-- Count how many subjects matched (need 2+ to filter)
sender_transaction_counts AS (
  SELECT 
    sender_key,
    COUNT(DISTINCT subject) AS transaction_match_count
  FROM subject_transaction_matches
  GROUP BY sender_key
),
sender_discount_counts AS (
  SELECT 
    sender_key,
    COUNT(DISTINCT subject) AS discount_match_count
  FROM subject_discount_matches
  GROUP BY sender_key
),
layer2_filtered AS (
  SELECT 
    l1.*,
    COALESCE(stc.transaction_match_count, 0) >= 2 AS is_transactional,
    COALESCE(sdc.discount_match_count, 0) >= 2 AS is_promotional,
    CASE 
      WHEN COALESCE(stc.transaction_match_count, 0) >= 2 THEN 'hard_rule_transactional'
      WHEN COALESCE(sdc.discount_match_count, 0) >= 2 THEN 'hard_rule_promotional'
      ELSE NULL
    END AS hard_rule_reason
  FROM layer1_candidates l1
  LEFT JOIN sender_transaction_counts stc ON l1.sender_key = stc.sender_key
  LEFT JOIN sender_discount_counts sdc ON l1.sender_key = sdc.sender_key
),
layer2_passed AS (
  SELECT *
  FROM layer2_filtered
  WHERE hard_rule_reason IS NULL  -- Passed hard rules, goes to LLM
),
layer2_filtered_out AS (
  SELECT *
  FROM layer2_filtered
  WHERE hard_rule_reason IS NOT NULL  -- Filtered by hard rules
)

-- ============================================================================
-- SUMMARY: WATERFALL BREAKDOWN
-- ============================================================================

SELECT 
  stage,
  sender_count,
  total_messages
FROM (
  SELECT 
    1 AS sort_order,
    'LAYER 1: All Unique Senders' AS stage,
    COUNT(DISTINCT sender_key) AS sender_count,
    SUM(count_14d) AS total_messages
  FROM sender_stats

  UNION ALL

  SELECT 
    2 AS sort_order,
    'LAYER 1: After Cadence Filter (>=2 msgs)' AS stage,
    COUNT(*) AS sender_count,
    SUM(count_14d) AS total_messages
  FROM layer1_candidates

  UNION ALL

  SELECT 
    3 AS sort_order,
    'LAYER 2: Filtered by Hard Rules' AS stage,
    COUNT(*) AS sender_count,
    SUM(count_14d) AS total_messages
  FROM layer2_filtered_out

  UNION ALL

  SELECT 
    4 AS sort_order,
    'LAYER 3: Passed to LLM' AS stage,
    COUNT(*) AS sender_count,
    SUM(count_14d) AS total_messages
  FROM layer2_passed
) AS results
ORDER BY sort_order;

-- ============================================================================
-- DETAILED BREAKDOWN: See which senders were filtered and why
-- ============================================================================

-- Uncomment to see detailed breakdown:

/*
-- Layer 1: Senders filtered by cadence (< 2 messages)
SELECT 
  'LAYER 1 FILTERED: Insufficient Cadence' AS filter_reason,
  sender_key,
  count_14d,
  subjects_with_content
FROM sender_stats
WHERE count_14d < 2 OR subjects_with_content = 0
ORDER BY count_14d DESC;

-- Layer 2: Senders filtered by hard rules
SELECT 
  'LAYER 2 FILTERED: ' || hard_rule_reason AS filter_reason,
  sender_key,
  count_14d,
  is_transactional,
  is_promotional,
  sample_subjects
FROM layer2_filtered_out
ORDER BY count_14d DESC;

-- Layer 3: Senders that passed to LLM
SELECT 
  'LAYER 3: LLM Candidates' AS stage,
  sender_key,
  count_14d,
  sample_subjects
FROM layer2_passed
ORDER BY count_14d DESC;
*/
