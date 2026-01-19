-- UI Classification View
-- Shows all senders grouped by bucket (positive → grey → low)
-- Extracts newsletter names from domains and from_name
-- User ID: 0c8ed9ca-7734-4d48-8cf4-7fadb778b775

WITH sender_names AS (
  SELECT DISTINCT
    mr.sender_key,
    mr.from_name,
    -- Extract readable name from domain (remove TLD, capitalize words)
    INITCAP(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(mr.sender_key, '.com', ''),
            '.org', ''
          ),
          '.net', ''
        ),
        '.', ' '
      )
    ) as domain_name
  FROM messages_raw mr
  WHERE mr.user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
    AND mr.sender_key IS NOT NULL
),
newsletter_names AS (
  SELECT 
    dc.sender_key,
    dc.bucket,
    dc.msgs_14d,
    dc.classifier_source,
    dc.low_confidence,
    -- Prefer from_name if available, otherwise use parsed domain name
    COALESCE(
      sn.from_name,
      sn.domain_name,
      dc.sender_key
    ) as newsletter_name
  FROM digest_candidates dc
  LEFT JOIN sender_names sn ON dc.sender_key = sn.sender_key
  WHERE dc.user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
)

SELECT 
  newsletter_name as "Newsletter Name",
  sender_key as "Domain",
  CASE 
    WHEN bucket = 'positive' THEN 'Yes'
    WHEN bucket = 'grey' THEN 'Grey'
    WHEN bucket = 'low' THEN 'No'
  END as "Status",
  msgs_14d as "Messages",
  CASE 
    WHEN bucket = 'positive' AND low_confidence THEN 'Low Confidence'
    WHEN bucket = 'positive' THEN 'High Confidence'
    WHEN bucket = 'grey' AND low_confidence THEN 'Low Confidence'
    WHEN bucket = 'grey' THEN 'High Confidence'
    WHEN bucket = 'low' AND classifier_source = 'rule' THEN 'Rule Filtered'
    WHEN bucket = 'low' AND low_confidence THEN 'Low Confidence'
    WHEN bucket = 'low' THEN 'LLM Classified'
  END as "Confidence",
  CASE 
    WHEN bucket = 'positive' THEN 1
    WHEN bucket = 'grey' THEN 2
    WHEN bucket = 'low' THEN 3
  END as sort_order
FROM newsletter_names
ORDER BY 
  sort_order,
  msgs_14d DESC;
