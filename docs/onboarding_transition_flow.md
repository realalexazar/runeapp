# Onboarding Transition Flow

## Concept: Reuse 3-Card Layout

**Same visual structure, different content per step.**

---

## Step 1: Newsletter Selection (Current)

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Connect      │  │ Backfill /   │  │ Newsletter   │
│ Gmail        │  │ Classify     │  │ Selection    │
│              │  │              │  │              │
│ [Connected]  │  │ [Buttons]    │  │ [Checkboxes] │
│              │  │              │  │              │
│              │  │              │  │ [Finalize]   │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Cards:**
- Left: Connect Gmail (existing)
- Middle: Backfill/Classify (existing)
- Right: Newsletter Selection (existing)

---

## Step 2: Digest Configuration (After "Finalize Selection")

**Progressive Disclosure:** Cards appear one at a time as user interacts.

### Initial State (Only Cadence Visible)
```
┌──────────────┐
│ Cadence      │
│ Selection    │
│              │
│ [Radio cards]│
└──────────────┘
```

### After Cadence Selected (Time Card Appears)
```
┌──────────────┐  ┌──────────────┐
│ Cadence      │  │ Time         │
│ Selection    │  │ Selection    │
│              │  │              │
│ [Selected]  │  │ [Time picker] │
│              │  │ [Timezone]   │
└──────────────┘  └──────────────┘
```

### After Time Selected (Style Card Appears)
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Cadence      │  │ Time         │  │ Style        │
│ Selection    │  │ Selection    │  │ Selection    │
│              │  │              │  │              │
│ [Selected]  │  │ [Selected]  │  │ [Style cards]│
│              │  │              │  │              │
│              │  │              │  │ [Start]      │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Cards:**
- Left: Cadence Selection (always visible in Step 2)
- Middle: Time Selection (appears after cadence selected)
- Right: Style Selection (appears after time selected) + Submit button

**Back Button:** In header area (above cards) - returns to Step 1

---

## Implementation Approach

### Option A: Client Component Wrapper (Recommended)

**Create:** `components/OnboardingFlow.tsx` (client component)
- Manages `onboardingStep` state (1 or 2)
- Conditionally renders card content
- Handles navigation between steps

**Update:** `app/(app)/dashboard/page.tsx`
- Wrap cards in `<OnboardingFlow>`
- Pass server-side data (isConnected, etc.) as props

**Benefits:**
- Clean separation of concerns
- Easy to add more steps later
- State management in one place

### Option B: State in NewsletterSelectionCard

**Update:** `components/NewsletterSelectionCard.tsx`
- Add `onboardingStep` state
- Lift state to parent (dashboard)
- Conditionally render cards

**Cons:**
- State scattered across components
- Harder to manage

---

## Proposed Structure

### Component Hierarchy

```
DashboardPage (server)
  └── OnboardingFlow (client, manages step state)
       ├── Step 1: Newsletter Selection
       │    ├── ConnectGmailCard
       │    ├── BackfillParseControls
       │    └── NewsletterSelectionCard
       │
       └── Step 2: Digest Configuration
            ├── CadenceSelectionCard
            ├── TimeSelectionCard
            └── StyleSelectionCard
```

### State Management

```typescript
// In OnboardingFlow.tsx
const [onboardingStep, setOnboardingStep] = useState<1 | 2>(1)
const [step2Progress, setStep2Progress] = useState({
  cadenceSelected: false,
  timeSelected: false
})
const [selectedCadence, setSelectedCadence] = useState<string | null>(null)
const [selectedTimes, setSelectedTimes] = useState<string[]>([])
const [selectedTimezone, setSelectedTimezone] = useState<string>("UTC")

// After "Finalize Selection" succeeds:
setOnboardingStep(2)

// Progressive disclosure:
// - After cadence selected: setStep2Progress({ cadenceSelected: true })
// - After time selected: setStep2Progress({ cadenceSelected: true, timeSelected: true })

// After "Start Receiving Digests" succeeds:
// Navigate to post-onboarding dashboard
```

### Back Button

**Location Options:**

1. **Header Area** (Recommended)
   ```
   Dashboard
   Manage your connections and run backfills.
   [← Back to Newsletter Selection]
   
   [3 cards below]
   ```

2. **Inside Left Card** (Alternative)
   ```
   ┌──────────────┐
   │ [← Back]     │
   │ Cadence      │
   │ Selection    │
   └──────────────┘
   ```

**Recommendation:** Header area - cleaner, doesn't clutter card content

---

## Card Content Details

### Step 2: Left Card - Cadence Selection

**Content:**
- Title: "How often?"
- Radio cards:
  - Twice Daily (recommended) - highlighted
  - Daily
  - Every Other Day
  - Weekly
- Each card: Name + brief description

**Style:** Same card structure (`bg-white/5`, `border-white/10`)

### Step 2: Middle Card - Time Selection

**Content:**
- Title: "When?"
- Conditional:
  - If "Twice Daily": Two time pickers
  - Otherwise: Single time picker
- Timezone display: "Your timezone: [auto-detected]"
- Optional: Timezone override dropdown

**Style:** Same card structure

### Step 2: Right Card - Style Selection

**Content:**
- Title: "Digest Style"
- Three style cards:
  - Morning Brief
  - Deep Read
  - Reference Mode
- Each card: Name + brief description
- Submit button: "Start Receiving Digests" (bottom)

**Style:** Same card structure

---

## Navigation Flow

```
Step 1: Newsletter Selection
  ↓ [Finalize Selection clicked]
  ↓ [Save selections to DB]
  ↓ [Success]
Step 2: Digest Configuration
  ↓ [Start Receiving Digests clicked]
  ↓ [Save config to DB]
  ↓ [Success]
Post-Onboarding Dashboard
  (Different page/state - no more onboarding cards)
```

**Back Button:**
- Step 2 → Step 1: `setOnboardingStep(1)`
- Step 1: No back button (or disabled)

---

## Implementation Checklist

### Phase 1: State Management
- [ ] Create `OnboardingFlow.tsx` client component
- [ ] Add `onboardingStep` state (1 | 2)
- [ ] Update `DashboardPage` to use `OnboardingFlow`

### Phase 2: Step 2 Cards
- [ ] Create `CadenceSelectionCard.tsx`
- [ ] Create `TimeSelectionCard.tsx`
- [ ] Create `StyleSelectionCard.tsx`
- [ ] Add back button in header

### Phase 3: Navigation
- [ ] Update `NewsletterSelectionCard` to call `setOnboardingStep(2)` after finalize
- [ ] Add back button handler to go to Step 1
- [ ] After Step 2 submit: Navigate to post-onboarding dashboard

### Phase 4: Backend
- [ ] Create `digest_configs` table
- [ ] Build `POST /api/digest/config`
- [ ] Build `GET /api/digest/config`

---

## Questions

1. **Back button location:** Header or inside card?
   - **Recommendation:** Header (cleaner)

2. **Step 1 cards visibility:** Hide Connect Gmail / Backfill cards in Step 2?
   - **Recommendation:** Yes, replace all 3 cards with Step 2 content

3. **After Step 2:** Navigate to new route or show different dashboard state?
   - **Recommendation:** Same `/dashboard` route, but show post-onboarding content (check for `digest_configs`)

**Ready to implement?** Confirm preferences and I'll build it.
