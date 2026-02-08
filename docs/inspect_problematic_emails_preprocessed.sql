-- Inspect preprocessed content for the 3 problematic emails
-- Compare raw vs preprocessed to see if boilerplate stripping removed too much

SELECT 
  id,
  newsletter_name,
  subject,
  received_at,
  -- Raw content lengths
  LENGTH(COALESCE(text_content, html_content, '')) as raw_content_length,
  -- Preprocessed content
  preprocessed_content,
  LENGTH(preprocessed_content) as preprocessed_length,
  -- Comparison metrics
  CASE 
    WHEN LENGTH(preprocessed_content) > 0 THEN 
      ROUND((LENGTH(preprocessed_content)::numeric / NULLIF(LENGTH(COALESCE(text_content, html_content, '')), 0) * 100), 2)
    ELSE 0
  END as content_preserved_percent,
  -- Check if preprocessed is empty or very short
  CASE 
    WHEN preprocessed_content IS NULL THEN 'NULL'
    WHEN LENGTH(preprocessed_content) = 0 THEN 'EMPTY'
    WHEN LENGTH(preprocessed_content) < 100 THEN 'VERY SHORT (<100 chars)'
    WHEN LENGTH(preprocessed_content) < 500 THEN 'SHORT (<500 chars)'
    ELSE 'OK'
  END as preprocessed_status,
  -- Generated summary (for reference)
  content_summary,
  LENGTH(content_summary) as summary_length
FROM digest_items
WHERE digest_id IS NULL
  AND (
    (newsletter_name = 'Epoch Times Morning Brief' AND subject LIKE '%Shutdown%')
    OR (newsletter_name = 'Must Reads' AND subject LIKE '%MercadoLibre%')
    OR (newsletter_name = 'Cedric Bobo' AND (subject LIKE '%CBRE%' OR subject LIKE '%Internship%'))
  )
ORDER BY received_at DESC;
