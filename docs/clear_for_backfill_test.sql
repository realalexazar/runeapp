-- Clear test data for fresh backfill test (2-day window)
-- For user: 0c8ed9ca-7734-4d48-8cf4-7fadb778b775
-- Run this in Supabase SQL Editor before testing the optimized backfill
-- This sets up for 2-day incremental window (faster test)

BEGIN;

-- Clear all user data
DELETE FROM digest_candidates WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';
DELETE FROM messages_raw WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';
DELETE FROM messages_clean WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';
DELETE FROM sender_profiles WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';

-- Reset backfill state (delete = 14-day window, keep = 2-day window)
-- Option 1: Delete to test 14-day full window (first run)
DELETE FROM system_state WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';

-- Option 2: Set to 3 days ago to test 2-day incremental window (uncomment if needed)
-- INSERT INTO system_state (user_id, last_backfill_at, key, value)
-- VALUES ('0c8ed9ca-7734-4d48-8cf4-7fadb778b775', NOW() - INTERVAL '3 days', 'default', '"backfill"')
-- ON CONFLICT (user_id) 
-- DO UPDATE SET last_backfill_at = NOW() - INTERVAL '3 days';

COMMIT;

-- Verify cleared
SELECT 
  'digest_candidates' as table_name, 
  COUNT(*) as count
FROM digest_candidates 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
UNION ALL
SELECT 
  'messages_raw', 
  COUNT(*)
FROM messages_raw 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
UNION ALL
SELECT 
  'messages_clean', 
  COUNT(*)
FROM messages_clean 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
UNION ALL
SELECT 
  'sender_profiles', 
  COUNT(*)
FROM sender_profiles 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775'
UNION ALL
SELECT 
  'system_state', 
  COUNT(*)
FROM system_state 
WHERE user_id = '0c8ed9ca-7734-4d48-8cf4-7fadb778b775';

-- All counts should be 0

