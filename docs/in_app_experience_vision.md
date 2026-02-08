# In-App Experience Vision

**Status:** [IDEA] - Future mobile app feature

## Core Concept

The in-app experience should be **super fluid** - users should be able to:
1. See all newsletters on a dashboard
2. Expand into individual newsletters dynamically
3. Navigate seamlessly between overview and detail views

## Dashboard View

**Layout:**
- List/card view of all newsletters in the digest
- Each card shows:
  - Newsletter name/logo
  - Subject line
  - Summary preview (first sentence or truncated summary)
  - Timestamp
  - Unread indicator (if applicable)

**Interaction:**
- Tap/click to expand → Shows full summary
- Swipe/scroll to see all newsletters
- Pull to refresh → Fetch latest digest

## Newsletter Detail View

**When expanded:**
- Full summary (formatted based on digest style)
- Original subject line
- Links to original articles
- "View Original Email" button (deep link to Gmail)
- Timestamp and sender info

**Navigation:**
- Smooth expand/collapse animation
- Back button returns to dashboard
- Can expand multiple newsletters simultaneously (accordion-style) or single-expand mode

## Managing Multiple Summaries

**For 11+ newsletters:**
- Group by sender/newsletter name
- Collapsible sections per newsletter
- Search/filter functionality
- Sort by: date, sender, relevance

**Performance:**
- Lazy load summaries (load on expand)
- Cache expanded state
- Smooth scrolling for long lists

## Technical Considerations

**Data Structure:**
- Store summaries in `digest_items.content_summary`
- Link items to `digests` table
- Support pagination for large digests

**UI/UX:**
- Native mobile feel (React Native)
- Smooth animations
- Offline support (cache digests locally)
- Deep linking from email → specific newsletter in app

## Future Enhancements

- [ ] Mark newsletters as read/unread
- [ ] Save/bookmark favorite newsletters
- [ ] Share individual newsletters
- [ ] Search across all digests
- [ ] Filter by topic/category
- [ ] Custom digest organization

---

**Related Docs:**
- `docs/web_vs_app_strategy.md` - Web vs App roles
- `docs/IMPORTANT feature_backlog.md` - Feature tracking
