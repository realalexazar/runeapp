import { createClient } from "@supabase/supabase-js";

// This client is intended for server-side use ONLY, for background jobs, cron jobs, etc.
// It uses the Supabase service role key and bypasses all RLS policies.
export const supabaseServiceRole = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!, // server-only secret
  {
    auth: { persistSession: false },
  }
);
