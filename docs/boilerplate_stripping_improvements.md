# Boilerplate Stripping Improvements

## Problem Summary

Current boilerplate stripping is insufficient, allowing email metadata (tracking links, footers, social links) to consume token budget that should be used for actual article content.

**Impact:**
- ~30-40% of preprocessed content is boilerplate noise
- Wasted tokens on footers/links instead of article content
- Potentially lower summary quality (LLM sees more noise)
- Same API costs for less useful content
- **Note:** This is NOT a truncation issue - truncation works correctly. The problem is noise consuming token budget.

**Example:** 5,690 chars preprocessed with 2,000+ chars of boilerplate = ~500 tokens wasted per email on noise instead of real content

---

## Current State

**Processing Order:**
1. HTML → Text conversion ✅ (working)
2. Boilerplate stripping ⚠️ (insufficient)
3. Truncation ✅ (working correctly)

**Current `stripBoilerplate()` function only removes:**
- Lines containing "unsubscribe"
- Lines containing "update your preferences"
- Lines containing "view this email in your browser"
- Lines containing "manage your preferences"
- Lines containing "privacy policy"
- Lines containing "you are receiving this email because"
- Copyright lines (© YYYY)
- Lines containing "forward this email"

**What's NOT being removed:**
- Tracking URLs (`https://lists.theepochtimes.com/links/...`)
- Social media links (Facebook, Instagram, Twitter, LinkedIn, etc.)
- Email footers ("Share this email", "Received this email from a friend?")
- Physical addresses ("229 W 28th St, Fl.5, New York, NY 10001")
- "Manage My Subscriptions" links
- "Trouble viewing this email? View in browser" links
- Sponsor/advertisement sections
- Legal disclaimers ("Past performance is no guarantee...")
- "Sent by [Company]" lines
- "Click here to subscribe" links

---

## Recommended Improvements

### 1. Remove Tracking URLs
**Pattern:** URLs containing tracking parameters or email service domains
- `lists.theepochtimes.com/links/`
- `links.investopedia.com/e/evib`
- `email-st.seekingalpha.com/click`
- URLs with `utm_source`, `utm_campaign`, `utm_medium` parameters
- URLs with `?subject=`, `&body=` (email share links)

**Implementation:**
```typescript
// Remove lines containing tracking URLs
if (line.match(/https?:\/\/[^\s]*(lists\.|links\.|email-st\.|track\/click|utm_source|utm_campaign)/i)) {
  return false
}
```

### 2. Remove Social Media Links
**Pattern:** Common social media platform links
- Facebook, Instagram, Twitter/X, LinkedIn, YouTube, TikTok, Threads
- Usually appear as footer sections with icons

**Implementation:**
```typescript
// Remove lines containing social media links
if (line.match(/https?:\/\/[^\s]*(facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|threads)/i)) {
  return false
}
```

### 3. Remove Email Footer Patterns
**Common phrases:**
- "Share this email"
- "Received this email from a friend?"
- "Trouble viewing this email?"
- "View in browser"
- "Manage My Subscriptions"
- "Click here to subscribe"
- "You are receiving this newsletter because"
- "Sent by [Company]"
- "This email was sent to"

**Implementation:**
```typescript
const footerPatterns = [
  /share this email/i,
  /received this email from a friend/i,
  /trouble viewing this email/i,
  /view in browser/i,
  /manage my subscriptions/i,
  /click here to subscribe/i,
  /you are receiving this/i,
  /sent by/i,
  /this email was sent to/i,
  /unsubscribe/i,
  /update your preferences/i
]

if (footerPatterns.some(pattern => pattern.test(line))) {
  return false
}
```

### 4. Remove Physical Addresses
**Pattern:** Street addresses (usually at end of emails)
- Format: "Company Name, [Number] [Street], [City], [State] [Zip]"
- Example: "The Epoch Times, 229 W 28th St, Fl.5, New York, NY 10001"

**Implementation:**
```typescript
// Remove lines that look like addresses (contains street number + city/state)
if (line.match(/\d+\s+\w+\s+(st|street|ave|avenue|rd|road|blvd|boulevard|way|dr|drive)[\s,]+/i) ||
    line.match(/,\s*[A-Z]{2}\s+\d{5}/)) { // State + ZIP pattern
  return false
}
```

### 5. Remove Legal Disclaimers
**Common patterns:**
- "Past performance is no guarantee"
- "Any content and tools"
- "No recommendation or advice"
- "Seeking Alpha does not"
- "Terms of Service"
- "Privacy Policy" (already handled, but ensure it's working)

**Implementation:**
```typescript
const legalPatterns = [
  /past performance is no guarantee/i,
  /any content and tools/i,
  /no recommendation or advice/i,
  /does not take account/i,
  /terms of service/i,
  /privacy policy/i
]

if (legalPatterns.some(pattern => pattern.test(line))) {
  return false
}
```

### 6. Remove Sponsor/Advertisement Sections
**Pattern:** Lines containing "Sponsored by", "Advertisement:", "Advertiser's Note:"

**Implementation:**
```typescript
if (line.match(/(sponsored by|advertisement|advertiser's note)/i)) {
  return false
}
```

### 7. Remove Empty/Whitespace-Only Lines After Filtering
**Implementation:**
```typescript
// After filtering, remove excessive blank lines
return filtered.join("\n")
  .replace(/\n{4,}/g, "\n\n") // Max 2 consecutive newlines
  .trim()
```

### 8. Remove Lines That Are Mostly URLs
**Pattern:** Lines where >50% of content is URLs

**Implementation:**
```typescript
const urlCount = (line.match(/https?:\/\/[^\s]+/g) || []).length
const urlLength = (line.match(/https?:\/\/[^\s]+/g) || []).reduce((sum, url) => sum + url.length, 0)
if (urlLength > line.length * 0.5) {
  return false
}
```

---

## Implementation Strategy

### Phase 1: Quick Wins (High Impact, Low Risk)
1. Remove tracking URLs (pattern matching)
2. Remove social media links
3. Expand footer pattern matching
4. Remove lines that are mostly URLs

### Phase 2: Pattern Refinement
1. Remove physical addresses
2. Remove legal disclaimers
3. Remove sponsor sections
4. Clean up excessive whitespace

### Phase 3: Testing & Validation
1. Compare preprocessed content before/after improvements
2. Measure boilerplate reduction (% of content that's actual article)
3. Verify summaries improve (more specific, less generic)
4. Check token usage (should see more content per batch)

---

## Success Metrics

**Before:**
- ~30-40% boilerplate in preprocessed content
- 2 batches for 11 emails
- ~500 tokens wasted per email on noise

**After (Target):**
- <10% boilerplate in preprocessed content
- More content per batch (potentially 1 batch for 11 emails)
- More specific summaries (LLM sees more real content)

---

## Testing Approach

1. **Before/After Comparison:**
   - Run `get_preprocessed_content.sql` before changes
   - Implement improvements
   - Regenerate summaries
   - Compare preprocessed content lengths and quality
   - Compare summary quality

2. **Manual Inspection:**
   - Pick 2-3 sample emails
   - Check preprocessed content manually
   - Verify boilerplate is removed
   - Verify article content is preserved

3. **Token Usage:**
   - Compare `estimated_input_tokens` before/after
   - Should see more tokens used for actual content (not noise)
   - Should see fewer batches needed

---

## Notes

- **Conservative approach:** Start with Phase 1, test, then add Phase 2
- **Preserve content:** Be careful not to remove article content that happens to match patterns
- **Test edge cases:** Some newsletters might have legitimate links/content that matches patterns
- **Iterate:** Use `preprocessed_content` column to verify improvements after each change

---

## Future Consideration: Removing Character Limits

**Current State:**
- Per-email limits: 15k (morning-brief), 20k (reference-mode), 30k (deep-read)
- Per-batch limit: 50k chars (~12-15k tokens)

**After Aggressive Boilerplate Stripping:**
- Content should be much cleaner and smaller
- Most emails will naturally be under reasonable limits
- Boilerplate was the main driver of large content sizes

**Potential Approach:**
- Remove per-email character limits entirely
- Rely only on per-batch limit (50k chars)
- Let batching logic handle grouping naturally
- Simpler code, less truncation logic needed

**Benefits:**
- No artificial content cutting
- Simpler implementation
- More content per batch (better token efficiency)
- Unit economics can be explored later

**Consideration:**
- Monitor average email sizes after stripping
- If some emails are still extremely long (>50k chars), may need per-email limit as safety valve
- But likely unnecessary if stripping is aggressive enough

**Recommendation:**
- Implement aggressive boilerplate stripping first
- Measure actual content sizes after stripping
- If most emails are <30k chars clean content, remove per-email limits
- Keep per-batch limit (50k chars) as the only constraint
