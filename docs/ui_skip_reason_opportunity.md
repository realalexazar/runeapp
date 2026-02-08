# UI Opportunity: Breaking the 4th Wall with skip_reason

## The Opportunity

Now that we have `skip_reason` stored in the database, we can create a smarter UI that "breaks the 4th wall" and tells users why certain emails were handled differently.

## Current State

**Before:** Generic "No details provided" bullet point for all problematic emails

**After:** Context-aware UI cards that explain what happened

## UI Design Recommendations

### 1. Visual Announcement Card (`VISUAL_ONLY` or `SPARSE`)

**When:** `skip_reason = 'SPARSE'` or `skip_reason = 'VISUAL_ONLY'`

**UI:**
```
┌─────────────────────────────────────────┐
│ 📎 Visual Announcement                  │
│                                         │
│ Subject: CBRE Summer 2026 Internship   │
│                                         │
│ This appears to be a visual flyer or   │
│ announcement. Please view the original │
│ email for full details.                │
│                                         │
│ [View Original Email]                   │
└─────────────────────────────────────────┘
```

**Benefits:**
- User understands why summary is minimal
- Feels intentional, not broken
- Clear call-to-action

### 2. Link-Only Email Card (`LINK_ONLY`)

**When:** `skip_reason = 'LINK_ONLY'`

**UI:**
```
┌─────────────────────────────────────────┐
│ 🔗 Link Digest                          │
│                                         │
│ Subject: Weekly Newsletter Roundup      │
│                                         │
│ This email contains primarily links.    │
│ View original to see all links.         │
│                                         │
│ [View Original Email]                   │
└─────────────────────────────────────────┘
```

### 3. Empty Content Card (`EMPTY`)

**When:** `skip_reason = 'EMPTY'`

**UI:**
```
┌─────────────────────────────────────────┐
│ ⚠️ Content Extraction Failed             │
│                                         │
│ Subject: [subject line]                 │
│                                         │
│ Unable to extract content from this     │
│ email. This may be due to complex       │
│ formatting or encoding issues.           │
│                                         │
│ [View Original Email]                   │
└─────────────────────────────────────────┘
```

### 4. Normal Summary Card (NULL skip_reason)

**When:** `skip_reason IS NULL`

**UI:** Standard summary display (unchanged)

## Implementation Notes

### Frontend Component Logic

```typescript
// Pseudocode for digest item component
function DigestItemCard({ item }) {
  if (item.skip_reason === 'SPARSE' || item.skip_reason === 'VISUAL_ONLY') {
    return <VisualAnnouncementCard subject={item.subject} />
  }
  
  if (item.skip_reason === 'LINK_ONLY') {
    return <LinkOnlyCard subject={item.subject} />
  }
  
  if (item.skip_reason === 'EMPTY') {
    return <EmptyContentCard subject={item.subject} />
  }
  
  // Normal summary
  return <StandardSummaryCard summary={item.content_summary} />
}
```

### Database Query

```sql
SELECT 
  id,
  subject,
  content_summary,
  skip_reason,
  -- ... other fields
FROM digest_items
WHERE digest_id = ?
ORDER BY received_at DESC
```

## User Experience Benefits

1. **Transparency**: Users understand why some emails have minimal summaries
2. **Trust**: Shows the system is working as intended, not broken
3. **Actionability**: Clear path to view original email when needed
4. **Intelligence**: Makes the product feel smarter ("I detected this was a flyer")

## Next Steps

1. **Frontend Implementation**: Create conditional rendering based on `skip_reason`
2. **Icon/Visual Design**: Design icons for each skip reason type
3. **A/B Testing**: Test if users prefer this transparency vs. generic messages
4. **Analytics**: Track how often users click "View Original" for each skip reason type

## Future Enhancements

- **Image Extraction**: For `VISUAL_ONLY` emails, extract and display images in the digest
- **Link Extraction**: For `LINK_ONLY` emails, extract and display top links
- **Subject Line LLM**: For `SPARSE` emails, could still call LLM with just subject line for better summaries
