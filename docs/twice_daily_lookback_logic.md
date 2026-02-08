# Twice-Daily Lookback Window Logic

## Problem Statement

For `twice-daily` cadence, the lookback window should be **dynamic** based on the time difference between the two send times, not a fixed 12 hours.

## Examples

### Example 1: Standard 12-Hour Split
**User Config:**
- Morning: 8:00 AM
- Evening: 8:00 PM

**Morning Digest (generated at 7:50 AM):**
- Lookback window: From 8:00 PM previous day to 7:50 AM
- Window duration: ~12 hours

**Evening Digest (generated at 7:50 PM):**
- Lookback window: From 8:00 AM same day to 7:50 PM
- Window duration: ~12 hours

### Example 2: Uneven Split
**User Config:**
- Morning: 10:00 AM
- Evening: 2:00 PM

**Morning Digest (generated at 9:50 AM):**
- Lookback window: From 2:00 PM previous day to 9:50 AM
- Window duration: ~20 hours

**Evening Digest (generated at 1:50 PM):**
- Lookback window: From 10:00 AM same day to 1:50 PM
- Window duration: ~4 hours

### Example 3: Very Uneven Split
**User Config:**
- Morning: 6:00 AM
- Evening: 10:00 PM

**Morning Digest (generated at 5:50 AM):**
- Lookback window: From 10:00 PM previous day to 5:50 AM
- Window duration: ~8 hours

**Evening Digest (generated at 9:50 PM):**
- Lookback window: From 6:00 AM same day to 9:50 PM
- Window duration: ~16 hours

## Implementation Logic

```typescript
function calculateTwiceDailyLookbackWindow(
  sendTime: Date, // Current send time (morning or evening)
  morningTime: Date, // User's morning send time
  eveningTime: Date, // User's evening send time
  generationBuffer: number = 10 * 60 * 1000 // 10 minutes
): { start: Date; end: Date } {
  const generationTime = new Date(sendTime.getTime() - generationBuffer)
  
  // Determine if this is morning or evening digest
  const sendHour = sendTime.getHours()
  const morningHour = morningTime.getHours()
  const eveningHour = eveningTime.getHours()
  
  // Normalize times to same day for comparison
  const today = new Date(sendTime)
  today.setHours(0, 0, 0, 0)
  
  const morningToday = new Date(today)
  morningToday.setHours(morningHour, morningTime.getMinutes(), 0, 0)
  
  const eveningToday = new Date(today)
  eveningToday.setHours(eveningHour, eveningTime.getMinutes(), 0, 0)
  
  let startTime: Date
  
  // Determine which digest this is based on which send time is closer
  const timeToMorning = Math.abs(sendTime.getTime() - morningToday.getTime())
  const timeToEvening = Math.abs(sendTime.getTime() - eveningToday.getTime())
  
  if (timeToMorning < timeToEvening) {
    // This is the MORNING digest
    // Look back from morning time to previous evening time
    const previousEvening = new Date(eveningToday)
    previousEvening.setDate(previousEvening.getDate() - 1)
    startTime = previousEvening
  } else {
    // This is the EVENING digest
    // Look back from evening time to same-day morning time
    startTime = morningToday
  }
  
  return {
    start: startTime,
    end: generationTime
  }
}
```

## Alternative: Simpler Approach

```typescript
function calculateTwiceDailyLookbackWindow(
  currentSendTime: Date, // Which send time triggered this (morning or evening)
  morningTime: string, // "08:00" format
  eveningTime: string, // "20:00" format
  generationBuffer: number = 10 * 60 * 1000
): { start: Date; end: Date } {
  const generationTime = new Date(currentSendTime.getTime() - generationBuffer)
  
  // Parse times
  const [morningHour, morningMin] = morningTime.split(':').map(Number)
  const [eveningHour, eveningMin] = eveningTime.split(':').map(Number)
  
  // Create Date objects for today
  const today = new Date(currentSendTime)
  today.setHours(0, 0, 0, 0)
  
  const morningToday = new Date(today)
  morningToday.setHours(morningHour, morningMin, 0, 0)
  
  const eveningToday = new Date(today)
  eveningToday.setHours(eveningHour, eveningMin, 0, 0)
  
  // Determine which digest this is
  const currentHour = currentSendTime.getHours()
  const currentMin = currentSendTime.getMinutes()
  
  // Check if we're closer to morning or evening time
  const isMorningDigest = 
    (currentHour < morningHour) || 
    (currentHour === morningHour && currentMin < morningMin) ||
    (currentHour > eveningHour) ||
    (currentHour === eveningHour && currentMin > eveningMin)
  
  let startTime: Date
  
  if (isMorningDigest) {
    // Morning digest: look back to previous evening
    const previousEvening = new Date(eveningToday)
    previousEvening.setDate(previousEvening.getDate() - 1)
    startTime = previousEvening
  } else {
    // Evening digest: look back to same-day morning
    startTime = morningToday
  }
  
  return {
    start: startTime,
    end: generationTime
  }
}
```

## Key Rules

1. **Morning Digest:**
   - Start: Previous evening send time
   - End: Current generation time (10 min before morning send time)
   - Window: Time between evening and morning (can be 4-20 hours depending on times)

2. **Evening Digest:**
   - Start: Same-day morning send time
   - End: Current generation time (10 min before evening send time)
   - Window: Time between morning and evening (can be 4-20 hours depending on times)

3. **Edge Cases:**
   - If times are very close (< 1 hour apart): Still use the time difference
   - If times span midnight: Handle date rollover correctly
   - If user changes times: Recalculate window for next digest

## Database Query

```sql
-- For morning digest
SELECT * FROM messages_raw
WHERE user_id = $1
  AND sender_key IN (SELECT sender_key FROM user_newsletter_selections WHERE selected = true)
  AND received_at >= $2 -- Previous evening time
  AND received_at < $3  -- Generation time (10 min before morning)
ORDER BY received_at DESC

-- For evening digest
SELECT * FROM messages_raw
WHERE user_id = $1
  AND sender_key IN (SELECT sender_key FROM user_newsletter_selections WHERE selected = true)
  AND received_at >= $2 -- Same-day morning time
  AND received_at < $3  -- Generation time (10 min before evening)
ORDER BY received_at DESC
```

## Implementation Notes

- This logic should be implemented in `lib/digest/utils.ts` or similar
- The cron job needs to know which send time triggered the digest (morning vs evening)
- Store both times in `digest_configs.send_time` as an array: `['08:00', '20:00']`
- When generating, pass both times to the lookback calculation function
