# Digest Generation: Technical Architecture & Recommendations

## Clarifications Answered

### 1. Email Content Strategy ✅
**Question:** Why would we have full newsletter content in the email?
**Answer:** We don't store full content during onboarding. We:
- **Onboarding:** Fetch metadata only (headers) → Fast classification
- **Digest Generation:** Fetch full bodies → Generate summaries → Include summaries in digest

**Summary generation is core** - all digests include LLM-generated summaries, not optional.

---

## Technical Architecture: Digest Generation Flow

### Current State (Onboarding)
```
User signs up
  ↓
Backfill: Fetch metadata (format: "metadata")
  ↓
Store: messages_raw (sender_key, subject, from_name, etc.)
  ↓
Classify: LLM classification based on subjects
  ↓
Store: digest_candidates + user_newsletter_selections
```

### Digest Generation Flow (New)
```
Cron runs (every 15 min)
  ↓
For each user with digest due:
  1. Get selected newsletters (user_newsletter_selections WHERE selected = true)
  2. Calculate lookback window (12h/24h/48h/7d based on cadence)
  3. Query messages_raw for message IDs:
     - sender_key IN (selected newsletters)
     - received_at within lookback window
  4. **FETCH FULL EMAIL BODIES** from Gmail API:
     - Use provider_message_id from messages_raw
     - Format: "full" (gets HTML/text body)
     - Parse content from payload
  5. **GENERATE SUMMARIES** (LLM batch):
     - Batch summarize all newsletter content
     - Store in digest_items.content_summary
  6. Format digest based on user's style preference
  7. Store in digests + digest_items tables
  8. Send email via Resend
```

---

## Technical Recommendations

### 1. Gmail API: Full Body Fetching

**Performance Considerations:**
- Full body fetches are **~5-10x slower** than metadata (larger payloads)
- Use `p-limit(20)` for concurrency (vs 75 for metadata)
- Batch by sender to reduce API calls
- Cache summaries if digest regeneration needed

**Implementation:**
```typescript
// lib/digest/gmail-fetcher.ts
export async function fetchEmailBodies(
  messageIds: string[],
  gmail: gmail_v1.Gmail
): Promise<EmailContent[]> {
  const limit = pLimit(20) // Conservative for full body fetches
  
  const tasks = messageIds.map(id =>
    limit(async () => {
      const res = await gmail.users.messages.get({
        userId: "me",
        id: id,
        format: "full" // Get full email body
      })
      
      // Parse HTML/text from payload
      const html = extractHtmlFromPayload(res.data.payload)
      const text = extractTextFromPayload(res.data.payload)
      
      return { messageId: id, html, text }
    })
  )
  
  return Promise.all(tasks)
}
```

**Parsing Email Bodies:**
- Use `mailparser` or similar to extract HTML/text from MIME payload
- Handle multipart emails (HTML + text alternatives)
- Extract links for "View Original" functionality

### 2. LLM Summary Generation

**Approach:** Batch summaries (similar to classification)
```typescript
// lib/digest/summarizer.ts
export async function summarizeNewsletters(
  newsletters: Array<{ sender_key: string; content: string }>
): Promise<Array<{ sender_key: string; summary: string }>> {
  // Batch up to 20 newsletters per LLM call
  // Prompt: "Summarize this newsletter content in 2-3 sentences..."
  // Store in digest_items.content_summary
}
```

**Cost Optimization:**
- Batch multiple newsletters per API call
- Cache summaries (don't regenerate if content unchanged)
- Use `gpt-4o-mini` for cost efficiency
- Truncate content if newsletter is extremely long (>10k tokens)

### 3. Cron Scheduling

**What is Cron?**
- **Cron** = Scheduled background job system (like a timer)
- Runs code automatically at set intervals (e.g., every 15 minutes)
- Vercel Cron: Scheduled API route that runs on a schedule
- Example: `/api/cron/generate-digests` runs every 15 min automatically

**How It Works:**
1. **Every 15 minutes:** Cron triggers `/api/cron/generate-digests`
2. **Query DB:** Fetch all users with `digest_configs` (lightweight query)
3. **Check each user:** Is their `send_time` within 15 min window?
4. **Only process matches:** Generate digests ONLY for users who need it
5. **Skip everyone else:** No work done for users not due

**Example Flow:**
```
7:45 AM: Cron runs → Checks DB → No users match → Done (0.1 seconds)
7:50 AM: Cron runs → Checks DB → User A needs 8:00 AM digest → Generate → Done (30 seconds)
8:00 AM: Cron runs → Checks DB → No users match → Done (0.1 seconds)
```

**Is It Expensive?**

**Cron Job Cost (Lightweight):**
- **Vercel Cron:** Free on Hobby plan, included in Pro ($20/mo)
- **Query cost:** ~$0.0001 per query (Supabase free tier: 500K queries/month)
- **Runtime:** Most runs take <1 second (just checking DB)
- **Total:** ~$0.01/month for checking every 15 min

**Actual Work Cost (Only When Needed):**
- **Gmail API calls:** Only for users who need digests (not every 15 min)
- **LLM calls:** Only when generating summaries (not every 15 min)
- **Example:** 100 users, 50 need daily digests → Only 50 digests/day, not 96 checks/day

**Efficiency:**
- **96 cron runs/day** (every 15 min) × **0.1 seconds** = ~10 seconds/day of runtime
- **Actual digest generation:** Only happens when users need it (maybe 50-200 times/day)
- **Cost:** Cron checks are essentially free; expensive work only happens when needed

**Recommendation:** Run every 15 minutes (not hourly)

**Why 15 minutes?**
- Supports "twice-daily" cadence (needs more granular timing)
- Ensures digests sent within 15 min of requested time
- More responsive to user schedule changes
- Balances responsiveness vs. server load
- **Cost is negligible** - most runs do nothing, just check DB

**Logic:**
```typescript
// app/api/cron/generate-digests/route.ts
export async function GET(req: Request) {
  // Verify cron secret (security)
  
  // 1. Lightweight query: Get all users with digest_configs
  const { data: users } = await supabase
    .from('digest_configs')
    .select('user_id, cadence, send_time, timezone')
  // This query is FAST (<100ms) - just reading configs
  
  const now = new Date()
  const usersToProcess: string[] = []
  
  // 2. Check each user (in-memory, no DB calls)
  for (const user of users) {
    const userNow = convertToUserTimezone(now, user.timezone)
    const sendTimes = user.send_time // Array for twice-daily
    
    for (const sendTime of sendTimes) {
      // Check if current time is within 15 min window BEFORE sendTime
      // If sendTime is 8:00 AM, check between 7:50 AM - 8:05 AM
      if (isWithinWindow(userNow, sendTime, 15)) {
        // Check cadence allows sending
        if (shouldSendToday(user.cadence, user.last_digest_at)) {
          usersToProcess.push(user.user_id) // Add to queue
        }
      }
    }
  }
  
  // 3. Only process users who need digests (expensive work)
  for (const userId of usersToProcess) {
    await generateAndSendDigest(userId) // This is where Gmail/LLM calls happen
  }
  
  return { processed: usersToProcess.length, total_users: users.length }
}
```

### 4. Lookback Window Calculation

**Fixed Windows (for non-twice-daily):**
- `daily` → 24 hours
- `every-other-day` → 48 hours
- `weekly` → 7 days

**Dynamic Windows (for twice-daily):**
- **Morning Digest:** Look back from morning time to **previous evening time**
- **Evening Digest:** Look back from evening time to **same-day morning time**
- **Window Duration:** Time difference between the two send times (not fixed 12 hours)

**Examples:**
- Morning 8 AM, Evening 8 PM → Both windows are ~12 hours
- Morning 10 AM, Evening 2 PM → Morning window ~20 hours, Evening window ~4 hours
- Morning 6 AM, Evening 10 PM → Morning window ~8 hours, Evening window ~16 hours

**Critical Timing Adjustment:**
- **Problem:** We start generation 10 min BEFORE send_time (e.g., 7:50 AM for 8:00 AM delivery)
- **Solution:** Lookback window must account for this 10 min gap
- **Example:** If user wants 8:00 AM daily digest:
  - Generation starts at 7:50 AM
  - Lookback window: 24 hours from 7:50 AM (not 8:00 AM)
  - Query: `received_at >= (7:50 AM - 24 hours)` AND `received_at < 7:50 AM`

**Implementation:**
```typescript
function calculateLookbackWindow(
  cadence: string,
  sendTime: Date, // Current send time triggering this digest
  sendTimes?: string[], // For twice-daily: ['08:00', '20:00']
  generationBuffer: number = 10 * 60 * 1000 // 10 minutes in ms
): { start: Date; end: Date } {
  const generationTime = new Date(sendTime.getTime() - generationBuffer)
  
  if (cadence === 'twice-daily' && sendTimes && sendTimes.length === 2) {
    // Dynamic window based on time difference
    return calculateTwiceDailyWindow(sendTime, sendTimes[0], sendTimes[1], generationBuffer)
  }
  
  // Fixed windows for other cadences
  const windows = {
    'daily': 24 * 60 * 60 * 1000,
    'every-other-day': 48 * 60 * 60 * 1000,
    'weekly': 7 * 24 * 60 * 60 * 1000
  }
  
  const windowMs = windows[cadence] || windows['daily']
  const startTime = new Date(generationTime.getTime() - windowMs)
  
  return {
    start: startTime,
    end: generationTime
  }
}

function calculateTwiceDailyWindow(
  currentSendTime: Date,
  morningTime: string, // "08:00"
  eveningTime: string, // "20:00"
  generationBuffer: number
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
  
  // Determine which digest this is (morning or evening)
  // Compare current time to both send times
  const currentHour = currentSendTime.getHours()
  const currentMin = currentSendTime.getMinutes()
  
  // Check if we're closer to morning or evening
  // If current time is before morning OR after evening, it's morning digest
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

**See `docs/twice_daily_lookback_logic.md` for detailed examples and edge cases.**

**Summary Ordering Logic:**
- **Most recent first:** Emails from today (if daily) appear at top
- **Then chronological:** Older emails within lookback window
- **Example (Daily 8 AM digest):**
  1. Emails from today (after midnight) → Top
  2. Emails from yesterday (within 24h window) → Below
  3. Grouped by sender_key (newsletter)

---

## Build Order: Email Delivery vs App Interface

### Recommendation: **Email Delivery First** ✅

**Rationale:**
1. **End-to-end testing** - Can test full flow without app
2. **Immediate user value** - Users get digests via email (universal)
3. **Simpler debugging** - Email delivery is easier to test/log
4. **Foundation for app** - App can consume same digest data

### How to Bridge Email ↔ App

**Shared Data Layer:**
```
┌─────────────────────────────────┐
│   Digest Generation Engine      │
│   (lib/digest/generator.ts)     │
└──────────────┬──────────────────┘
               │
               ├──→ Stores in DB
               │   (digests + digest_items)
               │
       ┌───────┴────────┐
       │                │
   ┌───▼───┐      ┌─────▼─────┐
   │ Email │      │   App     │
   │Delivery│      │ Interface │
   │(Resend)│      │  (React)  │
   └───────┘      └───────────┘
```

**Implementation:**
1. **Email Delivery** (Week 3):
   - Generate digest → Store in DB → Send email
   - Email includes "View in App" link (deep link)

2. **App Interface** (Week 4+):
   - `GET /api/digest/history` → Fetch past digests from DB
   - `GET /api/digest/latest` → Get most recent digest
   - Display same content as email, but with app UI
   - Native LLM querying (chat interface)

**Deep Linking Strategy:**
- Email link: `https://rune.app/digest/[digest_id]`
- App opens: `rune://digest/[digest_id]`
- Web fallback: Same URL works in browser

---

## Database Schema Updates

### digest_configs
```sql
CREATE TABLE digest_configs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  cadence text NOT NULL CHECK (cadence IN ('twice-daily', 'daily', 'every-other-day', 'weekly')),
  send_time time[], -- Array for twice-daily (e.g., ['08:00', '20:00'])
  timezone text NOT NULL DEFAULT 'UTC', -- e.g., 'America/New_York'
  style text NOT NULL CHECK (style IN ('morning-brief', 'deep-read', 'reference-mode')), -- Use case based styles
  rune_name text, -- User's custom name (PERIPHERY: AI-suggested)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### digests
```sql
CREATE TABLE digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  digest_date date NOT NULL, -- Date the digest covers
  generated_at timestamptz DEFAULT now(),
  sent_at timestamptz, -- When email was sent
  status text NOT NULL CHECK (status IN ('pending', 'generated', 'sent', 'failed')),
  html_content text, -- Full HTML digest
  text_content text, -- Plain text fallback
  metadata jsonb, -- Stats: newsletter_count, article_count, etc.
  UNIQUE(user_id, digest_date)
);
```

### digest_items
```sql
CREATE TABLE digest_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_id uuid NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  sender_key text NOT NULL,
  newsletter_name text,
  subject text,
  received_at timestamptz,
  content_summary text, -- LLM-generated summary (CORE)
  article_url text, -- Link to original (if available)
  order_index integer NOT NULL, -- Display order in digest
  created_at timestamptz DEFAULT now()
);
```

---

## Cost Analysis: Cron vs. Actual Work

### Cron Check Cost (Every 15 Minutes)
```
Runs per day: 96 (every 15 min)
Runtime per run: ~0.1-1 seconds (just DB query + checks)
Total runtime: ~10-96 seconds/day
Cost: ~$0.01/month (essentially free)
```

### Actual Digest Generation Cost (Only When Needed)
```
Example: 100 users, 50 need daily digests
Digests generated: 50/day (not 96/day)
Gmail API calls: 50 × ~10 emails = 500 calls/day
LLM calls: 50 × ~1 batch = 50 calls/day
Cost: ~$5-10/month (depends on LLM usage)
```

**Key Insight:** Cron checks are cheap; actual work (Gmail/LLM) only happens when needed.

### Cost Optimization Options

**If concerned about cron frequency:**
1. **Hourly cron** (instead of 15 min)
   - Pro: Fewer checks (24/day vs 96/day)
   - Con: Less precise timing (digests may be ±30 min late)
   - Cost savings: ~$0.005/month (negligible)

2. **Event-driven** (instead of cron)
   - Pro: Only runs when needed (0 checks when no users)
   - Con: More complex (need queue system, webhooks)
   - Cost savings: ~$0.01/month (negligible)

**Recommendation:** Keep 15 min cron - cost is negligible, better UX.

---

## Formatting Styles: Use Case Based ✅

### Style 1: **Morning Brief**
**Target:** Quick morning scan before work
- Newsletter name
- 1-sentence summary per newsletter
- Top 3 subject lines
- **Use case:** Morning coffee, quick check-in
- **Example:**
  ```
  The Morning Brew
  Markets up 2% on Fed news; tech stocks rally.
  • Fed Signals Rate Cuts Ahead
  • Tech Earnings Preview
  • Market Outlook: Bullish Signals
  ```

### Style 2: **Deep Read**
**Target:** Users who want comprehensive understanding
- Newsletter name
- Full AI summary (4-6 sentences)
- All subject lines with brief context
- **Use case:** Evening reading, deep understanding
- **Example:**
  ```
  The Morning Brew
  Today's newsletter covers the Federal Reserve's latest policy 
  announcement, which sent markets up 2% in early trading. Tech 
  stocks led the rally, with Apple and Microsoft both gaining over 
  3%. The newsletter analyzes Q4 earnings expectations, noting 
  strong signals from major tech companies. Market outlook remains 
  bullish for the coming week.
  
  Articles:
  • Fed Signals Rate Cuts Ahead - Analysis of policy implications
  • Tech Earnings Preview - What to watch this quarter
  • Market Outlook: Bullish Signals - Expert predictions
  ```

### Style 3: **Reference Mode**
**Target:** Users who want structured info for later review
- Newsletter name
- Summary in structured format (key points extracted)
- Subject lines organized by topic/theme
- **Use case:** Reference, later review, note-taking
- **Example:**
  ```
  The Morning Brew
  
  Key Points:
  • Markets: +2% on Fed policy news
  • Tech: Apple +3%, Microsoft +3%
  • Outlook: Bullish for Q4
  
  Articles by Topic:
  Policy: Fed Signals Rate Cuts Ahead
  Earnings: Tech Earnings Preview
  Analysis: Market Outlook: Bullish Signals
  ```

**Settings Configurability:**
- All styles changeable in Settings → Digest Preferences
- Preview available before saving
- Future: Advanced/niche styles available in Settings only (not onboarding)

**Future Styles (To Build Later):**
- Headlines Only (ultra-fast scan)
- Summary Focus (AI insights only)
- Timeline View (chronological)
- Topic Clustered (thematic grouping)
- Quote Heavy (key quotes extracted)
- Minimal Text (ultra-minimal format)

See `docs/digest_styles_brainstorm.md` for full details.

---

## Post-Onboarding UI Flow

### Current State (Onboarding Complete)
- User has selected newsletters (`user_newsletter_selections`)
- System has classified senders (`digest_candidates`)
- User ready to configure digest preferences

### Proposed Flow

#### Step 1: Digest Configuration Screen
**Screen:** "Set Up Your Rune"
- **Cadence Selection:**
  - Radio buttons: Twice Daily (recommended) / Daily / Every Other Day / Weekly
- **Time Selection:**
  - Time picker(s): If twice-daily, show two time pickers
  - Timezone: Auto-detect, allow override
- **Style Selection:**
  - Cards: Morning Brief / Deep Read / Reference Mode (with previews)
  - Each card shows example format
- **Rune Name (Optional):**
  - Text input: "Name your Rune" (placeholder: AI-suggested name)
  - Button: "Get AI suggestion" (PERIPHERY)
- **CTA:** "Start Receiving Digests"

#### Step 2: Confirmation Screen
**Screen:** "You're All Set!"
- Confirmation message: "Your first Rune will arrive at [time] on [date]"
- Preview: Show what digest will look like (mockup)
- **CTA:** "Go to Dashboard"

#### Step 3: Dashboard (Main App)
**Screen:** Home / Digest View
- **Upcoming Digest:**
  - Card: "Your next Rune arrives at [time]"
  - Countdown timer (optional)
- **Recent Digests:**
  - List: Past digests (last 7 days)
  - Each digest: Date, newsletter count, "View" button
- **Settings:**
  - Button: "Edit Preferences" (cadence, time, style)
  - Button: "Manage Newsletters" (add/remove newsletters)
  - Button: "Account Settings"

#### Step 4: Digest Detail View
**Screen:** Individual Digest View
- **Header:** Date, newsletter count, style indicator
- **Content:** Formatted digest (based on style preference)
- **Actions:**
  - "View Original" (link to Gmail)
  - "Share Digest"
  - "Query with AI" (PERIPHERY: chat interface)
- **Navigation:** Previous / Next digest buttons

#### Step 5: Settings / Preferences
**Screen:** Settings
- **Digest Preferences:**
  - Edit cadence, time, style (with preview)
  - Edit Rune name
  - **Advanced Styles** (PERIPHERY): Additional niche styles (Headlines Only, Summary Focus, Timeline View, etc.)
- **Newsletter Management:**
  - List of selected newsletters
  - Add new newsletter (manual entry)
  - Remove newsletter
- **Account:**
  - Email settings
  - Connected accounts (Gmail)
  - Delete account

### Navigation Structure
```
Dashboard (Home)
  ├── Digest Detail View
  │     └── Query with AI (PERIPHERY)
  ├── Settings
  │     ├── Digest Preferences
  │     ├── Newsletter Management
  │     └── Account Settings
  └── Help / Support
```

### Key UX Principles
1. **Progressive Disclosure:** Show essentials first, details on demand
2. **Clear Feedback:** Confirm actions, show status
3. **Flexibility:** Easy to change preferences
4. **Value First:** Show digest value immediately after onboarding

---

## Questions - RESOLVED

1. **Summary Length:** ✅ RESOLVED
   - **Morning Brief:** 1 sentence per newsletter
   - **Deep Read:** 4-6 sentences per newsletter
   - **Reference Mode:** Structured format (key points extracted)

2. **Error Handling:** ✅ RESOLVED
   - **Standard B2C SaaS Approach:**
     - **Retry Logic:** Exponential backoff (3 retries: 1s, 2s, 4s delays)
     - **Fallback:** Use cached/last-known content if API fails
     - **User Notification:** Email user if digest generation fails ("Your Rune couldn't be generated - we'll retry automatically")
     - **Logging:** Log all errors to monitoring service (Sentry)
     - **Graceful Degradation:** Partial digest if some newsletters fail (include what succeeded)
     - **Status Tracking:** Mark digest as "failed" in DB, allow manual retry

3. **Gmail API Quotas:** ✅ ASSESSED
   - **Gmail API Limits:**
     - **Daily Quota:** 1,000,000,000 units/day (1 billion) - default
     - **Per-User Rate Limit:** 250 units/user/second
     - **messages.get:** 1 unit per request (metadata or full)
     - **messages.list:** 5 units per request
   - **Our Usage Estimate:**
     - **Onboarding:** ~400 emails × 1 unit = 400 units (0.00004% of daily quota)
     - **Digest Generation:** ~10 emails/user × 1 unit = 10 units per digest
     - **100 users, daily digests:** 100 × 10 = 1,000 units/day (0.0001%)
     - **1,000 users, daily digests:** 1,000 × 10 = 10,000 units/day (0.001%)
     - **10,000 users, daily digests:** 10,000 × 10 = 100,000 units/day (0.01%)
     - **100,000 users, daily digests:** 100,000 × 10 = 1,000,000 units/day (0.1%)
   - **Assessment:** 
     - **Not a problem** - Even at 100k users, we're using 0.1% of daily quota
     - **Per-user rate limit:** 250 units/sec means we can handle 250 concurrent requests per user (way more than needed)
     - **Peak times:** Even if all users get digests at 8 AM, with `p-limit(20)` we're well under limits
     - **Recommendation:** 
       - **No action needed** until ~1M+ users
       - Monitor quota usage in Gmail API console
       - If needed later: Implement queue system for digest generation
       - Current `p-limit(20)` is conservative and safe

4. **Rune Naming:** ✅ RESOLVED
   - **Timing:** After digest config (not before)
   - **Purpose:** UX gimmick/fun feature, not critical
   - **Flow:** 
     1. User completes digest config (cadence, time, style)
     2. Show "Name your Rune" screen
     3. AI suggests name based on:
        - Selected newsletters (topics/themes)
        - User's name/email (if available)
        - Digest style preference
     4. User can accept suggestion or enter custom name
   - **Priority:** PERIPHERY feature (can be added later, after core digest functionality)
   - **Implementation:** Simple LLM call with prompt: "Suggest a fun, personalized name for a daily newsletter digest based on these newsletters: [list]"

---

## Implementation Priority

1. **Week 1:** Configuration API (digest_configs table + endpoints)
2. **Week 2:** Generation Engine (Gmail fetcher + LLM summarizer + generator)
3. **Week 3:** Email Delivery (Resend integration + cron job)
4. **Week 4+:** App Interface (digest history endpoints + React Native views)

**Start with email delivery, then build app interface on top of same data.**
