-- Inspect raw email content vs what gets sent to LLM
-- This helps identify if specifics are being lost due to truncation

-- Replace with your user_id or use auth.uid() if running as authenticated user
-- Example user_id: '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'

-- 1. Show full email content with truncation analysis
SELECT 
  newsletter_name,
  subject,
  -- Full content lengths
  LENGTH(COALESCE(text_content, html_content, '')) as full_content_length,
  LENGTH(text_content) as text_length,
  LENGTH(html_content) as html_length,
  -- What would be truncated to (morning-brief = 10k chars)
  CASE 
    WHEN LENGTH(COALESCE(text_content, html_content, '')) > 10000 
    THEN 'TRUNCATED (would cut at 10k)'
    ELSE 'FULL CONTENT'
  END as truncation_status,
  -- Preview of content (first 500 chars)
  LEFT(COALESCE(text_content, html_content, ''), 500) as content_preview,
  -- Generated summary
  content_summary,
  LENGTH(content_summary) as summary_length
FROM digest_items
WHERE user_id = auth.uid() -- Or replace with your user_id
  AND digest_id IS NULL
ORDER BY received_at DESC
LIMIT 5;

-- 2. Check if specific numbers/percentages exist in content but not in summary
-- This helps identify if specifics are present but not extracted
SELECT 
  newsletter_name,
  subject,
  -- Check for common patterns that indicate specifics
  CASE 
    WHEN COALESCE(text_content, html_content, '') ~ '\d+%' THEN 'Has percentages'
    WHEN COALESCE(text_content, html_content, '') ~ '\$\d+' THEN 'Has dollar amounts'
    WHEN COALESCE(text_content, html_content, '') ~ '\d+\.\d+%' THEN 'Has decimal percentages'
    ELSE 'No obvious numbers'
  END as has_numbers,
  -- Check if summary mentions numbers
  CASE 
    WHEN content_summary ~ '\d+%' THEN 'Summary has percentages'
    WHEN content_summary ~ '\$\d+' THEN 'Summary has dollar amounts'
    WHEN content_summary ~ '\d+\.\d+%' THEN 'Summary has decimal percentages'
    ELSE 'Summary has no numbers'
  END as summary_has_numbers,
  content_summary
FROM digest_items
WHERE user_id = auth.uid() -- Or replace with your user_id
  AND digest_id IS NULL
  AND content_summary IS NOT NULL
ORDER BY received_at DESC;

-- 3. Show full content for a specific email (replace subject with one you want to inspect)
SELECT 
  newsletter_name,
  subject,
  received_at,
  -- Full text content
  text_content,
  -- Full HTML content (if text_content is null)
  html_content,
  -- Generated summary
  content_summary,
  -- Links extracted
  links
FROM digest_items
WHERE user_id = auth.uid() -- Or replace with your user_id
  AND digest_id IS NULL
  -- Uncomment and modify to inspect a specific email:
  -- AND subject = '5 Things to Know Before the Stock Market Opens'
ORDER BY received_at DESC
LIMIT 1;
