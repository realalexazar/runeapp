-- Quick Verification: Check if user has all data needed for digest generation
-- Replace YOUR_USER_ID with your actual user_id: 0c8ed9ca-7734-4d48-8cf4-7fadb778b775

-- 1. Check selected newsletters
SELECT 
  'Selected Newsletters' as check_type,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '❌' END as status
FROM user_newsletter_selections 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775' 
  AND selected = true;

-- 2. Check messages for selected newsletters (last 14 days)
SELECT 
  'Messages for Selected Newsletters (14d)' as check_type,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '❌' END as status
FROM messages_raw mr
INNER JOIN user_newsletter_selections uns 
  ON mr.sender_key = uns.sender_key
WHERE mr.user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND uns.user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND uns.selected = true
  AND mr.received_at >= NOW() - INTERVAL '14 days';

-- 3. Check digest configuration
SELECT 
  'Digest Configuration' as check_type,
  CASE WHEN EXISTS (
    SELECT 1 FROM digest_configs 
    WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  ) THEN 1 ELSE 0 END as count,
  CASE WHEN EXISTS (
    SELECT 1 FROM digest_configs 
    WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  ) THEN '✅' ELSE '❌' END as status;

-- 4. Show your digest config details
SELECT 
  cadence,
  send_time,
  timezone,
  style,
  rune_name,
  created_at
FROM digest_configs 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';

-- 5. Show selected newsletters with message counts
SELECT 
  uns.sender_key,
  MAX(mr.from_name) as newsletter_name, -- Get most common from_name
  COUNT(mr.id) as message_count_14d
FROM user_newsletter_selections uns
LEFT JOIN messages_raw mr 
  ON uns.user_id = mr.user_id 
  AND uns.sender_key = mr.sender_key
  AND mr.received_at >= NOW() - INTERVAL '14 days'
WHERE uns.user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
  AND uns.selected = true
GROUP BY uns.sender_key
ORDER BY message_count_14d DESC;
