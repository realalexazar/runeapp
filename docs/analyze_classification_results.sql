-- Analyze Classification Results
-- User ID: 0c8ed9ca-7734-4d48-8cf4-7fadb778b775

-- ============================================================================
-- SUMMARY: Overall Classification Breakdown
-- ============================================================================

SELECT 
  bucket,
  COUNT(*) as sender_count,
  SUM(msgs_14d) as total_messages,
  ROUND(AVG(msgs_14d)::numeric, 1) as avg_messages_per_sender,
  COUNT(*) FILTER (WHERE classifier_source = 'llm') as llm_classified,
  COUNT(*) FILTER (WHERE classifier_source = 'rule') as rule_classified,
  COUNT(*) FILTER (WHERE low_confidence = true) as low_confidence_count,
  MIN(updated_at) as first_classified,
  MAX(updated_at) as last_classified
FROM digest_candidates
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
GROUP BY bucket
ORDER BY 
  CASE bucket
    WHEN 'positive' THEN 1
    WHEN 'grey' THEN 2
    WHEN 'low' THEN 3
  END;

-- ============================================================================
-- DETAILED: LLM-Classified Senders (Positive, Grey, Low)
-- ============================================================================

SELECT 
  sender_key,
  bucket,
  msgs_14d as message_count,
  sample_size,
  low_confidence,
  updated_at
FROM digest_candidates
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND classifier_source = 'llm'
ORDER BY 
  CASE bucket
    WHEN 'positive' THEN 1
    WHEN 'grey' THEN 2
    WHEN 'low' THEN 3
  END,
  msgs_14d DESC;

-- ============================================================================
-- DETAILED: Rule-Filtered Senders (with reasons)
-- ============================================================================

-- Note: We don't store the reason in digest_candidates, but we can infer:
-- - Rule-filtered senders are all 'low' bucket
-- - They were filtered by cadence (< 2 messages) or hard rules

SELECT 
  sender_key,
  bucket,
  msgs_14d as message_count,
  classifier_source,
  updated_at,
  CASE 
    WHEN msgs_14d < 2 THEN 'Filtered: Insufficient cadence (< 2 messages)'
    ELSE 'Filtered: Hard rules (transactional/promotional)'
  END as inferred_reason
FROM digest_candidates
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND classifier_source = 'rule'
ORDER BY msgs_14d DESC;

-- ============================================================================
-- QUALITY CHECK: Low Confidence Flags
-- ============================================================================

SELECT 
  sender_key,
  bucket,
  msgs_14d as message_count,
  sample_size,
  low_confidence,
  CASE 
    WHEN low_confidence = true THEN 'Flagged: Low confidence (fewer than 3 messages)'
    ELSE 'High confidence'
  END as confidence_status
FROM digest_candidates
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND classifier_source = 'llm'
ORDER BY low_confidence DESC, msgs_14d DESC;

-- ============================================================================
-- COMPARISON: See Actual Subjects for LLM-Classified Senders
-- ============================================================================

-- Join with messages_raw to see what subjects the LLM saw
SELECT 
  dc.sender_key,
  dc.bucket,
  dc.msgs_14d as message_count,
  dc.sample_size,
  dc.low_confidence,
  ARRAY_AGG(DISTINCT mr.subject ORDER BY mr.received_at DESC) FILTER (
    WHERE mr.subject IS NOT NULL AND mr.subject != ''
  ) AS recent_subjects
FROM digest_candidates dc
LEFT JOIN messages_raw mr ON 
  mr.user_id = dc.user_id 
  AND mr.sender_key = dc.sender_key
  AND mr.received_at >= NOW() - INTERVAL '14 days'
WHERE dc.user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND dc.classifier_source = 'llm'
GROUP BY dc.sender_key, dc.bucket, dc.msgs_14d, dc.sample_size, dc.low_confidence
ORDER BY 
  CASE dc.bucket
    WHEN 'positive' THEN 1
    WHEN 'grey' THEN 2
    WHEN 'low' THEN 3
  END,
  dc.msgs_14d DESC
LIMIT 20; -- Top 20 for review

-- ============================================================================
-- QUICK STATS: Overall Health Check
-- ============================================================================

SELECT 
  COUNT(*) as total_senders,
  COUNT(*) FILTER (WHERE bucket = 'positive') as positive_count,
  COUNT(*) FILTER (WHERE bucket = 'grey') as grey_count,
  COUNT(*) FILTER (WHERE bucket = 'low') as low_count,
  COUNT(*) FILTER (WHERE classifier_source = 'llm') as llm_classified,
  COUNT(*) FILTER (WHERE classifier_source = 'rule') as rule_filtered,
  COUNT(*) FILTER (WHERE low_confidence = true) as low_confidence_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE bucket = 'positive') / COUNT(*), 1) as positive_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE bucket = 'grey') / COUNT(*), 1) as grey_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE bucket = 'low') / COUNT(*), 1) as low_pct
FROM digest_candidates
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';
