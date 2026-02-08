# Digest System Blueprint: Core-Periphery Architecture
## Prioritized Feature Tree & Implementation Strategy

---

## CORE vs PERIPHERY Model

### 🎯 CORE (MVP - Must Have)
**Goal:** Get a working digest system that delivers value immediately

1. **Digest Configuration** - User preferences (cadence, time, style)
2. **Digest Generation** - Aggregate selected newsletters from Gmail
3. **Email Delivery** - Send digest via email
4. **Basic Formatting** - Simple HTML/text digest

### ✨ PERIPHERY (Phase 2+ - Nice to Have)
**Goal:** Enhance experience, add differentiation

1. **Web Topic Scraping** - Perplexity-style web content
2. **AI Synthesis** - AI analysis paragraphs per newsletter
3. **Advanced Formatting** - Rich HTML, custom styles
4. **Mobile Deep Linking** - Seamless app experience
5. **Analytics** - Open rates, click tracking
6. **Digest History** - View past digests
7. **Custom Sections** - User-defined organization

---

## FEATURE TREE

```
Digest System
│
├── CORE: Configuration
│   ├── Save preferences (cadence, time, style, timezone)
│   ├── Calculate lookback windows
│   ├── Timezone conversion
│   └── Validation
│
├── CORE: Generation Engine
│   ├── Fetch newsletters (Gmail API)
│   ├── Filter by date range
│   ├── Aggregate by sender
│   ├── Basic formatting (concise/detailed/bullet-points)
│   └── Generate HTML/text
│
├── CORE: Email Delivery
│   ├── Resend integration
│   ├── Email templates
│   ├── Scheduled sending (cron)
│   └── Basic email content
│
├── PERIPHERY: Web Topics
│   ├── Topic sources (RSS, APIs)
│   ├── Scraping pipeline
│   ├── Content aggregation
│   └── Integration into digest
│
├── PERIPHERY: AI Enhancement
│   ├── AI synthesis per newsletter
│   ├── Summary generation
│   ├── Key insights extraction
│   └── Optional toggle
│
├── PERIPHERY: Advanced Features
│   ├── Rich HTML formatting
│   ├── Custom sections
│   ├── Mobile deep linking
│   ├── Analytics tracking
│   └── Digest history
│
└── PERIPHERY: Optimization
    ├── Caching
    ├── Performance optimization
    ├── Error handling
    └── Retry logic
```

---

## TECHNICAL ARCHITECTURE

### Database Schema

```sql
-- Digest Configuration
CREATE TABLE digest_configs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  cadence text NOT NULL CHECK (cadence IN ('twice-daily', 'daily', 'every-other-day', 'weekly')),
  send_time time[], -- Array for twice-daily (e.g., ['08:00', '20:00']), single element otherwise
  timezone text NOT NULL DEFAULT 'UTC', -- e.g., 'America/New_York'
  style text NOT NULL CHECK (style IN ('style1', 'style2', 'style3')), -- TBD: actual style names
  rune_name text, -- User's custom name for their digest (PERIPHERY: AI-suggested)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Generated Digests
CREATE TABLE digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  digest_date date NOT NULL, -- Date the digest covers (e.g., 2024-01-15)
  generated_at timestamptz DEFAULT now(),
  sent_at timestamptz, -- When email was sent
  status text NOT NULL CHECK (status IN ('pending', 'generated', 'sent', 'failed')),
  html_content text, -- Full HTML digest
  text_content text, -- Plain text fallback
  metadata jsonb, -- Stats: newsletter_count, article_count, etc.
  UNIQUE(user_id, digest_date)
);

-- Digest Items (individual newsletters/articles in digest)
CREATE TABLE digest_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_id uuid NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  sender_key text NOT NULL,
  newsletter_name text,
  subject text,
  received_at timestamptz,
  content_summary text, -- PERIPHERY: AI summary
  article_url text, -- Link to original (if available)
  order_index integer NOT NULL, -- Display order in digest
  created_at timestamptz DEFAULT now()
);

-- User Topics (for web scraping - PERIPHERY)
CREATE TABLE user_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  topic text NOT NULL, -- e.g., "Federal Reserve monetary policy"
  sources jsonb, -- RSS feeds, APIs, etc.
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, topic)
);

-- Web Content (scraped content - PERIPHERY)
CREATE TABLE web_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  topic_id uuid REFERENCES user_topics(id),
  title text NOT NULL,
  url text NOT NULL,
  summary text,
  scraped_at timestamptz DEFAULT now(),
  used_in_digest_id uuid REFERENCES digests(id),
  UNIQUE(user_id, url, scraped_at::date) -- One per day per URL
);
```

### API Endpoints

#### CORE Endpoints

```
POST /api/digest/config
  Body: { cadence, send_time, timezone, style }
  → Save/update user digest configuration

GET /api/digest/config
  → Get user's digest configuration

POST /api/digest/generate
  Body: { digest_date? } (optional, defaults to today)
  → Manually trigger digest generation (for testing)

GET /api/digest/history
  Query: { limit?, offset? }
  → Get past digests (PERIPHERY: but useful for testing)

GET /api/digest/preview
  Query: { digest_date? }
  → Preview digest before sending (for testing)
```

#### PERIPHERY Endpoints

```
POST /api/digest/topics
  Body: { topic, sources }
  → Add web topic for scraping

GET /api/digest/topics
  → Get user's topics

DELETE /api/digest/topics/:id
  → Remove topic
```

### Scheduled Jobs (Cron)

```typescript
// Vercel Cron or similar
// Runs every hour: /api/cron/generate-digests

1. Query all users with digest_configs
2. For each user:
   a. Calculate if digest should be sent now (based on cadence + send_time)
   b. Calculate lookback window (24h, 48h, 7d)
   c. Generate digest
   d. Send email
   e. Update digest status
```

---

## IMPLEMENTATION APPROACH

### Phase 1: CORE (Weeks 1-3)

#### Week 1: Configuration System
**Goal:** Users can set their digest preferences

**Tasks:**
1. Create `digest_configs` table migration
2. Build `POST /api/digest/config` endpoint
3. Build `GET /api/digest/config` endpoint
4. Add timezone handling utilities
5. Calculate lookback window logic
6. Basic validation

**Deliverable:** Users can save digest preferences

#### Week 2: Generation Engine (Basic)
**Goal:** Generate digest from selected newsletters

**Tasks:**
1. Create `digests` and `digest_items` tables
2. Build digest generation function:
   - Fetch selected newsletters from `messages_raw`
   - Filter by date range (lookback window)
   - Group by sender_key
   - Format based on style preference
3. Generate HTML/text content
4. Store in database
5. Build `POST /api/digest/generate` (manual trigger for testing)

**Deliverable:** Can generate digest from newsletters

#### Week 3: Email Delivery
**Goal:** Send digest via email

**Tasks:**
1. Set up Resend account
2. Create email template (React Email)
3. Build email sending function
4. Integrate with digest generation
5. Build cron job for scheduled sending
6. Error handling & retry logic

**Deliverable:** Digests sent automatically via email

### Phase 2: PERIPHERY (Weeks 4-8)

#### Week 4-5: Web Topic Scraping
**Goal:** Add web content to digests

**Tasks:**
1. Create `user_topics` and `web_content` tables
2. Build topic management API
3. Build scraping pipeline (RSS, APIs)
4. Integrate into digest generation
5. Format web content in digest

**Deliverable:** Web topics included in digests

#### Week 6-7: AI Enhancement
**Goal:** Add AI synthesis per newsletter

**Tasks:**
1. Build AI synthesis function (OpenAI)
2. Add toggle in digest config
3. Generate summaries per newsletter
4. Store in `digest_items.content_summary`
5. Include in email template

**Deliverable:** Optional AI analysis in digests

#### Week 8: Polish & Optimization
**Goal:** Improve UX and performance

**Tasks:**
1. Rich HTML formatting
2. Mobile deep linking
3. Analytics tracking
4. Digest history UI
5. Error handling improvements
6. Performance optimization

**Deliverable:** Production-ready digest system

---

## DETAILED IMPLEMENTATION: CORE FEATURES

### 1. Digest Configuration

**File:** `app/api/digest/config/route.ts`

```typescript
// POST /api/digest/config
export async function POST(req: Request) {
  // Validate: cadence, send_time, timezone, style
  // Calculate lookback window
  // Upsert into digest_configs
  // Return success
}

// GET /api/digest/config
export async function GET() {
  // Fetch user's config
  // Return config
}
```

**Key Logic:**
- Lookback window calculation:
  - `daily` → 24 hours
  - `every-other-day` → 48 hours
  - `weekly` → 7 days
- Timezone conversion: User's local time → UTC for cron scheduling

### 2. Digest Generation

**File:** `lib/digest/generator.ts`

```typescript
export async function generateDigest(
  user_id: string,
  digest_date: Date
): Promise<Digest> {
  // 1. Get user's digest_config
  // 2. Get selected newsletters (user_newsletter_selections)
  // 3. Calculate date range (lookback window)
  // 4. Fetch emails from messages_raw (by date range)
  // 5. Group by sender_key
  // 6. Format based on style:
  //    - concise: Subject + brief summary
  //    - detailed: Full content
  //    - bullet-points: Bulleted list
  // 7. Generate HTML/text
  // 8. Store in digests table
  // 9. Return digest
}
```

**Key Logic:**
- Fetch from `messages_raw` where:
  - `user_id` matches
  - `sender_key` in selected newsletters
  - `received_at` within lookback window
- Formatting:
  - **Concise:** Newsletter name + subject lines (top 3-5)
  - **Detailed:** Full newsletter content
  - **Bullet-points:** Bulleted list of articles

### 3. Email Delivery

**File:** `lib/digest/email.ts`

```typescript
import { Resend } from 'resend'
import { DigestEmailTemplate } from '@/components/emails/DigestEmail'

export async function sendDigestEmail(
  user_id: string,
  digest_id: string
): Promise<void> {
  // 1. Fetch digest from database
  // 2. Get user's email
  // 3. Render email template
  // 4. Send via Resend
  // 5. Update digest.sent_at
  // 6. Update digest.status = 'sent'
}
```

**Email Template Structure:**
```
┌─────────────────────────────┐
│ Your Daily Rune: [Date]      │
│                              │
│ [Newsletter 1]               │
│ - Article 1                  │
│ - Article 2                  │
│                              │
│ [Newsletter 2]               │
│ - Article 1                  │
│                              │
│ [Open in Rune App] button    │
└─────────────────────────────┘
```

### 4. Scheduled Sending (Cron)

**File:** `app/api/cron/generate-digests/route.ts`

```typescript
export async function GET(req: Request) {
  // Verify cron secret (security)
  // 1. Query all users with digest_configs
  // 2. For each user:
  //    a. Check if digest should be sent now
  //    b. Calculate lookback window
  //    c. Generate digest
  //    d. Send email
  // 3. Return summary
}
```

**Cron Schedule:** Every 15 minutes (Vercel Cron) - More frequent for "twice-daily" support

**Logic:**
- For each user with `digest_configs`:
  - Convert current UTC time to user's timezone
  - Check if `send_time` matches current time (±15 min window)
  - Check if cadence allows sending today:
    - `daily` → Send every day
    - `twice-daily` → Send at both configured times
    - `every-other-day` → Check if last digest was >24h ago
    - `weekly` → Check if last digest was >7 days ago
  - If conditions met → Generate digest → Send email
- **Timing buffer:** Start generation 5-10 minutes before send_time to ensure delivery on time

---

## PERIPHERY FEATURES (Future)

### Web Topic Scraping
- Use RSS feeds, news APIs (NewsAPI, RSS2JSON)
- Scrape content daily
- Store in `web_content` table
- Include in digest generation

### AI Synthesis
- Use OpenAI GPT-4 for summaries
- Generate per-newsletter analysis
- Optional toggle in config
- Store in `digest_items.content_summary`

### Advanced Formatting
- Rich HTML templates
- Custom CSS
- Responsive design
- Mobile-optimized

### Analytics
- Track email opens (Resend webhooks)
- Track clicks
- Store in `digest_analytics` table
- Dashboard for users

---

## FILE STRUCTURE

```
app/api/digest/
  ├── config/
  │   └── route.ts (GET, POST)
  ├── generate/
  │   └── route.ts (POST - manual trigger)
  ├── history/
  │   └── route.ts (GET)
  └── preview/
      └── route.ts (GET)

app/api/cron/
  └── generate-digests/
      └── route.ts (GET - scheduled)

lib/digest/
  ├── generator.ts (core generation logic)
  ├── email.ts (email sending)
  ├── formatter.ts (HTML/text formatting)
  └── utils.ts (lookback calculation, timezone)

components/emails/
  └── DigestEmail.tsx (React Email template)

docs/migrations/
  └── create_digest_tables.sql
```

---

## TESTING STRATEGY

### Manual Testing
1. Save digest config
2. Manually trigger generation (`POST /api/digest/generate`)
3. Preview digest (`GET /api/digest/preview`)
4. Verify email sent
5. Check email content

### Automated Testing
1. Unit tests for lookback calculation
2. Unit tests for formatting
3. Integration tests for generation
4. E2E tests for full flow

---

## ARCHITECTURAL DECISIONS (RESOLVED)

1. **Email Content:** ✅ **Summaries are core** - All digests include LLM-generated summaries
   - Not optional - summaries are the primary value proposition
   - Full content fetching happens at digest generation time (not during onboarding)

2. **Gmail API Strategy:** ✅ **Two-phase approach**
   - **Phase 1 (Onboarding):** Fetch metadata only (`format: "metadata"`) → Fast classification
   - **Phase 2 (Digest Generation):** Fetch full bodies (`format: "full"`) → Generate summaries
   - **Rationale:** Onboarding speed is critical; full content only needed when compiling digests

3. **Lookback Windows:** ✅ **Dynamic for twice-daily, fixed for others**
   - `twice-daily` → **Dynamic:** Morning looks back to previous evening, Evening looks back to same-day morning (window = time difference between send times)
   - `daily` → 24 hours  
   - `every-other-day` → 48 hours
   - `weekly` → 7 days
   - **See `docs/twice_daily_lookback_logic.md` for detailed logic**

4. **Formatting Styles:** ✅ **3 options**
   - Style 1: [TBD - need user input]
   - Style 2: [TBD - need user input]
   - Style 3: [TBD - need user input]

5. **Timezone:** ✅ **Store user timezone** - Required for accurate scheduling

6. **Rune Naming:** ✅ **AI-suggested names** - Based on user interests (PERIPHERY feature)

---

## NEXT STEPS

### Phase 1: CORE (Weeks 1-3)

**Week 1: Configuration API**
- Create `digest_configs` table migration
- Build `POST /api/digest/config` endpoint
- Build `GET /api/digest/config` endpoint
- Add timezone handling utilities
- Calculate lookback window logic

**Week 2: Generation Engine**
- Create `digests` and `digest_items` tables
- Build Gmail full-body fetcher (`lib/digest/gmail-fetcher.ts`)
- Build LLM summarizer (`lib/digest/summarizer.ts`)
- Build digest generator (`lib/digest/generator.ts`)
- Build `POST /api/digest/generate` (manual trigger for testing)

**Week 3: Email Delivery**
- Set up Resend account
- Create email template (React Email)
- Build email sending function
- Build cron job (`/api/cron/generate-digests`)
- Test end-to-end flow

### Phase 2: APP INTERFACE (Week 4+)

**Week 4: App Digest Views**
- Build `GET /api/digest/history` endpoint
- Build `GET /api/digest/latest` endpoint
- Create React Native digest view component
- Add deep linking support

**Week 5+: PERIPHERY Features**
- Native LLM querying (chat interface)
- Web topic scraping
- AI synthesis enhancements
- Analytics & tracking

**Start with CORE (Email Delivery), then build App Interface on top.**
