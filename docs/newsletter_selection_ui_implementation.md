# Newsletter Selection UI Implementation Plan

## Overview
Create a third dashboard card that displays classified newsletters and allows users to select which ones they want in their feed. The card will show newsletters grouped by classification status (Yes/Grey/No) with appropriate visual treatments.

---

## Phase 1: Database Schema

### Create `user_newsletter_selections` Table

```sql
CREATE TABLE user_newsletter_selections (
  user_id uuid NOT NULL,
  sender_key text NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, sender_key),
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Index for fast lookups
CREATE INDEX idx_user_newsletter_selections_user ON user_newsletter_selections(user_id);
```

**Purpose:** Stores user preferences for which newsletters to include in their feed, separate from classification results.

---

## Phase 2: API Endpoints

### 1. GET `/api/onboard/classified-senders`

**Purpose:** Fetch all classified senders with newsletter names and selection state.

**Logic:**
- Query `digest_candidates` for the user
- Join with `messages_raw` to extract newsletter names (`from_name` or parsed domain)
- Join with `user_newsletter_selections` to get `selected` state
- Default `selected: true` for "Yes" newsletters if not in selections table yet
- Return all 45 senders (including "No" ones for expandable section)

**Response Format:**
```typescript
{
  ok: true,
  senders: [
    {
      newsletter_name: string,      // "The Epoch Times" or parsed domain
      sender_key: string,           // "theepochtimes.com"
      status: "Yes" | "Grey" | "No",
      messages: number,              // msgs_14d
      confidence: string,           // "High Confidence" | "Low Confidence" | "Rule Filtered"
      selected: boolean             // from user_newsletter_selections
    },
    // ... all 45 senders
  ]
}
```

**Implementation:**
- Reuse logic from `docs/ui_classification_view.sql`
- Extract newsletter names using `COALESCE(from_name, parsed_domain, sender_key)`
- Group by bucket (positive → grey → low)
- Include selection state from `user_newsletter_selections`

---

### 2. POST `/api/onboard/finalize-selections`

**Purpose:** Save user's newsletter selections to database.

**Request Body:**
```typescript
{
  selections: [
    { sender_key: "theepochtimes.com", selected: true },
    { sender_key: "investopedia.com", selected: false },
    // ... all changed selections
  ]
}
```

**Logic:**
- Upsert each selection into `user_newsletter_selections`
- Update `updated_at` timestamp
- Return success/error

**Response:**
```typescript
{
  ok: true,
  saved: number,        // Number of selections saved
  message?: string      // Success message
}
```

**Error Handling:**
- Validate user is authenticated
- Validate sender_key exists in digest_candidates
- Handle database errors gracefully

---

## Phase 3: UI Component

### `components/NewsletterSelectionCard.tsx`

**Structure:**
```
┌─────────────────────────────────────┐
│ Newsletter Selection                │
│                                     │
│ [Friendly copy about AI analysis]  │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ☑ Newsletter Name               │ │ ← Yes (illuminated)
│ │    domain.com • 25 messages     │ │
│ │ ☑ Another Newsletter            │ │
│ │    domain2.com • 12 messages     │ │
│ │                                 │ │
│ │ ☐ Uncertain Newsletter          │ │ ← Grey (not illuminated)
│ │    domain3.com • 8 messages     │ │
│ │ ☐ Another Uncertain              │ │
│ │                                 │ │
│ │ [Show 30 non-newsletters ▼]     │ │ ← Collapsed "No" section
│ └─────────────────────────────────┘ │
│                                     │
│ [Finalize Selections] button        │
└─────────────────────────────────────┘
```

**Features:**
- **Friendly Copy:** Top of card explaining AI analysis
- **Scrollable Container:** Max height with internal scroll
- **Three Sections:**
  1. **"Yes" Newsletters:** Preselected (checked), illuminated background
  2. **"Grey" Newsletters:** Not preselected, standard styling
  3. **"No" Newsletters:** Collapsed by default, expandable accordion
- **Each Row:**
  - Checkbox (left)
  - Newsletter name + domain (right)
  - Message count (subtle, optional)
- **Finalize Button:** Saves selections, shows loading/success states

**Visual Design:**
- Match existing card style (dark theme, `bg-white/5`, rounded corners)
- **Illumination Effect:** Checked items use `bg-white/15` (vs `bg-white/5` unchecked)
- Subtle border highlight on checked items (`border-white/20`)
- Smooth transitions on check/uncheck
- Hover states for interactivity

**State Management:**
- Local state for checkbox selections (before finalizing)
- Track which items changed (for efficient API call)
- Loading states during fetch/save
- Success/error feedback

---

## Phase 4: Integration

### Update `app/(app)/dashboard/page.tsx`

**Changes:**
- Import `NewsletterSelectionCard`
- Add to grid layout (3rd card, same row or new row)
- Position alongside existing cards

**Layout:**
```
┌─────────────┬─────────────┬─────────────┐
│ Connect     │ Backfill    │ Newsletter  │
│ Gmail       │             │ Selection   │
└─────────────┴─────────────┴─────────────┘
```

---

## Phase 5: Data Flow

### User Journey:

1. **Initial Load:**
   - User visits dashboard
   - `NewsletterSelectionCard` mounts
   - Fetches from `/api/onboard/classified-senders`
   - Displays newsletters with "Yes" items checked by default

2. **User Interaction:**
   - User checks/unchecks newsletters
   - Local state updates (no API call yet)
   - Visual feedback (illumination effect)
   - User can expand "No" section to browse filtered senders

3. **Finalize:**
   - User clicks "Finalize Selections"
   - Component sends only changed selections to API
   - Shows loading state
   - On success: refresh data, show success message
   - On error: show error message

4. **Subsequent Visits:**
   - Loads selections from `user_newsletter_selections`
   - Shows previously selected newsletters as checked

---

## File Structure

```
app/api/onboard/
  ├── classified-senders/
  │   └── route.ts (GET)          # Fetch classified senders with selections
  └── finalize-selections/
      └── route.ts (POST)          # Save user selections

components/
  └── NewsletterSelectionCard.tsx  # New UI component

app/(app)/dashboard/
  └── page.tsx                     # Add NewsletterSelectionCard

docs/
  └── newsletter_selection_ui_implementation.md (this file)
```

---

## Implementation Details

### Newsletter Name Extraction Logic

Reuse SQL logic from `docs/ui_classification_view.sql`:
1. Get `from_name` from `messages_raw` (most common per sender_key)
2. Fall back to parsed domain name (remove TLD, capitalize)
3. Fall back to raw `sender_key` if parsing fails

### Selection Defaults

- **"Yes" newsletters:** `selected: true` by default (unless user previously unchecked)
- **"Grey" newsletters:** `selected: false` by default
- **"No" newsletters:** `selected: false` by default

### Visual States

- **Unchecked:** `bg-white/5`, no border highlight
- **Checked:** `bg-white/15`, `border-white/20`, subtle glow
- **Hover:** Slight brightness increase
- **Loading:** Disable interactions, show spinner

### Error Handling

- API errors: Show user-friendly error message
- Network errors: Retry logic or clear error message
- Validation: Ensure sender_key exists before saving

---

## Open Questions (Confirmed)

1. **Initial Selection State:** ✅ **CONFIRMED** - "Yes" items SHOULD be auto-selected on first load (even if not in DB yet)
   - Auto-select "Yes" items by default
   - Allow unchecking
   - Save state when user finalizes

2. **After Finalizing:** ⏳ **TBD** - User needs to think about next steps
   - Implementation will handle basic success/refresh for now
   - Can be enhanced later based on user's decision

3. **Finalize Button:** ✅ **CONFIRMED** - Button should NOT be disabled if nothing changed
   - Always enabled
   - User can click even if no changes (idempotent)

4. **Expandable Section:** ✅ **CONFIRMED** - When user selects a "No" newsletter, it stays in "No" section but shows as selected (illuminated)
   - Selected "No" items get illumination effect
   - Stay in collapsed/expanded "No" section

---

## Testing Checklist

- [ ] Database table created successfully
- [ ] GET endpoint returns all 45 senders with correct data
- [ ] POST endpoint saves selections correctly
- [ ] UI displays newsletters grouped correctly
- [ ] "Yes" newsletters are checked by default
- [ ] Checkbox interactions work smoothly
- [ ] Illumination effect looks good
- [ ] Expandable "No" section works
- [ ] "Finalize Selections" button saves correctly
- [ ] Success/error states display properly
- [ ] Selections persist across page refreshes
- [ ] Card matches existing design style

---

## Implementation Order (Piecemeal)

### Step 1: Database Setup ⏸️ **WAIT FOR USER**
**Action Required:** User creates the `user_newsletter_selections` table in Supabase
**SQL:** See Phase 1 above
**When:** User will create table before we proceed

### Step 2: GET Endpoint
**File:** `app/api/onboard/classified-senders/route.ts`
**What:** Fetch all classified senders with newsletter names and selection state
**Dependencies:** Table must exist (Step 1)
**Test:** Can test with SQL query first, then implement endpoint

### Step 3: POST Endpoint  
**File:** `app/api/onboard/finalize-selections/route.ts`
**What:** Save user selections to database
**Dependencies:** Table must exist (Step 1)
**Test:** Can test with direct SQL inserts, then implement endpoint

### Step 4: UI Component (Basic)
**File:** `components/NewsletterSelectionCard.tsx`
**What:** Display newsletters, basic checkbox functionality
**Dependencies:** GET endpoint (Step 2)
**Test:** Fetch and display data, checkboxes work locally

### Step 5: UI Component (Finalize)
**What:** Add "Finalize Selections" button and save functionality
**Dependencies:** POST endpoint (Step 3)
**Test:** Save selections, verify in database

### Step 6: UI Polish
**What:** Illumination effects, expandable section, styling
**Dependencies:** Basic component working (Step 4)
**Test:** Visual polish, smooth interactions

### Step 7: Integration
**File:** `app/(app)/dashboard/page.tsx`
**What:** Add NewsletterSelectionCard to dashboard
**Dependencies:** Component complete (Steps 4-6)
**Test:** End-to-end flow on dashboard

---

## Next Steps

**IMMEDIATE:** Wait for user to create `user_newsletter_selections` table in Supabase
**THEN:** Proceed with Step 2 (GET endpoint)
