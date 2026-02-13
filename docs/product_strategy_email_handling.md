# Product Strategy: Email Handling & Future Vision

**Last Updated:** 2026-01-30  
**Status:** MVP Complete - Strategic Planning Phase

---

## Executive Summary

Email summaries are the **beachhead feature** for a broader suite of intelligent content aggregation and learning tools. This document outlines our strategy for handling email format entropy, improving onboarding, and preparing for future product expansion.

---

## The Email Entropy Reality

### Current State
- **Email formats vary wildly:** Some newsletters are text-rich, others are link-heavy, visual flyers, or promotional emails
- **We handle this gracefully:** Sparse content protocol skips LLM for visual-only/link-only emails
- **User experience:** Fallback messages inform users when content can't be extracted

### Product Strategy
**We accept entropy as a reality** - not every email will be perfect. Our approach:
1. **Frontend validation** during onboarding to catch "bad" newsletter candidates early
2. **User feedback loop** to identify and recommend omitting noisy newsletters
3. **Transparent communication** when messy emails appear in digests

---

## Three Strategic Pillars

### 1. Onboarding Flow Enhancement: Catch Bad Newsletters Early

**Goal:** Use what we learned about email behavior during product development to improve onboarding

**Current Learning:**
- Visual flyers (CBRE internship) → Preprocessed content <100 chars → Skip LLM
- Link-heavy emails (Must Reads) → Can still extract content but noisy
- Large newsletters (Epoch Times 85k chars) → Work well after preprocessing fixes
- Promotional emails → Often sparse, better skipped

**Proposed Enhancements:**

#### A. Pre-classification Quality Scoring
During onboarding backfill, calculate a "content quality score" for each sender:
- **Metrics:**
  - Average preprocessed content length
  - Ratio of links to text
  - Presence of images vs text
  - Subject line consistency
- **Display:** Show quality indicators in newsletter selection UI
  - 🟢 High quality (text-rich, consistent)
  - 🟡 Medium quality (some noise, but extractable)
  - 🔴 Low quality (link-heavy, visual-only, promotional)

#### B. Smart Recommendations During Selection
- **Auto-deselect low-quality newsletters** with user confirmation:
  - "We detected that [Newsletter Name] appears to be mostly promotional links. Would you like to exclude it from your digest?"
- **Highlight high-quality newsletters:**
  - "These newsletters have rich content perfect for summaries: [list]"

#### C. Preview Sample Content
- Show sample preprocessed content for each newsletter during selection
- Let users see what will be summarized before committing

**Implementation Priority:** Medium (after MVP validation)

---

### 2. Newsletter Summaries as Beachhead Feature

**Vision:** Email summaries are just the beginning. Future features include:

#### Phase 2: Web Content Aggregation
- **Daily learning on topics:** User selects topics → Rune aggregates content daily
- **Perplexity-style web querying:** User queries → Real-time web search → Summarized results
- **RSS feed integration:** Aggregate from user's favorite blogs/news sites

#### Phase 3: Learning Programs
- **Structured learning paths:** "Learn about Fed monetary policy in 30 days"
- **Progress tracking:** Track learning milestones
- **Quizzes & gamification:** Test knowledge retention

#### Phase 4: Advanced Intelligence
- **Cross-source synthesis:** Combine email + web content for comprehensive views
- **Topic clustering:** Group related content across sources
- **Personalized recommendations:** AI suggests new topics based on reading patterns

**Architecture Consideration:** Build digest system to be extensible - it's not just emails, it's a content aggregation engine.

**Implementation Priority:** Future (after MVP validation)

---

### 3. User Communication: Handling Messy Emails

**Goal:** Be straightforward with users when messy emails appear in digests

**Current Behavior:**
- Sparse emails get fallback message: "This email contains minimal text content"
- User sees this in digest

**Proposed Enhancements:**

#### A. In-Digest Recommendations
When a messy email appears in digest, show:
```
⚠️ This newsletter appears to be mostly links/promotions.
   Consider removing it from your digest for cleaner summaries.
   [Remove from Digest] button
```

#### B. Digest Quality Report
After each digest, show:
- "Your digest included 8 newsletters"
- "1 newsletter had limited content (link-heavy)"
- "Recommendation: Remove [Newsletter Name] for better summaries"

#### C. Newsletter Management Dashboard
- **Quality indicators** for each newsletter:
  - Content richness score
  - Average summary quality
  - User satisfaction (if we add feedback)
- **One-click removal** for noisy newsletters
- **Re-add later** if newsletter format improves

**Implementation Priority:** High (quick win, improves UX immediately)

---

## Low-Hanging Fruit: Technical Improvements

### Quick Wins (1-2 hours each)

#### 1. **Newsletter Quality Scoring** ⭐ High Impact
**What:** Calculate content quality metrics during backfill/classification
**Why:** Enables smart recommendations in onboarding
**How:**
- Add `content_quality_score` column to `digest_candidates`
- Calculate during classification: avg content length, link ratio, image ratio
- Use in onboarding UI to highlight good/bad newsletters

**Code Location:** `lib/onboard/sender-extraction.ts` - Add quality scoring after classification

#### 2. **Digest Item Quality Indicators** ⭐ High Impact
**What:** Store quality metrics per digest item
**Why:** Enables in-digest recommendations and quality reports
**How:**
- Add `quality_score` to `digest_items` table
- Calculate during preprocessing: content length, link ratio
- Use in digest UI to show warnings/recommendations

**Code Location:** `app/api/digest/generate-summaries/route.ts` - Calculate during preprocessing

#### 3. **Newsletter Removal UI** ⭐ High Impact
**What:** One-click remove newsletter from digest
**Why:** Immediate user value, reduces noise
**How:**
- Add "Remove from Digest" button in digest view
- Update `user_newsletter_selections.selected = false`
- Show confirmation: "Removed. This newsletter won't appear in future digests."

**Code Location:** New endpoint `POST /api/digest/newsletters/:id/remove`

#### 4. **Preprocessed Content Preview** ⭐ Medium Impact
**What:** Show sample preprocessed content during onboarding
**Why:** Users can validate newsletter quality before selecting
**How:**
- Fetch sample email during newsletter selection
- Show preprocessed preview in modal
- "This is what we'll summarize: [preview]"

**Code Location:** `components/NewsletterSelectionCard.tsx` - Add preview modal

#### 5. **Digest Quality Summary** ⭐ Medium Impact
**What:** Show quality metrics after digest generation
**Why:** Transparent communication about digest quality
**How:**
- Calculate: total newsletters, skipped items, quality scores
- Display in digest email/UI: "8 newsletters, 1 skipped (visual-only)"

**Code Location:** `app/api/digest/generate-summaries/route.ts` - Add to response

### Medium Effort (4-8 hours)

#### 6. **Smart Newsletter Recommendations**
**What:** AI-powered recommendations during onboarding
**Why:** Help users discover high-quality newsletters
**How:**
- Analyze user's selected newsletters
- Recommend similar high-quality newsletters
- "Users who like [X] also subscribe to [Y]"

#### 7. **Newsletter Format Change Detection**
**What:** Detect when newsletter format improves/degrades
**Why:** Re-recommend previously removed newsletters if they improve
**How:**
- Track quality scores over time
- Alert user: "[Newsletter] format has improved. Re-add to digest?"

### Future Enhancements

#### 8. **User Feedback Loop**
- "Was this summary helpful?" buttons
- Track satisfaction per newsletter
- Auto-remove low-satisfaction newsletters

#### 9. **Newsletter Format Preferences**
- User can mark: "This is a visual flyer, skip it"
- User can mark: "This is link-heavy, skip it"
- Learn from user preferences

---

## Technical Opinion: Code Quality Assessment

### What's Working Well ✅

1. **Preprocessing Pipeline:** Robust HTML conversion, Base64 stripping, boilerplate removal
2. **Sparse Content Protocol:** Smart detection of visual-only/link-only emails
3. **Safety Valve:** Prevents catastrophic content deletion
4. **Dynamic Truncation:** Handles large emails efficiently
5. **Error Handling:** Graceful fallbacks, clear error messages

### Areas for Improvement 🔧

#### 1. **Code Organization** (Low Priority)
- **Current:** All preprocessing logic in `generate-summaries/route.ts` (774 lines)
- **Improvement:** Extract preprocessing to `lib/digest/preprocessor.ts`
- **Benefit:** Reusable, testable, cleaner route handler

#### 2. **Quality Metrics** (High Priority - Quick Win)
- **Current:** No quality scoring
- **Improvement:** Add content quality metrics during preprocessing
- **Benefit:** Enables smart recommendations, quality reports

#### 3. **User Feedback Integration** (Medium Priority)
- **Current:** No user feedback mechanism
- **Improvement:** Add "Remove from Digest" UI, quality ratings
- **Benefit:** Learn from users, improve recommendations

#### 4. **Testing Coverage** (Medium Priority)
- **Current:** Manual testing via Dev Mode Panel
- **Improvement:** Unit tests for preprocessing, integration tests for digest generation
- **Benefit:** Catch regressions, faster iteration

#### 5. **Monitoring & Observability** (High Priority - Future)
- **Current:** Basic logging
- **Improvement:** Structured logging, metrics (quality scores, skip rates, LLM costs)
- **Benefit:** Understand system behavior, optimize costs

---

## Implementation Roadmap

### Phase 1: Quick Wins (Week 1)
1. ✅ Newsletter quality scoring during classification
2. ✅ "Remove from Digest" UI
3. ✅ Digest quality summary in response
4. ✅ Summary ranking & feedback UI (👍/👎 buttons)
5. ✅ User newsletter recommendations in onboarding

### Phase 2: Onboarding Enhancement (Week 2)
1. Quality indicators in newsletter selection UI
2. Smart recommendations during selection
3. Sample content preview

### Phase 3: User Communication (Week 3)
1. In-digest recommendations for messy emails
2. Newsletter management dashboard
3. Quality reports after each digest

### Phase 4: Future Features (Months 2+)
1. Web content aggregation
2. Learning programs
3. Advanced intelligence features

---

## Key Decisions

### ✅ Accepted
- **Email entropy is reality** - We won't solve all email format issues, we'll handle them gracefully
- **User validation is key** - Let users identify and remove noisy newsletters
- **Transparency matters** - Be upfront about digest quality and limitations

### 🤔 Open Questions
- Should we auto-remove low-quality newsletters, or always ask user?
- How do we handle newsletters that change format over time?
- What's the threshold for "low quality" that triggers recommendations?

---

## Related Documents

- **Feature Backlog:** `docs/IMPORTANT feature_backlog.md`
- **Digest Infrastructure:** `docs/IMPORTANT digest_infrastructure_status.md`
- **Sparse Content Protocol:** `docs/sparse_content_protocol_implementation.md`
- **Preprocessing Changes:** `docs/prompt_and_preprocessing_overhaul_changes.md`

---

## Notes

- This document should be updated as we learn more about user behavior
- Quality metrics should be refined based on real user feedback
- Future features (web scraping, learning programs) should reference this strategy
