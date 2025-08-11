### Stack
- **Framework**: Next.js 14 (App Router, TypeScript)
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
Set the Supabase Redirect URL to:
- `http://localhost:3000/auth/callback` (development)
- `https://your-domain.com/auth/callback` (production)

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
- `app/auth/callback/` OAuth code exchange route
- `lib/env.ts` runtime env validation with Zod

### CI
GitHub Actions workflow runs typecheck, lint, tests, and build. Set secrets:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

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
