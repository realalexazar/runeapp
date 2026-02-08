-- Verify fetched emails stored in digest_items (temporary storage)
-- User ID: 0c8ed9ca-7734-4d48-8cf4-7fadb778b775

-- 1. Count temporary items (digest_id IS NULL)
SELECT 
  COUNT(*) as total_items,
  COUNT(DISTINCT sender_key) as unique_senders,
  COUNT(CASE WHEN html_content IS NOT NULL THEN 1 END) as has_html,
  COUNT(CASE WHEN text_content IS NOT NULL THEN 1 END) as has_text,
  COUNT(CASE WHEN provider_message_id IS NOT NULL THEN 1 END) as has_message_id
FROM digest_items
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND digest_id IS NULL;

-- 2. Show all fetched items with details
SELECT 
  sender_key,
  newsletter_name,
  subject,
  received_at,
  CASE 
    WHEN html_content IS NOT NULL THEN 'Yes' 
    ELSE 'No' 
  END as has_html,
  CASE 
    WHEN text_content IS NOT NULL THEN 'Yes' 
    ELSE 'No' 
  END as has_text,
  LENGTH(html_content) as html_length,
  LENGTH(text_content) as text_length,
  provider_message_id,
  article_url,
  created_at
FROM digest_items
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND digest_id IS NULL
ORDER BY received_at DESC;

-- 3. Group by sender to see distribution
SELECT 
  sender_key,
  newsletter_name,
  COUNT(*) as email_count,
  MIN(received_at) as oldest_email,
  MAX(received_at) as newest_email
FROM digest_items
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND digest_id IS NULL
GROUP BY sender_key, newsletter_name
ORDER BY email_count DESC;
