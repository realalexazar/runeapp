# Testing Guide - New Domain-Based LLM Classification System

## Pre-Testing Checklist

✅ **Schema Migration**: Run `docs/migration_add_columns.sql` in Supabase (if not already done)
✅ **Environment Variables**: Set LLM API keys in `.env.local`:
   ```
   OPENAI_API_KEY=your_key_here
   # OR
   ANTHROPIC_API_KEY=your_key_here
   LLM_PROVIDER=openai  # or "anthropic"
   ```

## Step 1: Clear Test Data

Run this SQL in Supabase to start fresh:

```sql
-- Clear all test data (replace YOUR_USER_ID with your actual user_id)
DELETE FROM digest_candidates WHERE user_id = 'YOUR_USER_ID';
DELETE FROM messages_raw WHERE user_id = 'YOUR_USER_ID';
DELETE FROM messages_clean WHERE user_id = 'YOUR_USER_ID';
DELETE FROM sender_profiles WHERE user_id = 'YOUR_USER_ID';
```

## Step 2: Test Backfill

1. Go to Dashboard UI
2. Click **"Start Backfill"** button
3. Wait for completion (should be faster now - ~30 seconds for 1000 messages)
4. Verify in Supabase:
   ```sql
   -- Check that headers were extracted
   SELECT 
     sender_key, 
     subject, 
     from_name, 
     from_email,
     headers_json
   FROM messages_raw 
   WHERE user_id = 'YOUR_USER_ID' 
   LIMIT 10;
   
   -- Should show populated sender_key, subject, etc.
   ```

## Step 3: Test Classification

1. In Dashboard UI, click **"Classify Senders"** button
2. Wait for completion (~10-20 seconds for ~100 senders)
3. Verify results:
   ```sql
   -- Check classification results
   SELECT 
     sender_key,
     bucket,
     classifier_source,
     sample_size,
     msgs_14d,
     low_confidence
   FROM digest_candidates 
   WHERE user_id = 'YOUR_USER_ID' 
   ORDER BY updated_at DESC;
   
   -- Should show:
   -- - bucket: 'positive', 'grey', or 'low'
   -- - classifier_source: 'llm' or 'rule' (for hard-rule filtered)
   -- - sample_size: number of subjects sampled
   -- - msgs_14d: message count
   ```

## Step 4: Verify Results

### Check Bucket Distribution:
```sql
SELECT 
  bucket, 
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE classifier_source = 'llm') as llm_count,
  COUNT(*) FILTER (WHERE classifier_source = 'rule') as rule_count
FROM digest_candidates 
WHERE user_id = 'YOUR_USER_ID'
GROUP BY bucket;
```

### Check Hard Rules Filtering:
```sql
-- Should see some senders marked as 'rule' (hard-rule filtered)
SELECT 
  sender_key,
  bucket,
  classifier_source
FROM digest_candidates 
WHERE user_id = 'YOUR_USER_ID' 
  AND classifier_source = 'rule'
LIMIT 10;
```

### Sample Some Classifications:
```sql
-- See what got classified as positive (newsletters)
SELECT 
  sender_key,
  bucket,
  msgs_14d,
  sample_size
FROM digest_candidates 
WHERE user_id = 'YOUR_USER_ID' 
  AND bucket = 'positive'
ORDER BY msgs_14d DESC
LIMIT 20;
```

## Expected Results

### Backfill:
- ✅ `messages_raw` populated with `sender_key`, `subject`, `from_name`, `from_email`, `headers_json`
- ✅ Fast (30 seconds for ~1000 messages)
- ✅ No errors

### Classification:
- ✅ `digest_candidates` populated with sender-level classifications
- ✅ Mix of `positive`, `grey`, `low` buckets
- ✅ Some senders marked `classifier_source = 'rule'` (hard-rule filtered)
- ✅ Most senders marked `classifier_source = 'llm'`
- ✅ Fast (10-20 seconds for ~100 senders)

## Troubleshooting

### Backfill Issues:
- **No sender_key populated**: Check if header parsing is working
- **Slow backfill**: Check Gmail API rate limits
- **Auth errors**: Reconnect Gmail account

### Classification Issues:
- **503 error**: Check if LLM API keys are set
- **All 'grey' results**: LLM might be failing, check API keys and logs
- **No 'rule' filtered**: Hard rules might be too strict, check subjects

### LLM Issues:
- **API errors**: Check API keys in `.env.local`
- **Rate limits**: Add delays between calls if needed
- **Parsing errors**: Check LLM response format in logs

## Success Criteria

✅ Backfill completes in < 1 minute for 1000 messages
✅ Classification completes in < 30 seconds for 100 senders
✅ Results stored in `digest_candidates` with correct buckets
✅ Mix of LLM and rule-based classifications
✅ No errors in console/logs

## Next Steps After Testing

1. Review classification results
2. Adjust hard rules if needed (`lib/onboard/hard-rules.ts`)
3. Tune LLM prompt if needed (`lib/onboard/llm-batch.ts`)
4. Update UI to display results from `digest_candidates`

