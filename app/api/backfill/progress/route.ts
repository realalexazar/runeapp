import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"

export async function GET() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sel = await supabaseServiceRole
    .from("messages_raw")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)

  const count = sel.count ?? 0

  const latest = await supabaseServiceRole
    .from("messages_raw")
    .select("provider_message_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ ok: true, count, latest: latest.data || null })
}


