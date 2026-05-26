import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { requireDevOrAdminRequest } from "@/lib/dev-route"

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ""
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    if (v == null) return ""
    const s = typeof v === "string" ? v : JSON.stringify(v)
    const needs = /[",\n]/.test(s)
    const body = s.replace(/"/g, '""')
    return needs ? `"${body}"` : body
  }
  const lines = [headers.join(",")]
  for (const r of rows) lines.push(headers.map(h => esc((r as any)[h])).join(","))
  return lines.join("\n")
}

export async function GET(req: Request) {
  const gated = requireDevOrAdminRequest(req)
  if (gated) return gated

  const { searchParams } = new URL(req.url)
  const format = (searchParams.get("format") || "csv").toLowerCase()
  const limitParam = Number(searchParams.get("limit") || "2000")
  const limit = Math.max(1, Math.min(5000, Math.floor(limitParam)))

  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabaseServiceRole
    .from("messages_clean")
    .select("id, is_newsletter, confidence, classifier_source, classifier_version, sender_key, subject, received_at, features_json, signals, reasons")
    .eq("user_id", user.id)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const rows = (data || []).map((r: any) => {
    const f = r.features_json || {}
    const sig = r.signals || {}
    const rs = r.reasons || {}
    const rules: string[] = Array.isArray(rs.applied_rules) ? rs.applied_rules as string[] : []
    const tmplH = (rs.features && (rs.features as any).template_hamming_distance) || null
    return {
      id: r.id,
      label_is_newsletter: r.is_newsletter === true,
      confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence || 0),
      classifier_source: r.classifier_source || null,
      classifier_version: r.classifier_version || null,
      sender_key: r.sender_key || null,
      subject: r.subject || null,
      received_at: r.received_at || null,
      link_count: f.link_count ?? null,
      external_link_ratio: f.external_link_ratio ?? null,
      host_entropy: f.host_entropy ?? null,
      body_char_len: f.body_char_len ?? null,
      link_host_count: f.link_host_count ?? null,
      tracking_pixel_present: f.tracking_pixel_present ?? null,
      i18n_unsubscribe_present: f.i18n_unsubscribe_present ?? null,
      has_view_in_browser: f.has_view_in_browser ?? null,
      has_postal_address: f.has_postal_address ?? null,
      esp_fingerprint: f.esp_fingerprint ?? null,
      text_to_link_ratio: (f.body_char_len && f.link_count != null) ? Number((f.body_char_len / Math.max(1, f.link_count)).toFixed(3)) : null,
      signal_list_id: sig.listId ?? null,
      signal_list_unsubscribe: sig.listUnsubscribe ?? null,
      signal_one_click: sig.listUnsubscribeOneClick ?? null,
      applied_rules: rules.join('|'),
      template_hamming_distance: tmplH
    }
  })

  if (format === "json") {
    return new NextResponse(JSON.stringify({ ok: true, count: rows.length, rows }), {
      headers: { "content-type": "application/json" }
    })
  }

  const csv = toCsv(rows)
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=features_${user.id}.csv`
    }
  })
}

