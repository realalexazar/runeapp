import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import {
  buildUnifiedDigest,
  persistFormattedDigest,
  renderDigestHtml,
  renderDigestText
} from "@/lib/digest/formatter"

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const digestDate = body.digest_date || new Date().toISOString().slice(0, 10)
    const digest = await buildUnifiedDigest({
      userId: user.id,
      digestDate
    })

    const html = renderDigestHtml(digest)
    const text = renderDigestText(digest)
    const persisted = await persistFormattedDigest({
      userId: user.id,
      digestDate,
      htmlContent: html,
      textContent: text,
      metadata: {
        ...digest.metadata,
        sections: digest.sections.map((section) => section.type),
        subject: digest.subject
      }
    })

    return NextResponse.json({
      ok: true,
      digest,
      persisted
    })
  } catch (e: any) {
    console.error("Error formatting digest:", e)
    return NextResponse.json({
      ok: false,
      error: String(e?.message || e)
    }, { status: 500 })
  }
}

