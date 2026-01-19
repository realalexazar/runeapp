# Endpoint Structure & Flow Explanation

## Current Endpoint Status

### ✅ ACTIVE Endpoints (Used by UI)

1. **`POST /api/backfill/start`** ✅ ACTIVE
   - **Status**: Enhanced with header extraction
   - **What it does**: 
     - Fetches emails from Gmail (last 14 days)
     - Stores raw `.eml` files in storage
     - **NEW**: Extracts headers and stores `sender_key`, `subject`, `from_name`, `from_email`, `headers_json` in `messages_raw`
   - **Called by**: UI button "Start Backfill"
   - **No redundancy**: This is the ONLY backfill endpoint

2. **`GET /api/backfill/progress`** ✅ ACTIVE
   - **Status**: Monitoring endpoint
   - **What it does**: Returns backfill progress stats
   - **Called by**: UI (for displaying progress)

3. **`GET /api/parse/progress`** ✅ ACTIVE
   - **Status**: Monitoring endpoint
   - **What it does**: Returns parse progress stats (raw count, clean count, etc.)
   - **Called by**: UI (for displaying stats)

### ❌ DISABLED Endpoints (Old System)

4. **`POST /api/parse/run`** ❌ DISABLED (returns 503)
   - **Status**: Disabled via feature flag (`ENABLE_OLD_PARSER`)
   - **What it used to do**: Old message-level classification system
   - **Why disabled**: Replaced by new sender-level LLM system
   - **Called by**: UI button "Parse Once" (will fail with 503)
   - **Redundancy**: YES - this is redundant with new system

5. **`POST /api/parse/re-enrich`** ❌ DISABLED (returns 503)
   - **Status**: Disabled via feature flag (`ENABLE_OLD_PARSER`)
   - **What it used to do**: Re-process existing `messages_clean` with updated rules
   - **Why disabled**: Part of old system
   - **Redundancy**: YES - this is redundant with new system

### 🆕 NEW Endpoint (Replacement)

6. **`POST /api/onboard/classify-senders`** 🆕 NEW
   - **Status**: Active (replaces old parse endpoints)
   - **What it does**: 
     - 3-layer classification system
     - Reads from `messages_raw` (no full email parsing needed)
     - Groups by `sender_key` (domain)
     - Applies hard rules filter
     - Batch LLM classification
     - Stores results in `digest_candidates`
   - **Called by**: Not yet integrated into UI (needs to be added)
   - **Redundancy**: NO - this replaces the old parse endpoints

## Current Flow (What Happens Now)

### When User Clicks "Start Backfill" in UI:

1. UI calls `POST /api/backfill/start`
2. Backfill fetches emails from Gmail
3. **NEW**: Extracts headers (`sender_key`, `subject`, etc.) during backfill
4. Stores in `messages_raw` with all metadata
5. Returns success

### When User Clicks "Parse Once" in UI:

1. UI calls `POST /api/parse/run`
2. **PROBLEM**: Returns 503 error (endpoint disabled)
3. User sees error message
4. **This is broken!** Need to update UI to call new endpoint instead

## Redundancy Analysis

### ✅ NO Redundancy:
- **Backfill**: Only one endpoint (`/api/backfill/start`)
- **Classification**: Only one active endpoint (`/api/onboard/classify-senders`)

### ⚠️ Redundancy Issues:

1. **Old Parse Endpoints Still Exist** (but disabled):
   - `/api/parse/run` - Disabled, returns 503
   - `/api/parse/re-enrich` - Disabled, returns 503
   - **Action**: Can be deleted later, or kept for historical reference

2. **UI Still Calls Old Parse Endpoint**:
   - `BackfillParseControls.tsx` calls `/api/parse/run`
   - This will fail with 503
   - **Action**: Update UI to call `/api/onboard/classify-senders` instead

## Recommended Actions

### Immediate:
1. ✅ **Backfill is working** - Enhanced with header extraction
2. ⚠️ **Update UI** - Change "Parse Once" button to call `/api/onboard/classify-senders`
3. ⚠️ **Remove or hide old parse button** - Or update it to call new endpoint

### Later (Cleanup):
1. Delete or archive old parse endpoints (`/api/parse/run`, `/api/parse/re-enrich`)
2. Remove old classification logic (Beacon v6.5 rules)
3. Clean up `messages_clean` table usage (if not needed)

## New Flow (After UI Update)

### Onboarding Flow:
1. User clicks "Start Backfill"
   → `POST /api/backfill/start` (extracts headers, stores in `messages_raw`)
2. User clicks "Classify Senders" (new button)
   → `POST /api/onboard/classify-senders` (reads from `messages_raw`, classifies, stores in `digest_candidates`)
3. UI displays results from `digest_candidates`

### No More:
- ❌ Full email body parsing during classification
- ❌ Message-level classification
- ❌ Complex rule-based scoring
- ❌ `messages_clean` table for onboarding

## Summary

**Current State:**
- ✅ Backfill: ONE endpoint, enhanced, working
- ❌ Parse: OLD endpoint disabled, UI still calls it (broken)
- 🆕 Classification: NEW endpoint exists, but UI doesn't call it yet

**Redundancy:**
- Old parse endpoints exist but are disabled (safe, but confusing)
- UI needs update to call new endpoint

**Next Step:**
- Update `BackfillParseControls.tsx` to call `/api/onboard/classify-senders` instead of `/api/parse/run`

