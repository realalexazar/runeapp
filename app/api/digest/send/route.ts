import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { buildUnifiedDigest, persistFormattedDigest, renderDigestHtml, renderDigestText } from "@/lib/digest/formatter"
import { sendDigestEmail } from "@/lib/digest/email"
import { supabaseServiceRole } from "@/lib/supabase/service"

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const digestDate = body.digest_date || new Date().toISOString().slice(0, 10)
    let digestId = String(body.digest_id || "")

    if (!digestId) {
      const digest = await buildUnifiedDigest({
        userId: user.id,
        digestDate
      })
      const persisted = await persistFormattedDigest({
        userId: user.id,
        digestDate,
        htmlContent: renderDigestHtml(digest),
        textContent: renderDigestText(digest),
        metadata: {
          ...digest.metadata,
          sections: digest.sections.map((section) => section.type),
          subject: digest.subject
        }
      })
      digestId = persisted.id
    }

    const sendResult = await sendDigestEmail({
      userId: user.id,
      digestId,
      toEmail: body.to_email || null
    })

    const { data: digestRow } = await supabaseServiceRole
      .from("digests")
      .select("id, digest_date, status, sent_at, metadata")
      .eq("id", digestId)
      .single()

    return NextResponse.json({
      ok: true,
      digest: digestRow,
      send_result: sendResult
    })
  } catch (e: any) {
    console.error("Error sending digest:", e)
    return NextResponse.json({
      ok: false,
      error: String(e?.message || e)
    }, { status: 500 })
  }
}

