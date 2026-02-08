-- View actual email content for the 11 fetched emails
-- User ID: 0c8ed9ca-7734-4d48-8cf4-7fadb778b775

SELECT 
  id,
  sender_key,
  newsletter_name,
  subject,
  received_at,
  -- Content previews (first 200 chars)
  LEFT(html_content, 200) as html_preview,
  LEFT(text_content, 200) as text_preview,
  -- Content lengths
  LENGTH(html_content) as html_length,
  LENGTH(text_content) as text_length,
  -- Links
  links,
  article_url
  -- Full content (uncomment to see full text/html)
  -- , html_content as full_html
  -- , text_content as full_text
FROM digest_items
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND digest_id IS NULL
ORDER BY received_at DESC;
