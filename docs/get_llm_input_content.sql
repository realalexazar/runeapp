-- Simulate what gets sent to LLM (post-processing, pre-API call)
-- NOTE: This approximates the processing - actual HTML-to-text conversion and 
-- boilerplate stripping happen in code and can't be fully replicated in SQL

SELECT 
  id,
  newsletter_name,
  subject,
  received_at,
  -- Raw content (what processing starts with)
  CASE 
    WHEN text_content IS NOT NULL THEN text_content
    ELSE html_content
  END as raw_content_before_processing,
  LENGTH(COALESCE(text_content, html_content, '')) as raw_content_length,
  
  -- Processing simulation (based on morning-brief defaults):
  -- 1. HTML-to-text conversion: Can't replicate in SQL, but we show if HTML exists
  CASE 
    WHEN html_content IS NOT NULL AND text_content IS NULL THEN 'Would convert HTML to text'
    ELSE 'Text already available or no HTML'
  END as html_conversion_needed,
  
  -- 2. Boilerplate stripping: Can't replicate in SQL, but we show content length
  -- (Actual stripping happens in code - removes unsubscribe links, footers, etc.)
  
  -- 3. Dynamic truncation logic (morning-brief = 15k base, up to 30k for medium emails)
  CASE 
    WHEN LENGTH(COALESCE(text_content, html_content, '')) < 15000 THEN 
      'Full pass (< 15k chars)'
    WHEN LENGTH(COALESCE(text_content, html_content, '')) <= 30000 THEN 
      'Up to 30k allowed (15k-30k range)'
    ELSE 
      'Truncated to 15k (base limit for >30k)'
  END as truncation_strategy,
  
  -- Estimated truncation point
  CASE 
    WHEN LENGTH(COALESCE(text_content, html_content, '')) < 15000 THEN 
      LENGTH(COALESCE(text_content, html_content, ''))
    WHEN LENGTH(COALESCE(text_content, html_content, '')) <= 30000 THEN 
      30000
    ELSE 
      15000
  END as estimated_max_chars_sent,
  
  -- Preview of what would be sent (first N chars based on truncation logic)
  CASE 
    WHEN LENGTH(COALESCE(text_content, html_content, '')) < 15000 THEN 
      LEFT(COALESCE(text_content, html_content, ''), LENGTH(COALESCE(text_content, html_content, '')))
    WHEN LENGTH(COALESCE(text_content, html_content, '')) <= 30000 THEN 
      LEFT(COALESCE(text_content, html_content, ''), 30000)
    ELSE 
      LEFT(COALESCE(text_content, html_content, ''), 15000) || E'\n\n[... truncated for digest ...]'
  END as estimated_content_sent_to_llm,
  
  -- Links (sent to LLM)
  links,
  
  -- Generated summary (for comparison)
  content_summary,
  LENGTH(content_summary) as summary_length

FROM digest_items
WHERE digest_id IS NULL
  AND content_summary IS NOT NULL
ORDER BY received_at DESC;
