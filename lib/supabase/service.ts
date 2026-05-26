import { createClient } from "@supabase/supabase-js";

// This client is intended for server-side use ONLY, for background jobs, cron jobs, etc.
// It uses the Supabase service role key and bypasses all RLS policies.
type SupabaseServiceClient = ReturnType<typeof createClient<any, "public", any>>

let serviceRoleClient: SupabaseServiceClient | null = null

export function getSupabaseServiceRole(): SupabaseServiceClient {
  if (!serviceRoleClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase service role environment variables")
    }

    serviceRoleClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })
  }

  return serviceRoleClient
}

export const supabaseServiceRole = new Proxy({} as SupabaseServiceClient, {
  get(_target, prop) {
    const client = getSupabaseServiceRole()
    const value = Reflect.get(client, prop)
    return typeof value === "function" ? value.bind(client) : value
  }
}) as SupabaseServiceClient
