-- Quick verification script for backfill data
-- User ID: 0c8ed9ca-7734-4d48-8cf4-7fadb778b775

-- 1. Count total messages
SELECT 
  'messages_raw' as table_name,
  COUNT(*) as total_messages,
  COUNT(DISTINCT sender_key) as unique_senders,
  MIN(received_at) as oldest_message,
  MAX(received_at) as newest_message
FROM messages_raw 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';

-- 2. Sample of actual data (first 10 messages)
SELECT 
  sender_key,
  subject,
  from_name,
  from_email,
  received_at,
  headers_json->>'list_id' as list_id
FROM messages_raw 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
ORDER BY received_at DESC
LIMIT 10;

-- 3. Check for nulls (data quality check)
SELECT 
  COUNT(*) as total,
  COUNT(sender_key) as has_sender_key,
  COUNT(subject) as has_subject,
  COUNT(from_email) as has_from_email,
  COUNT(headers_json) as has_headers_json
FROM messages_raw 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';

-- 4. Top senders by message count
SELECT 
  sender_key,
  COUNT(*) as message_count,
  MAX(received_at) as latest_message
FROM messages_raw 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
GROUP BY sender_key
ORDER BY message_count DESC
LIMIT 10;
