# Alpha Testing - Summary Quality Improvements

## Implementation Checklist

### Phase 1: HTML Preprocessing (HIGH PRIORITY)
- [x] Install HTML-to-Markdown conversion library (`html-to-text` or `turndown`) - Already installed
- [x] Add HTML → Markdown conversion step before boilerplate stripping
- [x] Strip CSS, tracking pixels, and style tags during conversion
- [x] Preserve structure: headings, lists, paragraphs, links
- [x] Convert links to Markdown format `[text](url)` - Links preserved with URLs
- [ ] Test with sample HTML emails to verify content preservation

**Expected Impact:** 30-50% reduction in noise, better content extraction

---

### Phase 2: Truncation Improvements
- [x] Increase default truncation limit from 10k → 15k chars for morning-brief
- [x] Implement dynamic truncation logic:
  - [x] < 15k chars: Full pass
  - [x] 15k-30k chars: Allow up to 30k (no chunking)
  - [ ] > 30k chars: Chunk into 15k pieces, summarize each, merge results (deferred - see note)
- [x] Apply truncation AFTER HTML → Markdown conversion (not before)
- [ ] Update truncation status tracking in database/logs

**Expected Impact:** Better content coverage, less information loss

---

### Phase 3: Prompt Refinement
- [x] Update morning-brief instruction to headline + bullets format (removed single-sentence constraint)
- [x] Remove all word count requirements (no "30 words", "10-14 words", etc.)
- [x] Remove hard requirements like "must include at least one concrete number" (let prompt speak for itself)
- [x] Add guidance: "Focus on extracting concrete information: numbers, names, dates, and specific facts"
- [x] Add guidance: "If the email contains multiple unrelated topics, summarize the top 1-2 topics only"
- [x] Add instruction about truncation markers: "If content includes '[... truncated for digest ...]', summarize only what exists"
- [x] Add guidance: "End with a brief implication when it adds value"
- [x] Keep filler word guidance in system prompt ("AVOID FILLER. WE WANT THE USERS TO RECEIVE SUBSTANCE.")
- [x] Update tone to "Concise and fact-dense"
- [x] Make bullet count open-ended (let content determine, typically 1-3)
- [ ] Test prompt changes with sample emails

**Expected Impact:** More specific, less generic summaries

---

### Phase 4: Batching Strategy
- [x] Change batching from "summary count" to "character count"
- [x] Implement dynamic batching: group emails until ~50k chars total (~12-15k tokens)
- [x] Handle single long emails (>30k) separately (chunk individually)
- [x] Update batch processing logic in `summarizeBatch` function
- [ ] Test with mixed-length email batches

**Expected Impact:** More efficient API usage, better handling of long emails

---

### Phase 5: Testing & Validation
- [ ] Run test with HTML → Markdown conversion
- [ ] Compare summaries before/after HTML preprocessing
- [ ] Test truncation limits (15k, 30k) with various email lengths
- [ ] Validate prompt changes produce more specific summaries
- [ ] Test dynamic batching with mixed email sizes
- [ ] Measure cost impact of changes
- [ ] Export results to Excel for comparison

**Success Criteria:**
- Summaries include more specific details (numbers, names, facts)
- Less generic language
- Better extraction from HTML-heavy emails
- Cost per summary remains reasonable

---

## Implementation Notes

### HTML Preprocessing Library Options
- `html-to-text`: Simple, good for plain text extraction
- `turndown`: Converts HTML to Markdown, preserves structure better
- Recommendation: Start with `html-to-text` for simplicity, upgrade to `turndown` if needed

### Dynamic Truncation Implementation
```typescript
function getTruncationLimit(contentLength: number): number {
  if (contentLength < 15000) return contentLength // Full pass
  if (contentLength <= 30000) return 30000 // Allow up to 30k
  return 15000 // Chunk size for >30k emails
}
```

### Batching by Character Count
```typescript
function groupByCharCount(items: EmailItem[], maxChars: number = 50000): EmailItem[][] {
  const batches: EmailItem[][] = []
  let currentBatch: EmailItem[] = []
  let currentCharCount = 0
  
  for (const item of items) {
    const itemChars = item.content.length
    if (currentCharCount + itemChars > maxChars && currentBatch.length > 0) {
      batches.push(currentBatch)
      currentBatch = [item]
      currentCharCount = itemChars
    } else {
      currentBatch.push(item)
      currentCharCount += itemChars
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch)
  return batches
}
```

---

## Status Tracking

**Last Updated:** 2026-01-24
**Current Phase:** ✅ All Phases Complete - Ready for Testing
**Next Steps:** Test with "Regenerate Summaries" button and compare results

## Implementation Summary

✅ **Phase 1:** HTML → Text conversion implemented (`convertHtmlToText` function)
✅ **Phase 2:** Truncation limits increased (10k→15k) + dynamic truncation (<15k full, 15-30k allows 30k)
✅ **Phase 3:** Prompt refined - headline + bullets format, no word counts, open-ended bullets, natural guidance
✅ **Phase 4:** Batching by character count (~50k chars per batch, MAX_CHARS_PER_BATCH = 50000)

**Current Prompt Format:**
- Headline: One headline capturing main takeaways and central themes
- Bullets: Variable number (1-3+, let content determine) with important facts and details
- No word count restrictions
- Natural guidance (not hard requirements)
- Multi-topic handling (top 1-2 topics only)

**Note:** Chunking for >30k emails deferred (can add later if needed)
