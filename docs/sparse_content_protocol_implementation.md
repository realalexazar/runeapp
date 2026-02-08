# Sparse Content Protocol Implementation

## Summary

Implemented Gemini's recommendations to fix HTML conversion failures and add a "Sparse Content Protocol" that prevents wasted LLM calls on low-content emails.

## Changes Made

### 1. Fixed HTML Conversion (`convertHtmlToText`)

**Problems Fixed:**
- Large HTML emails (80k+ chars) causing timeouts or empty results
- Base64 image bloat turning small emails into massive files

**Solutions:**
- Added size limit check (200k chars) - uses fallback regex for very large files
- Strip Base64 images before processing (`data:image/...;base64,...`)
- Validate output isn't empty/suspiciously short (<50 chars)
- Improved fallback regex extraction for large/complex HTML

**Code Location:** `app/api/digest/generate-summaries/route.ts` lines 495-560

### 2. Fixed Boilerplate Stripping (`stripBoilerplate`)

**Problem Fixed:**
- Over-aggressive filtering removing substantive content that happened to contain URLs
- Example: "The Fed met yesterday (read more: https://...)" was being deleted

**Solution:**
- **"Only URL + short line" rule**: Remove lines with tracking URLs ONLY if line is short (<100 chars)
- This preserves substantive news lines even if they contain links
- Added "Bottom-up trimmer": Remove everything after "Unsubscribe" or "Privacy Policy"

**Code Location:** `app/api/digest/generate-summaries/route.ts` lines 562-630

### 3. Sparse Content Protocol

**New Feature:**
- Detects emails with insufficient content before LLM call
- Skips LLM processing for sparse/empty emails (saves money)
- Generates user-friendly fallback summaries

**Implementation:**
- Minimum content threshold: 100 characters
- Detection flags:
  - `EMPTY`: No content extracted (NULL/empty)
  - `SPARSE`: Content too short (<100 chars)
- Fallback summaries:
  - `EMPTY`: "Unable to extract content from this email. Please view the original email."
  - `SPARSE`: "This email contains minimal text content. Subject: [subject line]"

**Code Location:** `app/api/digest/generate-summaries/route.ts` lines 169-239

### 4. Database Schema Update

**New Column:** `skip_reason` (text, nullable)
- Values: `'EMPTY'`, `'SPARSE'`, `'VISUAL_ONLY'`, `'LINK_ONLY'`
- NULL = email processed normally
- Indexed for filtering

**Migration:** `docs/migrations/add_skip_reason_column.sql`

### 5. API Response Updates

**New Fields:**
- `summaries_skipped`: Count of sparse items that were skipped from LLM
- Token/cost calculations now only count valid items (sparse items excluded)

**Code Location:** `app/api/digest/generate-summaries/route.ts` lines 286-300

## Expected Improvements

### Before:
- Epoch Times (85k HTML) → NULL → Generic "No details" summary
- Must Reads (87k HTML) → NULL → Generic "No details" summary  
- Cedric Bobo (visual flyer) → 60 chars → Generic "No details" summary
- Wasted LLM calls on empty content

### After:
- Epoch Times → Proper HTML conversion → Multi-story summaries
- Must Reads → Proper HTML conversion → Article preview summaries
- Cedric Bobo → Detected as SPARSE → Fallback: "This email contains minimal text content. Subject: CBRE Summer 2026 Internship..."
- No wasted LLM calls on sparse content

## Testing Checklist

1. ✅ HTML conversion handles large emails (80k+ chars)
2. ✅ Base64 images stripped before processing
3. ✅ Boilerplate stripping preserves substantive content with URLs
4. ✅ Sparse content detection works (<100 chars)
5. ✅ Fallback summaries generated for sparse items
6. ✅ Skip_reason stored in database
7. ✅ API response includes `summaries_skipped` count

## Next Steps (Future)

1. **UI Updates**: Display skip_reason in UI with appropriate messaging
2. **Image Extraction**: Extract images from emails for visual flyers (feature wishlist)
3. **Enhanced Detection**: Add `VISUAL_ONLY` and `LINK_ONLY` detection
4. **Subject Line LLM**: For sparse emails, could still call LLM with just subject line for better summaries

## Files Modified

- `app/api/digest/generate-summaries/route.ts` - Main implementation
- `docs/migrations/add_skip_reason_column.sql` - Database migration

## Questions for Gemini

1. Should we add a timeout wrapper for `html-to-text` conversion, or is the size limit sufficient?
2. For `VISUAL_ONLY` detection, should we check image count vs. text ratio?
3. Should sparse emails still get a lightweight LLM call with just the subject line, or are fallback summaries sufficient?
