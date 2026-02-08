-- View generated summaries for digest items
-- Shows newsletter, subject, and the generated summary

-- First, find your user_id (uncomment to run):
-- SELECT DISTINCT user_id FROM digest_items WHERE digest_id IS NULL AND content_summary IS NOT NULL;

-- Then use it below, or remove the user_id filter to see all summaries:

SELECT 
  newsletter_name,
  subject,
  received_at,
  content_summary,
  LENGTH(content_summary) as summary_length,
  -- Check if summary follows headline + bullets format
  CASE 
    WHEN content_summary LIKE 'Headline:%' THEN 'Has headline format'
    WHEN content_summary LIKE '%•%' THEN 'Has bullets'
    ELSE 'Other format'
  END as format_check
FROM digest_items
-- Remove user_id filter if auth.uid() isn't working - just see all items
-- WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
WHERE digest_id IS NULL
  AND content_summary IS NOT NULL
ORDER BY received_at DESC;
