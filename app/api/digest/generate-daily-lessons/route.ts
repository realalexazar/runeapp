import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { requireDevOrAdminRequest } from "@/lib/dev-route"
import { generateDailyLessons } from "@/lib/digest/generator"

export async function POST(req: Request) {
  const gated = requireDevOrAdminRequest(req)
  if (gated) return gated

  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const generatedAt = body.generated_at ? new Date(body.generated_at) : new Date()
    const items = await generateDailyLessons({
      userId: user.id,
      generatedAt,
      forceRegenerate: body.regenerate === true
    })

    return NextResponse.json({
      ok: true,
      generated_date: generatedAt.toISOString().slice(0, 10),
      module: "lessons",
      generated_count: items.length,
      items
    })
  } catch (e: any) {
    console.error("Error generating daily lessons:", e)
    return NextResponse.json({
      ok: false,
      error: String(e?.message || e)
    }, { status: 500 })
  }
}
