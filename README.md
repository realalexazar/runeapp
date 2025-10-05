### Stack
- **Framework**: Next.js (App Router, TypeScript)
- **UI**: Tailwind CSS, shadcn/ui, Radix
- **Auth/DB**: Supabase (`@supabase/ssr`)
- **Tooling**: ESLint, Prettier, Vitest, GitHub Actions, Docker

### Prerequisites
- Node 18.18+ (Node 20 recommended)
- pnpm (Corepack: `corepack enable && corepack prepare pnpm@latest --activate`)

### Setup
1. Create `.env.local` with:
   - `NEXT_PUBLIC_SUPABASE_URL="https://<project-id>.supabase.co"`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"`

2. Install dependencies
   ```bash
   pnpm install
   ```

3. Start dev server
   ```bash
   pnpm dev
   ```

Open `http://localhost:3000`.

### OAuth callback
Google OAuth client redirect URIs:
- `http://localhost:3000/api/connect/gmail/callback` (development)
- `https://<your-vercel-domain>/api/connect/gmail/callback` (preview/prod)

### Available scripts
- `pnpm dev`: start dev server
- `pnpm build`: production build
- `pnpm start`: run production server
- `pnpm typecheck`: TypeScript type-check
- `pnpm lint`: run ESLint
- `pnpm lint:fix`: fix lint errors
- `pnpm format`: format with Prettier
- `pnpm format:check`: check formatting
- `pnpm test`: run unit tests (Vitest)
- `pnpm test:watch`: watch mode

### Structure
- `app/` App Router routes, layouts, middleware-protected dashboard
- `lib/supabase/` Supabase clients (browser/server) using cookie-based auth
- `app/api/connect/gmail/start` and `.../callback` OAuth flow for Gmail (readonly)
- `app/api/backfill/start` Backfill Gmail (Primary + Updates, last 30 days) with pagination
- `app/api/parse/run` Parse unprocessed emails, sanitize HTML/text, detect newsletters
- `app/api/backfill/progress` Lightweight progress endpoint (counts `messages_raw`)
- `components/BackfillParseControls` Dashboard control for Backfill/Parse with inline results
- `lib/env.ts` runtime env validation with Zod

### CI
GitHub Actions workflow runs typecheck, lint, tests, and build. Set secrets:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Backfill & Parse (local testing)

1) Connect Gmail from the dashboard (readonly scope).
2) Click "Start Backfill". This paginates Gmail and ingests raw emails:
   - Scope: Primary + Updates, last 30 days
   - Idempotent upserts to `messages_raw`
   - Raw MIME saved under `emails-raw/<userId>/<gmailId>.eml`
   - Live progress shown via `/api/backfill/progress`
3) Click "Parse Once" or "Parse Until Done" with a limit (default 100, 1–500 accepted). This:
   - Parses unprocessed rows from `messages_raw`
   - Sanitizes HTML, generates text, detects newsletter signals
   - Saves cleaned files under `emails-clean/<userId>/<rawId>.(html|txt)`
   - Upserts into `messages_clean` with `is_newsletter` and `signals`

Notes:
- Re-running Backfill/Parse is safe (idempotent).
- Parse returns `{ ok, parsed, errors }`. When `parsed` is 0 repeatedly, the backlog is drained.

### Docker
Build and run locally:
```bash
docker build -t mortgage-app .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  mortgage-app
```

### B2C now, B2B later
- B2C auth is configured with Supabase and middleware-protected routes.
- For B2B multi-tenant, plan to add an `organization_id` claim to JWT and use RLS policies in Supabase; route structure can add `/(app)/[orgId]/...` without major changes.
