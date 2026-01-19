# Onboarding Speed Dilemma & Solutions

## Current Problem

**Backfill Performance:**
- **56 emails took 1 minute 40 seconds** (~1.8 seconds per email)
- This is **unacceptable for onboarding** (target: 10-20 seconds total feedback)
- Even for established users, 1m40s is approaching the maximum acceptable time

**Root Causes:**
1. **Sequential Gmail API calls** - Fetching emails one at a time
2. **Full email parsing** - Using `simpleParser` to extract headers (even though we only need headers)
3. **Storage uploads** - Uploading full `.eml` files to Supabase storage
4. **Database writes** - Individual upserts per email

## Current Architecture

```
User clicks "Start Backfill"
  ↓
For each email (sequential):
  1. Fetch raw email from Gmail API (~200-500ms)
  2. Parse headers with simpleParser (~50-100ms)
  3. Extract sender_key, subject, etc. (~10ms)
  4. Upload .eml to storage (~100-200ms)
  5. Upsert to messages_raw (~50ms)
  ↓
Total: ~400-850ms per email × 56 = 22-48 seconds (but actual: 100 seconds)
```

**Bottlenecks:**
- Gmail API rate limits (sequential calls)
- Header parsing overhead (full email parsing for just headers)
- Storage uploads (full .eml files we may not need immediately)

## Target Performance

**Onboarding Goal:**
- **10-20 seconds** total for initial feedback
- User sees classified senders quickly
- Can iterate/refine immediately

**Established User Goal:**
- **< 2 minutes** for incremental backfill (2-day window)
- Background processing acceptable

## Potential Solutions

### Solution 1: Reduce Time Window (Quick Win)
**Change:** Use `newer_than:1d` instead of `newer_than:14d` for onboarding

**Pros:**
- Immediately reduces email count by ~14x
- Still captures most active senders
- Simple change (one line)

**Cons:**
- May miss slower-cadence newsletters (weekly/monthly)
- Less data for classification
- User might need to wait for more emails

**Impact:** 56 emails → ~4 emails (if 1 day) = **~7 seconds** backfill time

### Solution 2: Parallel Gmail API Calls
**Change:** Batch Gmail API calls (3-5 concurrent requests)

**Pros:**
- Reduces Gmail API wait time by 3-5x
- Still respects rate limits
- Significant speedup

**Cons:**
- More complex error handling
- Need to manage concurrency
- Rate limit risk if too aggressive

**Impact:** ~3-5x speedup = **~20-30 seconds** for 56 emails

### Solution 3: Skip Storage Upload During Backfill
**Change:** Don't upload `.eml` files during backfill, only store metadata

**Pros:**
- Eliminates storage upload overhead (~100-200ms per email)
- Can fetch full emails later if needed for classification
- Faster database writes

**Cons:**
- Lose ability to re-parse emails later
- Need to fetch from Gmail API again if body needed
- May need storage for LLM classification later

**Impact:** ~100-200ms saved per email = **~6-11 seconds** for 56 emails

### Solution 4: Lightweight Header Parsing
**Change:** Parse headers manually (regex) instead of full `simpleParser`

**Pros:**
- Much faster than full email parsing
- Only parse what we need (headers)
- No HTML/text extraction overhead

**Cons:**
- More brittle (regex parsing)
- May miss edge cases
- Need to handle encoding issues

**Impact:** ~50-100ms saved per email = **~3-6 seconds** for 56 emails

### Solution 5: Batch Database Writes
**Change:** Collect emails in memory, batch insert at end

**Pros:**
- Reduces database round trips
- Faster than individual upserts
- Better transaction handling

**Cons:**
- Memory usage for large batches
- All-or-nothing (if fails, lose all)
- More complex error handling

**Impact:** ~50ms saved per email = **~3 seconds** for 56 emails

### Solution 6: Two-Phase Backfill
**Change:** 
- Phase 1: Fast metadata extraction (headers only, no storage)
- Phase 2: Background storage upload (async, non-blocking)

**Pros:**
- User gets immediate feedback
- Storage happens in background
- Best of both worlds

**Cons:**
- More complex architecture
- Need background job system
- Storage may fail silently

**Impact:** **~5-10 seconds** for Phase 1, storage happens async

### Solution 7: Gmail API Batch Requests
**Change:** Use Gmail batch API to fetch multiple emails in one request

**Pros:**
- Single HTTP request for multiple emails
- Reduces network overhead
- Respects rate limits better

**Cons:**
- Gmail batch API has limits (100 requests per batch)
- More complex request building
- Error handling per item

**Impact:** **~5-10x speedup** = **~10-20 seconds** for 56 emails

## Recommended Approach

### For Onboarding (Immediate):
1. **Reduce to 1 day** (`newer_than:1d`) - Quick win, ~7 seconds
2. **Parallel Gmail calls** (3-5 concurrent) - ~3-5x speedup
3. **Skip storage upload** - Store metadata only, fetch later if needed

**Combined Impact:** ~7 seconds × (1/3-5) = **~2-3 seconds** for onboarding

### For Established Users:
1. Keep 2-day incremental window
2. Add parallel processing
3. Background storage uploads

**Combined Impact:** ~30-60 seconds for incremental backfill

## Implementation Priority

1. **Phase 1 (Quick Win):** Reduce to 1 day for onboarding
2. **Phase 2 (Speed):** Add parallel Gmail API calls
3. **Phase 3 (Optimize):** Skip storage upload during backfill
4. **Phase 4 (Advanced):** Lightweight header parsing

## Questions for Gemini

1. What's the optimal time window for onboarding? (1 day vs 3 days vs 7 days)
2. How many parallel Gmail API calls can we safely make?
3. Should we skip storage uploads entirely or defer them?
4. Is there a better way to extract headers without full email parsing?
5. What's the tradeoff between speed and data completeness for onboarding?

