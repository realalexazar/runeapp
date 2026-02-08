# Rune Feature Backlog & Tracking
## Master List of All Features, Ideas & Implementation Status

**Last Updated:** 2026-01-24

---

## Status Legend
- **[IMPLEMENTED]** - Feature is built and working
- **[IN PROGRESS]** - Currently being built
- **[PLANNED]** - Designed, ready to build
- **[IDEA]** - Brainstormed, needs design/decision
- **[FUTURE]** - Nice-to-have, lower priority

---

## CORE FEATURES (MVP)

### Onboarding & Classification
- **[IMPLEMENTED]** **Gmail OAuth Connection** - Connect Gmail account
- **[IMPLEMENTED]** **Email Backfill** - Fetch emails from Gmail (14d first run, 2d subsequent)
- **[IMPLEMENTED]** **Sender Classification** - 3-layer LLM-based classification system
- **[IMPLEMENTED]** **Newsletter Selection UI** - User selects which newsletters to follow
- **[PLANNED]** **Digest Configuration** - User sets cadence, time, style, timezone
- **[IDEA]** **Rune Naming** - User can name their digest (AI-suggested name after digest config)

### Digest Generation
- **[PLANNED]** **Digest Generation Engine** - Aggregate selected newsletters
- **[PLANNED]** **Gmail Full Body Fetching** - Fetch email bodies for summaries
- **[PLANNED]** **LLM Summary Generation** - Batch summarize newsletter content
- **[PLANNED]** **Style Formatting** - Apply user's selected style (Morning Brief/Deep Read/Reference Mode)
- **[PLANNED]** **Lookback Window Calculation** - Calculate date ranges based on cadence
- **[PLANNED]** **Summary Ordering** - Most recent first, then chronological

### Email Delivery
- **[PLANNED]** **Resend Integration** - Set up email sending service
- **[PLANNED]** **Email Templates** - React Email templates for digests
- **[PLANNED]** **Cron Scheduling** - Scheduled digest generation (every 15 min)
- **[PLANNED]** **Timezone Handling** - Convert user timezone to UTC for scheduling
- **[PLANNED]** **Deep Linking** - Email links to app/web

### App Interface
- **[PLANNED]** **Dashboard (Post-Onboarding)** - Upcoming digest, recent digests list
- **[PLANNED]** **Digest Detail View** - View individual digest
- **[PLANNED]** **Settings Page** - Edit preferences, manage newsletters
- **[PLANNED]** **Digest History** - View past digests (last 7 days)
- **[IDEA]** **Fluid Newsletter Dashboard** - See all newsletters, expand dynamically, smooth navigation
  - Dashboard shows all newsletters in digest
  - Tap to expand individual newsletters
  - Smooth animations, native feel
  - Manage 11+ newsletters fluidly
  - **Documentation:** `docs/in_app_experience_vision.md`

---

## DIGEST STYLES

### Core Styles (Onboarding)
- **[PLANNED]** **Morning Brief** - 1-sentence summary + top 3 subject lines
- **[PLANNED]** **Deep Read** - Full AI summary (4-6 sentences) + all subject lines
- **[PLANNED]** **Reference Mode** - Structured format (key points + topic-organized)

### Advanced Styles (Settings Only - Future)
- **[IDEA]** **Headlines Only** - Subject lines only, no summaries
- **[IDEA]** **Summary Focus** - AI summary only, subject lines minimized
- **[IDEA]** **Timeline View** - Chronological list with timestamps
- **[IDEA]** **Topic Clustered** - Articles grouped by topic/theme
- **[IDEA]** **Quote Heavy** - Key quotes extracted with context
- **[IDEA]** **Minimal Text** - Ultra-minimal format, maximum scannability

**Documentation:** `docs/digest_styles_brainstorm.md`

---

## PERIPHERY FEATURES

### Web Topic Scraping
- **[IDEA]** **Topic Management** - Users can add topics for web scraping
- **[IDEA]** **RSS Feed Integration** - Aggregate content from RSS feeds
- **[IDEA]** **News API Integration** - Pull content from news APIs
- **[IDEA]** **Custom Scraping** - Scrape specific websites
- **[IDEA]** **Topic Content in Digests** - Include web content in digests

### AI Enhancements
- **[IDEA]** **AI Synthesis Toggle** - Optional AI analysis per newsletter
- **[IDEA]** **Key Insights Extraction** - Extract key quotes/insights
- **[IDEA]** **Native LLM Querying** - Chat interface to query digests
- **[IDEA]** **AI-Suggested Rune Names** - Generate names after digest config based on selected newsletters/interests (UX gimmick)

### Advanced Features
- **[IDEA]** **Rich HTML Formatting** - Advanced email templates
- **[IDEA]** **Custom Sections** - User-defined organization
- **[IDEA]** **Mobile Deep Linking** - Seamless app experience from email
- **[IDEA]** **Analytics Tracking** - Open rates, click tracking
- **[IDEA]** **Digest Sharing** - Share digests with others
- **[IDEA]** **Export Digests** - Export as PDF, markdown, etc.
- **[IDEA]** **Important Image Extraction** - Extract and preserve charts/diagrams from newsletters (not decorative images)
  - Store image URLs and alt text
  - Display alongside summaries in digest UI
  - Future: Include alt text in LLM prompt for deep-read style

### Ongoing Monitoring
- **[IDEA]** **New Newsletter Detection** - Background job to detect new newsletters
- **[IDEA]** **Re-classification Pipeline** - Periodic updates to classifications
- **[IDEA]** **User Notifications** - "New newsletter detected" alerts
- **[IDEA]** **Auto-add to Grey** - New newsletters added to "Uncertain" section

---

## LEARNING & GAMIFICATION FEATURES

### Learning Programs
- **[IDEA]** **Daily Lessons** - Rune constructs learning programs on topics
- **[IDEA]** **Topic Selection** - Users select topics to learn (e.g., "Fed and monetary policy")
- **[IDEA]** **Timeline Selection** - Users set learning timeline
- **[IDEA]** **Progress Tracking** - Track learning progress in-app
- **[IDEA]** **Quizzes** - Optional quizzes to test knowledge

### Games & Quizzes
- **[IDEA]** **Daily Quizzes** - Quiz feature based on newsletter content
- **[IDEA]** **Progress Tracking** - Track quiz scores and progress
- **[IDEA]** **Achievements** - Gamification elements

**Note:** Mentioned in roadmap, needs more design work

---

## UI/UX FEATURES

### Design System
- **[IMPLEMENTED]** **Design System Documented** - Minimalistic sophistication style guide
- **[PLANNED]** **Component Library** - Reusable components matching design system
- **[PLANNED]** **Mobile App UI** - React Native interface matching web design

**Documentation:** `docs/design_system.md`

### Navigation & Flow
- **[PLANNED]** **Post-Onboarding Flow** - Complete user journey after onboarding
- **[PLANNED]** **Settings Navigation** - Settings page structure
- **[PLANNED]** **Digest Detail Navigation** - Previous/next digest controls
- **[PLANNED]** **Empty States** - Clean messaging for empty states

---

## TECHNICAL FEATURES

### Performance & Optimization
- **[IMPLEMENTED]** **Parallel Gmail API Calls** - `p-limit(75)` for metadata fetches
- **[IMPLEMENTED]** **Bulk Database Upserts** - Chunked parallel upserts (200 records, 10 concurrent)
- **[IMPLEMENTED]** **Metadata-Only Fetching** - Fast onboarding with `format: "metadata"`
- **[PLANNED]** **Full Body Fetching** - `p-limit(20)` for digest generation
- **[PLANNED]** **LLM Batch Processing** - Batch summaries for efficiency
- **[IDEA]** **Caching** - Cache summaries to avoid regeneration
- **[IDEA]** **Rate Limit Handling** - Queue system, exponential backoff

### Error Handling & Reliability
- **[IMPLEMENTED]** **OAuth Error Handling** - Robust error handling for Gmail connection
- **[PLANNED]** **Retry Logic** - Retry failed Gmail API calls
- **[PLANNED]** **Fallback Content** - Fallback to cached content if API fails
- **[PLANNED]** **User Notifications** - Notify users of failures
- **[IDEA]** **Error Recovery** - Automatic recovery from failures

### Database & Schema
- **[IMPLEMENTED]** **messages_raw** - Raw email metadata storage
- **[IMPLEMENTED]** **digest_candidates** - Classified senders
- **[IMPLEMENTED]** **user_newsletter_selections** - User newsletter selections
- **[PLANNED]** **digest_configs** - User digest preferences
- **[PLANNED]** **digests** - Generated digests
- **[PLANNED]** **digest_items** - Individual newsletter items in digests
- **[IDEA]** **user_topics** - User web topics
- **[IDEA]** **web_content** - Scraped web content

---

## MARKETING & DISTRIBUTION

### Landing & Onboarding
- **[IMPLEMENTED]** **Landing Page** - Basic landing page
- **[IMPLEMENTED]** **Dashboard (Testing)** - Testing dashboard for onboarding flow
- **[PLANNED]** **Production Dashboard** - Production-ready dashboard
- **[PLANNED]** **Onboarding Flow** - Complete user onboarding experience
- **[IDEA]** **Waitlist** - Collect emails for waitlist

### App Store
- **[IDEA]** **iOS App** - React Native app for App Store
- **[IDEA]** **App Store Optimization** - ASO for App Store
- **[IDEA]** **App Store Listing** - Screenshots, descriptions, etc.

### Marketing
- **[IDEA]** **Marketing Campaign** - Drive traffic to waitlist
- **[IDEA]** **Content Marketing** - Blog posts, articles
- **[IDEA]** **Social Media** - Twitter, LinkedIn presence
- **[IDEA]** **Product Hunt Launch** - Launch on Product Hunt

**Documentation:** `docs/complete_roadmap_10_modules.md`

---

## OPERATIONS & INFRASTRUCTURE

### Monitoring & Analytics
- **[PLANNED]** **Error Handling & Retry Logic** - Graceful failure handling for cron job
- **[PLANNED]** **Verification Failure Handling** - Skip users who aren't ready, log warnings
- **[PLANNED]** **Digest Status Tracking** - Track pending/generated/sent/failed statuses
- **[IDEA]** **Error Monitoring** - Sentry or similar
- **[IDEA]** **Performance Monitoring** - Track API performance
- **[IDEA]** **User Analytics** - Track user behavior
- **[IDEA]** **Digest Analytics** - Open rates, click rates
- **[IDEA]** **Failed Digest Dashboard** - View and retry failed digests

### Scaling
- **[IDEA]** **Queue System** - Queue digest generation for scale
- **[IDEA]** **Background Jobs** - Robust background job system
- **[IDEA]** **Database Optimization** - Indexes, query optimization
- **[IDEA]** **CDN** - Content delivery for static assets

---

## FEATURES BY PRIORITY

### Phase 1: MVP (Weeks 1-4)
1. Digest Configuration API
2. Digest Generation Engine
3. Email Delivery (Resend + Cron)
4. Basic App Interface (Dashboard, Digest View)

### Phase 2: Enhancement (Weeks 5-8)
1. Web Topic Scraping
2. AI Synthesis Toggle
3. Advanced Formatting
4. Mobile App (React Native)

### Phase 3: Scale (Weeks 9+)
1. Analytics & Monitoring
2. Advanced Styles (Settings)
3. Learning Programs
4. Games & Quizzes

---

## FEATURES BY STATUS

### [IMPLEMENTED]
- Gmail OAuth Connection
- Email Backfill (metadata-only, fast)
- Sender Classification (3-layer LLM system)
- Newsletter Selection UI
- Design System Documentation

### [IN PROGRESS]
- None currently

### [PLANNED] (Next)
- Digest Configuration API
- Digest Generation Engine
- Email Delivery System
- App Interface (Dashboard, Settings)

### [IDEA] (Future)
- All Periphery features
- Learning Programs
- Games & Quizzes
- Advanced Styles
- Web Topic Scraping

---

## DECISIONS & NOTES

### Design Decisions
- **[DECIDED]** **Use Case Based Styles** - Morning Brief, Deep Read, Reference Mode
- **[DECIDED]** **Minimalistic Design** - Dark theme, clean cards, sophisticated restraint
- **[DECIDED]** **Email Delivery First** - Build email before app interface
- **[DECIDED]** **15-Min Cron** - Run cron every 15 minutes for precise timing

### Technical Decisions
- **[DECIDED]** **Two-Phase Gmail API** - Metadata for onboarding, full bodies for digests
- **[DECIDED]** **Batch LLM Processing** - Batch summaries for efficiency
- **[DECIDED]** **Fixed Lookback Windows** - 12h/24h/48h/7d based on cadence
- **[DECIDED]** **10-Min Generation Buffer** - Start generation 10 min before send time

### Open Questions
- Summary length for each style? (Morning Brief: 1 sentence, Deep Read: 4-6 sentences, Reference: structured)
- When to add advanced styles? (After core 3 validated)
- Learning programs priority? (Lower priority, focus on core first)

---

## RELATED DOCUMENTS

- **Design System:** `docs/design_system.md`
- **Digest Styles:** `docs/digest_styles_brainstorm.md`
- **Technical Notes:** `docs/digest_generation_technical_notes.md`
- **System Blueprint:** `docs/digest_system_blueprint.md`
- **Complete Roadmap:** `docs/complete_roadmap_10_modules.md`
- **In-App Experience Vision:** `docs/in_app_experience_vision.md`
- **LLM Email Structure Prompt:** `docs/llm_email_structure_prompt.md`

---

## HOW TO USE THIS DOCUMENT

1. **Add New Features:** Add to appropriate section with status
2. **Update Status:** Change status as features progress
3. **Track Decisions:** Add to "Decisions & Notes" section
4. **Reference:** Use as single source of truth for all features

**Remember:** This is a living document - update it as we build and brainstorm!
