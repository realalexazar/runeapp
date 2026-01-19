# Implementation Plan: Sender-Level LLM Classification

## Phase 1: Clean Implementation & Testing

### Step 1: Disable Old Endpoints (Temporary)

Add feature flag to disable old parsing endpoints during testing:

**Option A: Early Return (Simplest)**
```typescript
// app/api/parse/run/route.ts
export async function POST(req: Request) {
  // TEMPORARY: Disable old parser during LLM testing
  return NextResponse.json({ 
    ok: false, 
    error: "Old parser disabled. Use /api/onboard/classify-senders instead." 
  }, { status: 503 })
}
```

**Option B: Environment Variable (Better)**
```typescript
// app/api/parse/run/route.ts
const ENABLE_OLD_PARSER = process.env.ENABLE_OLD_PARSER === 'true'

export async function POST(req: Request) {
  if (!ENABLE_OLD_PARSER) {
    return NextResponse.json({ 
      ok: false, 
      error: "Old parser disabled. Use /api/onboard/classify-senders instead." 
    }, { status: 503 })
  }
  // ... existing code
}
```

**Files to disable:**
- `app/api/parse/run/route.ts` → Return 503
- `app/api/parse/re-enrich/route.ts` → Return 503
- Keep `app/api/backfill/start/route.ts` (we need this!)
- Keep `app/api/parse/progress/route.ts` (for monitoring)

### Step 2: Create New Endpoint Structure

```
app/api/onboard/
  ├── classify-senders/
  │   └── route.ts  (NEW - main classification endpoint)
  └── sample-messages/
      └── route.ts  (NEW - helper to sample messages per sender)
```

### Step 3: Implementation Order

1. **Create `/api/onboard/sample-messages`** (test first)
   - Extract senders from `messages_raw`
   - Sample 1-3 messages per sender
   - Return sample data (test without LLM)

2. **Create `/api/onboard/classify-senders`** (main endpoint)
   - Call sample-messages internally
   - Batch LLM calls (50 concurrent)
   - Store results in `digest_candidates`
   - Return stats

3. **Test with small dataset**
   - Backfill 2 weeks → ~200-500 messages
   - Test classification on ~20-50 senders
   - Verify results in database

4. **Optimize backfill** (if still slow)
   - Add parallel Gmail API calls
   - Implement lazy body loading

### Step 4: Testing Workflow

```bash
# 1. Clear test data
DELETE FROM digest_candidates WHERE user_id='YOUR_USER_ID';
DELETE FROM messages_raw WHERE user_id='YOUR_USER_ID';

# 2. Backfill (should be faster with optimizations)
# UI: Click "Start Backfill"

# 3. Test sample-messages endpoint
curl -X POST http://localhost:3000/api/onboard/sample-messages \
  -H "Cookie: YOUR_SESSION_COOKIE"

# 4. Test classify-senders endpoint
curl -X POST http://localhost:3000/api/onboard/classify-senders \
  -H "Cookie: YOUR_SESSION_COOKIE"

# 5. Verify results
SELECT bucket, COUNT(*) FROM digest_candidates 
WHERE user_id='YOUR_USER_ID' GROUP BY bucket;
```

## Phase 2: Integration

1. Update UI to call new endpoint after backfill
2. Remove old parser UI buttons (or hide behind feature flag)
3. Monitor performance and accuracy
4. Iterate on prompt based on results

## Phase 3: Optimization

1. Optimize backfill speed (parallel calls, lazy loading)
2. Add caching for repeated classifications
3. Batch LLM calls more efficiently
4. Add retry logic for failed LLM calls

