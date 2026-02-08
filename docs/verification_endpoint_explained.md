# Verification Endpoint Explained

## What It Does

`GET /api/digest/verify` checks if you have **all the data needed** to generate a digest.

## What It Checks

1. **Google Connection** ✅
   - Checks if you have emails in `messages_raw` table
   - Proxy check: if you have messages, you're connected

2. **Newsletter Selections** ✅
   - Counts how many newsletters you've selected (`user_newsletter_selections` where `selected = true`)
   - Needs at least 1 selected newsletter

3. **Digest Configuration** ✅
   - Checks if you have a row in `digest_configs` table
   - Returns your full config (cadence, times, timezone, style, rune_name)

4. **Email Messages** ✅
   - Counts total messages in `messages_raw` for your user
   - Needs at least 1 message (from backfill)

## What It Returns

```json
{
  "ok": true,
  "verification": {
    "user_id": "...",
    "user_email": "...",
    "has_google_connection": true,
    "has_newsletter_selections": true,
    "newsletter_count": 45,
    "has_digest_config": true,
    "digest_config": {
      "cadence": "twice-daily",
      "send_time": ["08:00", "20:00"],
      "timezone": "America/New_York",
      "style": "morning-brief",
      "rune_name": "My Rune"
    },
    "has_messages_raw": true,
    "messages_count": 394,
    "ready_for_digest": true,
    "missing_requirements": []
  },
  "summary": {
    "ready": true,
    "message": "✅ All requirements met! Ready to generate digests."
  }
}
```

## UI Component

`DigestStatusCard` automatically calls this endpoint and displays:
- ✅ Green card if ready
- ❌ Red card with missing requirements if not ready
- Shows your current config
- Shows counts (newsletters, messages)

---

## Where Verification Fits in the Flow

### Production Flow (Cron Job)
```
Cron runs every 15 min
  ↓
For each user with digest_config:
  1. Call GET /api/digest/verify
  2. If ready_for_digest = false → Skip, log issue
  3. If ready_for_digest = true → Generate digest
```

### New User Flow
```
User completes onboarding
  ↓
Config saved to digest_configs
  ↓
Next cron run (within 15 min):
  - Verifies readiness
  - If ready → Generates at scheduled time
  - If not ready → Waits until requirements met
```

### Dev/Testing Flow
```
Manual testing:
  1. Click "Check Status" button (calls verify endpoint)
  2. See if ready
  3. If ready → Click "Generate Test Digest"
  4. If not ready → Fix missing requirements
```

---

## Recommendation: Test Before Building Generator?

**My take:** Yes, do a quick SQL verification first. Here's why:

### Quick SQL Test (2 min)
Run this to verify you have the data:

```sql
-- Check you have selected newsletters
SELECT COUNT(*) as selected_count 
FROM user_newsletter_selections 
WHERE user_id = 'YOUR_USER_ID' AND selected = true;

-- Check you have messages for those newsletters
SELECT COUNT(*) as message_count
FROM messages_raw mr
INNER JOIN user_newsletter_selections uns 
  ON mr.sender_key = uns.sender_key
WHERE mr.user_id = 'YOUR_USER_ID' 
  AND uns.user_id = 'YOUR_USER_ID'
  AND uns.selected = true
  AND mr.received_at >= NOW() - INTERVAL '14 days';

-- Check your config
SELECT * FROM digest_configs WHERE user_id = 'YOUR_USER_ID';
```

If all 3 queries return data → You're ready to build the generator.

### Dev-Mode Manual Trigger Button

**Recommendation:** Add a "Generate Test Digest" button to the post-onboarding dashboard (dev mode only).

**Why:**
- Test without waiting for cron
- See results immediately
- Debug easier
- Can remove later for production

**Where:** Add it next to `DigestStatusCard` in the dashboard (only show if `process.env.NODE_ENV === 'development'`)

**What it does:** Calls `POST /api/digest/generate` (which we'll build next)

---

## Next Steps (Piecemeal)

1. **Now:** Run SQL verification queries above
2. **Next:** Add dev-mode "Generate Test Digest" button to dashboard
3. **Then:** Build `lib/digest/generator.ts` (core logic)
4. **Then:** Build `POST /api/digest/generate` endpoint
5. **Test:** Click button → See digest generated → Check email

This way you can test incrementally without waiting for cron timing.
