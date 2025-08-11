"use client"

import { createBrowserClient } from "@supabase/ssr"
import { env } from "@/lib/env"

// Returns a browser Supabase client wired for cookie-based auth via @supabase/ssr
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}


