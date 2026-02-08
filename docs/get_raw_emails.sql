-- Get raw email content (as stored in database)
-- Shows html_content, text_content, and links before any processing

SELECT 
  id,
  newsletter_name,
  subject,
  received_at,
  -- Content type indicators
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
  -- Full content (use text_content if available, otherwise html_content)
  text_content as raw_text_content,
  html_content as raw_html_content,
  -- Links
  links,
  -- Summary (if generated)
  content_summary
FROM digest_items
WHERE digest_id IS NULL
  AND content_summary IS NOT NULL -- Only show items that have been processed
ORDER BY received_at DESC;
