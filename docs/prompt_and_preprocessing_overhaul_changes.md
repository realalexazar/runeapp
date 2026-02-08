# Prompt & Preprocessing Overhaul - Changes Made

## Summary
Implemented fixes for data mismatch bug, improved boilerplate stripping, updated prompt to be less restrictive, and added multi-article handling.

---

## Change 1: Fix Non-Breaking Spaces (Gemini Feedback)
**File:** `app/api/digest/generate-summaries/route.ts`  
**Function:** `convertHtmlToText()`

**What Changed:**
- Added regex to strip invisible non-breaking spaces (`\u200B-\u200D\uFEFF`)
- Normalized excessive whitespace (multiple spaces → single space)
- Applied to both main conversion and fallback path

**Why:**
- Investopedia emails contain long strings of invisible spaces
- Wastes tokens and can confuse LLM if at start of content

**Code Added:**
```typescript
text = text.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s\s+/g, ' ').trim()
```

---

## Change 2: Fix Data Mismatch Bug (Critical - Gemini Feedback)
**File:** `app/api/digest/generate-summaries/route.ts`  
**Locations:** 
- `summarizeBatchSingle()` - itemsText mapping
- `summarizeBatchSingle()` - results mapping

**What Changed:**
- **Before:** Used `offset + i + 1` as JSON key (e.g., "1", "2", "3")
- **After:** Use `item.id` as JSON key (e.g., "99c02ca8-ccfe-4ed0-b49b-efd50e005cc8")

**Why:**
- Sequential numbering is fragile - if LLM skips/reorders items, summaries drift
- Using unique IDs ensures correct mapping even if LLM changes order
- Fixes the bug where summaries were assigned to wrong emails

**Changes:**
1. BEGIN_ITEM/END_ITEM markers now use `item.id` instead of `itemNum`
2. JSON response parsing uses `item.id` as key instead of `String(offset + i + 1)`
3. Prompt updated to instruct LLM to use item ID as key

---

## Change 3: Aggressive Boilerplate Stripping (Phase 1 Quick Wins)
**File:** `app/api/digest/generate-summaries/route.ts`  
**Function:** `stripBoilerplate()`

**What Changed:**
Added removal of:
1. **Tracking URLs** - patterns like `lists.theepochtimes.com/links/`, `utm_source`, etc.
2. **Social media links** - Facebook, Instagram, Twitter, LinkedIn, YouTube, TikTok, Threads
3. **URL-heavy lines** - Lines where >50% of content is URLs
4. **Expanded footer patterns** - "Share this email", "Received this email from a friend?", "Trouble viewing", "Manage My Subscriptions", "Click here to subscribe", "Sent by", "This email was sent to", "Sponsored by", "Advertisement"
5. **Physical addresses** - Street number + city/state patterns
6. **Legal disclaimers** - "Past performance is no guarantee", "No recommendation or advice", etc.
7. **Whitespace cleanup** - Max 2 consecutive newlines

**Why:**
- Reduces noise from ~30-40% to target <10%
- Frees up token budget for actual content
- Improves summary quality (LLM sees more real content)

---

## Change 4: Multi-Article Handling (ChatGPT Feedback)
**File:** `app/api/digest/generate-summaries/route.ts`  
**Location:** `morning-brief` instruction

**What Changed:**
- **Before:** Ambiguous "article(s)" language
- **After:** Explicit instruction to extract and summarize each main idea/headline separately, with no limit on number of stories

**New Language:**
"If this email contains multiple unrelated articles or stories, extract and summarize each main idea/headline separately. Provide as many summaries as needed so the user can understand all key stories without reading the underlying article. Each story gets its own headline and bullets."

**Why:**
- Epoch Times sends 3-5 unrelated stories per email
- LLM was trying to jam them into one unified summary
- Now explicitly handles multi-article emails

---

## Change 5: Less Restrictive Format Instructions
**File:** `app/api/digest/generate-summaries/route.ts`  
**Location:** System prompt and morning-brief instruction

**What Changed:**
- **Removed:** "typically 1-3 bullets" restriction
- **Added:** "Include as many bullets as needed to cover the highlights—let the content determine the number"
- **Clarified:** Bullet count is dynamic based on content volume

**Why:**
- User requested dynamic bullets based on information volume
- Prompt was too restrictive, fighting against "let content guide length"
- Now trusts LLM to determine appropriate detail level

---

## Change 6: Strict Isolation Rule (Gemini Feedback)
**File:** `app/api/digest/generate-summaries/route.ts`  
**Location:** System prompt

**What Changed:**
Added new section:
```
## Strict Isolation Rule
Each summary must be derived EXCLUSIVELY from the text between its specific BEGIN_ITEM and END_ITEM markers. Do not let details from one item influence the summary of another. However, you may add relevant background knowledge, context, or implications that help readers understand the significance of the story (e.g., explaining who a person is, what an event means, or why it matters).
```

**Why:**
- Prevents cross-item contamination (using details from Item 2 in Item 1's summary)
- BUT allows helpful context (external knowledge that clarifies the story)
- Clarifies distinction between bad cross-item references vs. good contextual knowledge

---

## Change 7: Action Clause for Opportunity Emails
**File:** `app/api/digest/generate-summaries/route.ts`  
**Location:** `morning-brief` instruction

**What Changed:**
Added:
"For opportunity-based emails (internships, programs, offers), prioritize the action: who is it for, what is the deadline, and how do they apply?"

**Why:**
- CBRE internship emails need action-focused summaries
- Helps LLM prioritize actionable information for opportunity emails

---

## Change 8: Updated JSON Key Instructions
**File:** `app/api/digest/generate-summaries/route.ts`  
**Location:** System prompt output format section

**What Changed:**
- **Before:** "Use the item number from above (${offset + 1}, ${offset + 2}, etc.) as keys"
- **After:** "Use the unique item ID from BEGIN_ITEM markers as keys (not sequential numbers)"
- Example format updated to use actual item IDs instead of sequential numbers

**Why:**
- Aligns with Change 2 (using item.id instead of sequential numbers)
- Ensures LLM uses correct keys in JSON response

---

## Testing Checklist

After regenerating summaries, verify:

1. ✅ **Data Integrity:** Check that summaries match correct subjects (no more mismatches)
2. ✅ **Boilerplate Reduction:** Run `get_preprocessed_content.sql` and verify less noise
3. ✅ **Multi-Article Handling:** Check Epoch Times emails - should see separate summaries for each story
4. ✅ **Dynamic Bullets:** Verify bullet counts vary based on content (not stuck at 1-3)
5. ✅ **Context Preservation:** Verify summaries still include helpful context (like "Kevin Warsh was nominated")
6. ✅ **Opportunity Emails:** Check CBRE/Project Destined emails - should prioritize action items
7. ✅ **Token Usage:** Compare `estimated_input_tokens` - should see more content per batch

---

## Expected Improvements

**Before:**
- Data mismatches (wrong summaries for emails)
- ~30-40% boilerplate noise
- Multi-article emails forced into single summary
- Restrictive bullet counts
- Invisible spaces wasting tokens

**After:**
- Correct summary-to-email mapping
- <10% boilerplate noise (target)
- Separate summaries for each story in multi-article emails
- Dynamic bullet counts based on content
- Clean content without invisible spaces
- Better token efficiency
