import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"

export async function GET() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rawCount = await supabaseServiceRole
    .from("messages_raw")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id)

  const cleanCount = await supabaseServiceRole
    .from("messages_clean")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id)

  const newsletterCount = await supabaseServiceRole
    .from("messages_clean")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id)
    .eq("is_newsletter", true)

  const raw = rawCount.count ?? 0
  const clean = cleanCount.count ?? 0
  const newsletters = newsletterCount.count ?? 0
  const remaining = Math.max(0, raw - clean)

  return NextResponse.json({ ok: true, raw, clean, newsletters, remaining })
}


