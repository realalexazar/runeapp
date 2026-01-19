-- Detailed view of Layer 1 senders (what the system sees)
-- Shows the 33 senders that passed cadence filter with their subjects and metadata
-- User ID: 0c8ed9ca-7734-4d48-8cf4-7fadb778b775

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
    ARRAY_AGG(subject ORDER BY received_at DESC) FILTER (WHERE subject IS NOT NULL AND subject != '') AS all_subjects,
    -- Get most common from_name/from_email (matching code logic)
    MODE() WITHIN GROUP (ORDER BY from_name) as most_common_from_name,
    MODE() WITHIN GROUP (ORDER BY from_email) as most_common_from_email
  FROM raw_messages
  GROUP BY sender_key
),
layer1_candidates AS (
  SELECT 
    sender_key,
    count_14d,
    subjects_with_content,
    most_common_from_name,
    most_common_from_email,
    -- Take up to 5 most recent subjects (matching code logic)
    (all_subjects)[1:LEAST(5, array_length(all_subjects, 1))] as sample_subjects
  FROM sender_stats
  WHERE count_14d >= 2  -- Cadence filter: >= 2 messages
    AND subjects_with_content > 0  -- Must have at least 1 subject
),
-- Hard rules check (same as Layer 2)
transaction_keywords AS (
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
subject_transaction_matches AS (
  SELECT DISTINCT
    l1.sender_key,
    s.subject,
    tk.keyword as matched_keyword
  FROM layer1_candidates l1
  CROSS JOIN LATERAL unnest(l1.sample_subjects) AS s(subject)
  INNER JOIN transaction_keywords tk ON LOWER(s.subject) LIKE '%' || tk.keyword || '%'
),
subject_discount_matches AS (
  SELECT DISTINCT
    l1.sender_key,
    s.subject,
    dk.keyword as matched_keyword
  FROM layer1_candidates l1
  CROSS JOIN LATERAL unnest(l1.sample_subjects) AS s(subject)
  INNER JOIN discount_keywords dk ON LOWER(s.subject) LIKE '%' || dk.keyword || '%'
),
sender_transaction_counts AS (
  SELECT 
    sender_key,
    COUNT(DISTINCT subject) AS transaction_match_count,
    ARRAY_AGG(DISTINCT matched_keyword) as transaction_keywords_found
  FROM subject_transaction_matches
  GROUP BY sender_key
),
sender_discount_counts AS (
  SELECT 
    sender_key,
    COUNT(DISTINCT subject) AS discount_match_count,
    ARRAY_AGG(DISTINCT matched_keyword) as discount_keywords_found
  FROM subject_discount_matches
  GROUP BY sender_key
),
layer2_classification AS (
  SELECT 
    l1.*,
    COALESCE(stc.transaction_match_count, 0) AS transaction_match_count,
    COALESCE(sdc.discount_match_count, 0) AS discount_match_count,
    COALESCE(stc.transaction_keywords_found, ARRAY[]::text[]) AS transaction_keywords_found,
    COALESCE(sdc.discount_keywords_found, ARRAY[]::text[]) AS discount_keywords_found,
    CASE 
      WHEN COALESCE(stc.transaction_match_count, 0) >= 2 THEN 'FILTERED: Transactional'
      WHEN COALESCE(sdc.discount_match_count, 0) >= 2 THEN 'FILTERED: Promotional'
      ELSE 'PASSED TO LLM'
    END AS layer2_result
  FROM layer1_candidates l1
  LEFT JOIN sender_transaction_counts stc ON l1.sender_key = stc.sender_key
  LEFT JOIN sender_discount_counts sdc ON l1.sender_key = sdc.sender_key
)

-- Final output: What the system sees for each sender
SELECT 
  sender_key,
  most_common_from_name,
  most_common_from_email,
  count_14d as message_count,
  array_length(sample_subjects, 1) as subjects_sampled,
  sample_subjects,
  transaction_match_count,
  discount_match_count,
  transaction_keywords_found,
  discount_keywords_found,
  layer2_result
FROM layer2_classification
ORDER BY 
  CASE layer2_result
    WHEN 'FILTERED: Transactional' THEN 1
    WHEN 'FILTERED: Promotional' THEN 2
    WHEN 'PASSED TO LLM' THEN 3
  END,
  count_14d DESC;
