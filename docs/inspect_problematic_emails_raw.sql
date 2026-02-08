-- Inspect raw email content for the 3 problematic emails
-- These emails returned "No specific details provided" summaries

SELECT 
  id,
  newsletter_name,
  subject,
  received_at,
  -- Content type
  CASE 
    WHEN html_content IS NOT NULL AND text_content IS NOT NULL THEN 'Both HTML and Text'
    WHEN html_content IS NOT NULL THEN 'HTML Only'
    WHEN text_content IS NOT NULL THEN 'Text Only'
    ELSE 'No Content'
  END as content_type,
  -- Content lengths
  LENGTH(html_content) as html_length,
  LENGTH(text_content) as text_length,
  LENGTH(COALESCE(text_content, html_content, '')) as total_content_length,
  -- Full raw content
  text_content as raw_text_content,
  html_content as raw_html_content,
  -- Links
  links,
  -- Generated summary (for reference)
  content_summary
FROM digest_items
WHERE digest_id IS NULL
  AND (
    (newsletter_name = 'Epoch Times Morning Brief' AND subject LIKE '%Shutdown%')
    OR (newsletter_name = 'Must Reads' AND subject LIKE '%MercadoLibre%')
    OR (newsletter_name = 'Cedric Bobo' AND (subject LIKE '%CBRE%' OR subject LIKE '%Internship%'))
  )
ORDER BY received_at DESC;
