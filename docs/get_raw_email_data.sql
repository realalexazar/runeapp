-- Get raw email data for analysis (simple version)
SELECT 
  newsletter_name,
  subject,
  LENGTH(COALESCE(text_content, html_content, '')) as content_length,
  CASE 
    WHEN LENGTH(COALESCE(text_content, html_content, '')) > 10000 THEN 'TRUNCATED'
    ELSE 'FULL'
  END as truncation_status,
  LEFT(COALESCE(text_content, html_content, ''), 5000) as content_preview,
  content_summary
FROM digest_items
WHERE digest_id IS NULL
ORDER BY received_at DESC
LIMIT 20;
