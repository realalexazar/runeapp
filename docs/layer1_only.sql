-- Layer 1: Candidate Generation (Domain + Cadence Filter)
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
    ARRAY_AGG(subject ORDER BY received_at DESC) FILTER (WHERE subject IS NOT NULL AND subject != '') AS all_subjects
  FROM raw_messages
  GROUP BY sender_key
)

-- Summary: Layer 1 Breakdown
SELECT 
  stage,
  sender_count,
  total_messages,
  total_subjects
FROM (
  SELECT 
    1 AS sort_order,
    'All Unique Senders' AS stage,
    COUNT(*) AS sender_count,
    SUM(count_14d) AS total_messages,
    SUM(subjects_with_content) AS total_subjects
  FROM sender_stats

  UNION ALL

  SELECT 
    2 AS sort_order,
    'After Cadence Filter (>=2 msgs + has subjects)' AS stage,
    COUNT(*) AS sender_count,
    SUM(count_14d) AS total_messages,
    SUM(subjects_with_content) AS total_subjects
  FROM sender_stats
  WHERE count_14d >= 2 
    AND subjects_with_content > 0
) AS results
ORDER BY sort_order;
