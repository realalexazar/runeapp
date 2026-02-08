# Web vs App Strategy: Mental Model

## Distribution Strategy

**Primary Distribution:** App Store (iOS, eventually Android)
- Main user acquisition channel
- Primary user experience
- Native mobile app (React Native/Expo)

**Web's Role:** Marketing & Onboarding Tool
- Landing page (marketing, waitlist)
- Onboarding flow (Gmail connect, newsletter selection, digest config)
- Fallback for users who prefer web
- Testing platform during development

---

## Current State: Testing Platform

**What exists now:**
- **Dashboard (`app/(app)/dashboard/page.tsx`):** Testing interface for development
- **Purpose:** Visual aids for YOU to test onboarding flow conveniently
- **Not production-ready:** Built for testing, not end users
- **Components:** Connect Gmail card, Backfill/Classify controls, Newsletter Selection

**Why it exists:**
- Fast iteration during development
- Easy testing of backend functionality
- Visual feedback for classification results
- Not meant for end users (yet)

---

## Production Web: Marketing Tool

**Function:** Drive App Store downloads & handle onboarding

### Landing Page
- **Purpose:** Marketing, value proposition, waitlist
- **CTA:** "Download on App Store" (primary) + "Try on Web" (secondary)
- **Content:** What Rune does, benefits, social proof

### Onboarding Flow (Web)
- **Purpose:** Get users set up before/after app download
- **Flow:**
  1. Connect Gmail
  2. Newsletter selection
  3. Digest configuration
  4. "Download App" CTA (if not already downloaded)
- **Why web onboarding:** 
  - Easier to connect Gmail (OAuth flow)
  - Can complete setup on desktop
  - App can sync preferences via API

### Settings/Management (Web)
- **Purpose:** Fallback for users who prefer web
- **Features:** Edit preferences, manage newsletters, view digest history
- **Use case:** Power users, desktop users, web-first users

---

## Mobile App: Primary Experience

**Function:** Daily digest consumption, native experience

### Core Features
- **Digest View:** Read digests (same content as email)
- **Digest History:** Browse past digests
- **Settings:** Edit preferences (syncs with web)
- **Native LLM Querying:** Chat interface to query digests
- **Push Notifications:** "Your Rune is ready"

### Onboarding (App)
- **Can mirror web flow** OR
- **Simplified:** "Connect Gmail" → "Select Newsletters" → "Configure Digest"
- **Preference:** Keep it simple, match web flow for consistency

---

## Development Approach

### Phase 1: Build Web UI (Now)
**Strategy:** Build functional, good-looking web UI that:
- **Tests backend:** Validates all APIs work correctly
- **Looks professional:** Maintains design system (minimalistic sophistication)
- **Reusable patterns:** Components can inform app design
- **Not wasted work:** Web will exist in production (marketing/onboarding tool)

**What to build:**
1. **Digest Configuration UI** - Card-based, matches existing style
2. **Settings Page** - Edit preferences, manage newsletters
3. **Digest Detail View** - View individual digests
4. **Dashboard (Post-Onboarding)** - Upcoming digest, recent digests

**Design Principles:**
- Keep existing minimalistic style
- Build reusable components
- Think mobile-first (responsive)
- Components will inform app design

### Phase 2: Build App (Later)
**Strategy:** 
- **Reuse backend APIs** - Same endpoints, same data
- **Adapt UI patterns** - Take web components, adapt for React Native
- **Shared design system** - Same colors, spacing, typography
- **Consistent UX** - Same flows, same features

**What transfers:**
- ✅ API endpoints (no changes needed)
- ✅ Design system (colors, spacing, typography)
- ✅ UX flows (onboarding, settings, digest view)
- ✅ Component patterns (cards, lists, buttons)

**What's different:**
- React Native components (not React DOM)
- Navigation (React Navigation vs Next.js routing)
- Native features (push notifications, deep linking)

---

## Mental Model Summary

```
┌─────────────────────────────────────────┐
│         BACKEND (Shared)                │
│  APIs, Database, Digest Generation      │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
   ┌───▼───┐      ┌─────▼─────┐
   │  WEB  │      │    APP     │
   │       │      │            │
   │ Role: │      │ Role:      │
   │ • Mktg│      │ • Primary  │
   │ • Onbd│      │ • Daily UX │
   │ • Test│      │ • Native   │
   └───────┘      └────────────┘
```

**Current Dashboard:**
- Testing platform for development
- Not production-ready
- Visual aids for testing backend
- Will be replaced/refined for production

**Production Web:**
- Marketing tool (landing page)
- Onboarding flow (Gmail → Selection → Config)
- Settings/management (fallback)
- Drives App Store downloads

**Mobile App:**
- Primary distribution channel
- Daily digest consumption
- Native experience
- Syncs with web preferences

---

## Building Strategy

### For Web UI (Now):
1. **Build functional, good-looking UI** - Not throwaway code
2. **Maintain design system** - Same minimalistic style
3. **Think reusable** - Components inform app design
4. **Mobile-responsive** - Works on mobile browsers too
5. **Production-ready** - Will be used for marketing/onboarding

### For App (Later):
1. **Reuse backend** - Same APIs, no changes
2. **Adapt UI** - Take web patterns, convert to React Native
3. **Shared design** - Same colors, spacing, typography
4. **Consistent UX** - Same flows, same features

**Key Insight:** Web UI is NOT throwaway - it's a marketing tool AND a design reference for the app.

---

## Current Dashboard Status

**What it is:**
- ✅ Testing platform for development
- ✅ Visual aids for backend testing
- ✅ Functional but not production-ready
- ✅ Built for YOUR convenience, not end users

**What it will become:**
- Production onboarding flow (refined)
- Settings/management interface
- Marketing tool (landing page)

**What to build next:**
- Digest Configuration UI (matches existing style)
- Settings page (matches existing style)
- Digest Detail View (matches existing style)
- Keep it looking good - it's not throwaway!

---

## Questions Answered

**Q: Is current dashboard a testing platform?**
**A:** Yes - it's built for testing backend functionality, not end users. But it will inform production web UI.

**Q: What's the function of customer-facing website?**
**A:** Marketing tool (landing page) + Onboarding flow + Settings/management (fallback). Drives App Store downloads.

**Q: How to approach building UI since we'll remake it for app?**
**A:** Build good-looking, functional web UI that:
- Tests backend (validates APIs)
- Maintains design system (minimalistic sophistication)
- Informs app design (reusable patterns)
- Will be used in production (marketing/onboarding tool)

**Q: Should it look nice?**
**A:** Yes - it's not throwaway. It's a marketing tool AND a design reference for the app.
