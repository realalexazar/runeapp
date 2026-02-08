-- Get preprocessed content (exact content sent to LLM)
-- This shows the content after HTML conversion, boilerplate stripping, and truncation

SELECT 
  id,
  newsletter_name,
  subject,
  received_at,
  -- Preprocessed content (exact content sent to LLM)
  preprocessed_content,
  LENGTH(preprocessed_content) as preprocessed_length,
  -- Generated summary
  content_summary,
  LENGTH(content_summary) as summary_length,
  -- Comparison: raw vs preprocessed
  LENGTH(COALESCE(text_content, html_content, '')) as raw_content_length,
  CASE 
    WHEN preprocessed_content IS NOT NULL THEN 
      ROUND((LENGTH(preprocessed_content)::numeric / NULLIF(LENGTH(COALESCE(text_content, html_content, '')), 0) * 100), 2)
    ELSE NULL
  END as content_preserved_percent
FROM digest_items
WHERE digest_id IS NULL
  AND preprocessed_content IS NOT NULL
ORDER BY received_at DESC;
