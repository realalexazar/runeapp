# Rune Design System: Minimalistic Sophistication

## Core Design Philosophy

**Principle:** Minimalistic but sophisticated - clean, purposeful, elegant
- Every element serves a purpose
- No unnecessary decoration
- Sophistication through restraint, not complexity

---

## Visual Design Language

### Color Palette

**Backgrounds:**
- **Primary Background:** Very dark (`#0B0B0F` or similar) - Main app background
- **Card Background:** `bg-white/5` (5% white opacity) - Elevated cards
- **Card Border:** `border-white/10` (10% white opacity) - Card borders
- **Button Background:** `bg-white/15` (15% white opacity) - Interactive elements
- **Button Hover:** `hover:bg-white/25` (25% white opacity) - Button hover state

**Text:**
- **Primary Text:** `text-white` (`#ffffff`) - Main content, headings
- **Secondary Text:** `text-white/80` (80% white opacity) - Medium importance text
- **Muted Text:** `text-white/60` (60% white opacity) - Supporting text, metadata
- **Very Muted:** `text-white/50` (50% white opacity) - Less important info (e.g., counts)

**Accents:**
- **Success/Positive:** `bg-emerald-500/20 text-emerald-200` - Status indicators (e.g., "Connected")
- **Error:** `bg-red-500/15 text-red-300` - Error messages
- **Interactive:** Blue checkboxes (native browser styling) - Checkboxes
- **Brand:** Purple gradients (`rgba(168,85,247,0.15)`, `rgba(59,130,246,0.15)`) - Decorative gradients

### Typography

**Headings:**
- Bold white text
- Clear hierarchy (size differentiation)
- Minimal font weights (regular, bold)

**Body Text:**
- Clean, readable sans-serif
- Consistent line height
- White/light grey for contrast

**Metadata:**
- Smaller font size
- Lighter grey color
- Used for domains, counts, timestamps

### Layout Principles

**Card-Based Design:**
- Cards with rounded corners
- Light grey background on dark background
- Clear boundaries (subtle borders or shadows)
- Consistent padding and spacing

**Grid System:**
- Horizontal card layout (3-column on desktop)
- Responsive stacking on mobile
- Generous whitespace between elements

**Spacing:**
- Consistent padding within cards
- Generous margins between cards
- Breathing room around content

### Component Patterns

**Cards:**
- Rounded corners
- Light grey background
- White text headings
- Clear section divisions (if multi-section)
- Action buttons at bottom (dark grey)

**Status Indicators:**
- Small pill-shaped badges
- Green background for positive states
- White text
- Positioned near relevant content

**Buttons:**
- Dark grey background
- White text
- Rounded corners (pill-shaped or rounded rectangle)
- Clear hover states (subtle brightness change)

**Checkboxes:**
- Blue accent color
- White checkmark
- Clear selected/unselected states

**Lists:**
- Scrollable containers (visible scrollbar)
- Consistent item spacing
- Clear visual hierarchy (bold names, smaller metadata)

### Interaction Patterns

**Hover States:**
- Subtle brightness/opacity changes
- No dramatic color shifts
- Maintains sophistication

**Loading States:**
- Minimal spinners or progress indicators
- Don't disrupt layout
- Clear feedback without noise

**Empty States:**
- Clean, minimal messaging
- Helpful but not verbose
- Maintains visual hierarchy

---

## UI Component Specifications

### Card Structure
```
┌─────────────────────────────────┐
│ [Icon] Title          [Badge]   │
│                                   │
│ Description text                  │
│                                   │
│ [Action Button]                  │
└─────────────────────────────────┘
```

**Spacing:**
- Padding: `p-6` (24px / 1.5rem) - Card padding
- Gap between elements: `space-y-6` (24px vertical), `gap-3` (12px horizontal)
- Border radius: `rounded-2xl` (16px / 1rem) - Card corners
- Section dividers: `h-px w-full bg-white/10` - Horizontal dividers

### Button Styles
- **Primary:** Dark grey background, white text
- **Secondary:** Transparent/outlined (if needed)
- **Size:** Comfortable touch targets (44px height)
- **Padding:** Horizontal ~24px, Vertical ~12px

### List Items
- **Structure:** Checkbox + Name + Metadata
- **Spacing:** ~12-16px between items
- **Alignment:** Left-aligned content, right-aligned metadata

### Status Badges
- **Shape:** Pill-shaped (rounded full)
- **Size:** Small, compact
- **Padding:** ~4px horizontal, ~2px vertical
- **Colors:** Green for positive, grey for neutral

---

## Design Tokens

### Spacing Scale
- `xs`: 4px
- `sm`: 8px
- `md`: 16px
- `lg`: 24px
- `xl`: 32px
- `2xl`: 48px

### Border Radius
- `sm`: `rounded-md` (6px) - Small elements, buttons
- `md`: `rounded-lg` (8px) - Medium elements
- `lg`: `rounded-xl` (12px) - Large elements
- `xl`: `rounded-2xl` (16px) - Cards (PRIMARY)
- `full`: `rounded-full` (9999px) - Pills, badges

### Typography Scale
- `xs`: 12px (metadata)
- `sm`: 14px (secondary text)
- `base`: 16px (body text)
- `lg`: 18px (subheadings)
- `xl`: 20px (card titles)
- `2xl`: 24px (page titles)

---

## Application to Future Screens

### Digest Configuration Screen
- **Layout:** Single centered card or full-width card
- **Form Elements:** Radio buttons styled as cards (cadence selection)
- **Time Pickers:** Minimal, dark-themed
- **Style Selection:** Card-based selection (3 cards side-by-side)
- **Maintain:** Same color scheme, spacing, typography

### Dashboard (Post-Onboarding)
- **Layout:** Similar 3-card grid (or adapted for content)
- **Upcoming Digest Card:** Light grey card, white text
- **Recent Digests List:** Scrollable list, same styling as newsletter selection
- **Settings Button:** Dark grey button, consistent with existing buttons

### Digest Detail View
- **Header:** White text, minimal styling
- **Content:** Formatted digest, maintains readability
- **Actions:** Dark grey buttons, consistent with existing
- **Navigation:** Subtle previous/next controls

### Settings Screen
- **Sections:** Light grey cards, white headings
- **Form Elements:** Consistent with configuration screen
- **Lists:** Same styling as newsletter selection list

---

## Do's and Don'ts

### ✅ Do:
- Use dark backgrounds with light text
- Maintain consistent spacing
- Use subtle color accents sparingly
- Keep cards clean and uncluttered
- Use white/light grey for primary text
- Maintain generous whitespace
- Use rounded corners consistently

### ❌ Don't:
- Add unnecessary decorative elements
- Use bright, saturated colors (except accents)
- Overcrowd cards with information
- Use multiple font families
- Add heavy shadows or borders
- Use light backgrounds
- Compromise whitespace for content

---

## Implementation Notes

**Tailwind Classes (Actual Implementation):**
```css
/* Cards */
.card-base {
  @apply rounded-2xl border border-white/10 bg-white/5 p-6 text-white;
}

/* Buttons */
.button-primary {
  @apply rounded-md bg-white/15 px-4 py-2 text-white hover:bg-white/25 disabled:opacity-50;
}

/* Text Hierarchy */
.text-primary { @apply text-white; }
.text-secondary { @apply text-white/80; }
.text-muted { @apply text-white/60; }
.text-very-muted { @apply text-white/50; }

/* Status Badges */
.badge-success {
  @apply rounded-full px-3 py-1 text-xs font-medium bg-emerald-500/20 text-emerald-200;
}

.badge-error {
  @apply rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300;
}

/* Dividers */
.divider {
  @apply h-px w-full bg-white/10;
}
```

**Component Library Approach:**
- Build reusable components matching this system
- Maintain consistency across web and mobile (React Native)
- Use design tokens for all spacing, colors, typography

---

## Examples from Current UI

**Connect Gmail Card:**
- `bg-white/5` card background with `border-white/10`
- Purple gradient overlay (`rgba(168,85,247,0.15)`)
- White "Connect Gmail" heading (`text-white`)
- Green "Connected" badge (`bg-emerald-500/20 text-emerald-200`)
- `bg-white/15` button with `hover:bg-white/25`

**Newsletter Selection Card:**
- `bg-white/5` card background
- White headings (`text-white`) and muted text (`text-white/60`)
- Native checkboxes (browser default styling)
- Scrollable list (`max-h-[500px] overflow-y-auto`)
- `bg-white/15` "Finalize Selections" button
- Selected items: `bg-white/15 border border-white/20`

**Backfill/Classify Card:**
- `bg-white/5` card background
- Two sections separated by `h-px w-full bg-white/10` divider
- White headings (`text-lg font-medium text-white`)
- `bg-white/15` action buttons
- Muted status text (`text-white/70 text-sm`)

---

## Next Steps

1. **Extract exact color values** from current UI (if needed)
2. **Create component library** matching this system
3. **Apply to all future screens** (Digest Config, Dashboard, Settings, etc.)
4. **Maintain consistency** across web and mobile

**Key Principle:** If it doesn't look like it belongs in the current dashboard, it doesn't belong in Rune.
