import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { htmlToText } from "html-to-text"
import sanitizeHtml from "sanitize-html"
import { simpleParser } from "mailparser"
// v6.3: Use onboarding snapshot promotion; disable per-message auto-single promotion for parity
const ENABLE_AUTO_SINGLE_PROMOTE = false

// Reuse helpers from parse/run by duplicating minimal logic to avoid cross-file exports
import { toRegistrableDomain, isEspDomain } from "@/lib/newsletters/domain"
import { ESP_REGISTRABLE_BLOCKLIST, telemetry } from "@/lib/newsletters/config"
import { createHash } from "crypto"

function tokenizeStructure(html: string): string[] {
  const tags = (html.match(/<\/?([a-zA-Z0-9]+)/g) || []).map(t => t.replace(/[<>/]/g, "").toLowerCase())
  const tokens: string[] = []
  for (let i = 0; i < tags.length; i++) {
    const a = tags[i]
    const b = tags[i + 1] || ""
    tokens.push(a)
    if (b) tokens.push(`${a}>${b}`)
  }
  return tokens
}
function hash64Bytes(token: string): Uint8Array { const h = createHash("sha256").update(token).digest(); return new Uint8Array(h.buffer, h.byteOffset, 8) }
function computeSimHashHex(tokens: string[]): string {
  const weights = new Array<number>(64).fill(0)
  for (const t of tokens) {
    const bytes = hash64Bytes(t)
    for (let byteIdx = 0; byteIdx < 8; byteIdx++) {
      const b = bytes[byteIdx]
      for (let bit = 0; bit < 8; bit++) {
        const pos = byteIdx * 8 + bit
        const mask = 1 << (7 - bit)
        weights[pos] += (b & mask) !== 0 ? 1 : -1
      }
    }
  }
  const outBytes = new Uint8Array(8)
  for (let byteIdx = 0; byteIdx < 8; byteIdx++) {
    let val = 0
    for (let bit = 0; bit < 8; bit++) {
      const pos = byteIdx * 8 + bit
      val = (val << 1) | (weights[pos] >= 0 ? 1 : 0)
    }
    outBytes[byteIdx] = val
  }
  return Array.from(outBytes).map(b => b.toString(16).padStart(2, "0")).join("")
}
function shannonEntropy(values: string[]): number {
  if (values.length === 0) return 0
  const freq = new Map<string, number>()
  for (const v of values) freq.set(v, (freq.get(v) || 0) + 1)
  const n = values.length
  let H = 0
  for (const c of freq.values()) { const p = c / n; H += -p * Math.log2(p) }
  return Number(H.toFixed(3))
}

function hexToBytes(hex: string): number[] {
  const out: number[] = []
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
  return out
}

const POPCOUNT_TABLE: number[] = (() => {
  const t = new Array<number>(256)
  for (let i = 0; i < 256; i++) { let c = 0, v = i; while (v) { v &= v - 1; c++ } t[i] = c }
  return t
})()

function hammingDistanceHex(a: string, b: string): number {
  const ab = hexToBytes(a)
  const bb = hexToBytes(b)
  const n = Math.min(ab.length, bb.length)
  let d = 0
  for (let i = 0; i < n; i++) d += POPCOUNT_TABLE[ab[i] ^ bb[i]]
  for (let i = n; i < ab.length; i++) d += POPCOUNT_TABLE[ab[i]]
  for (let i = n; i < bb.length; i++) d += POPCOUNT_TABLE[bb[i]]
  return d
}

function applyBeaconV4Lite(inputs: any) {
  // Minimal reuse: expect same fields as parse/run's applyBeaconV4
  const { signals, features, subject, senderCounts30d, minSpacingDays, hostEntropyMinOverride } = inputs
  const HOST_ENTROPY_MIN_DEFAULT = 1.2
  const TEXT_TO_LINK_RATIO_COLDSTART_MIN = 200
  const BODY_LEN_COLDSTART_MIN = 700

  const reasons: string[] = []
  let positive = 0
  let negative = 0
  const components: Record<string, number> = {}
  if (signals.listId) {
    positive += 3
    reasons.push("list-id header present")
    components.list_id = (components.list_id ?? 0) + 3
  }
  if (signals.listUnsubscribe) {
    positive += 2
    reasons.push("list-unsubscribe present")
    components.list_unsubscribe = (components.list_unsubscribe ?? 0) + 2
  }
  if (signals.listUnsubscribeOneClick) {
    positive += 1
    reasons.push("one-click unsubscribe")
    components.one_click = (components.one_click ?? 0) + 1
  }
  if (signals.viewInBrowser) { positive += 1; reasons.push("view in browser"); components.view_in_browser = (components.view_in_browser ?? 0) + 1 }
  if (signals.postalAddress) { positive += 1; reasons.push("postal address footer"); components.postal_address = (components.postal_address ?? 0) + 1 }
  if (features.i18n_unsubscribe_present) { positive += 1; reasons.push("i18n unsubscribe"); components.i18n_unsubscribe = (components.i18n_unsubscribe ?? 0) + 1 }
  if (features.esp_fingerprint) { positive += 1; reasons.push("ESP fingerprint"); components.esp_fingerprint = (components.esp_fingerprint ?? 0) + 1 }
  if (features.link_count > 8) { positive += 1; reasons.push("many links"); components.many_links = (components.many_links ?? 0) + 1 }
  if (features.tracking_pixel_present) { positive += 1; reasons.push("tracking pixel"); components.tracking_pixel = (components.tracking_pixel ?? 0) + 1 }
  // Subject cues: align with parse
  const subjectCue = /(newsletter|digest|round\s?up|round-up)/i.test(subject || "")
  if (subjectCue) { positive += 0.5; reasons.push("subject cue"); components.subject_cue = (components.subject_cue ?? 0) + 0.5 }
  const transactional = /\b(order|receipt|invoice|otp|verification code|password reset|tracking number|ticket)\b/i.test(subject || "")
  if (transactional && !signals.listId && !signals.listUnsubscribe) { negative += 3; reasons.push("transactional terms without list headers") }
  const hostEntropyThreshold = typeof hostEntropyMinOverride === 'number' && !Number.isNaN(hostEntropyMinOverride)
    ? hostEntropyMinOverride
    : HOST_ENTROPY_MIN_DEFAULT
  const hostEntropyOk = features.host_entropy >= hostEntropyThreshold
  if (hostEntropyOk) { positive += 1; reasons.push("high host entropy"); components.entropy_ok = (components.entropy_ok ?? 0) + 1 } else { negative += 1 }
  if (minSpacingDays != null) { if (minSpacingDays <= 2) { positive += 1; reasons.push("near-daily cadence"); components.cadence = (components.cadence ?? 0) + 1 } else if (minSpacingDays <= 9) { positive += 1; reasons.push("weekly/biweekly cadence"); components.cadence = (components.cadence ?? 0) + 1 } }
  const coldStart = (senderCounts30d || 0) <= 1
  const textToLink = features.body_char_len / Math.max(1, features.link_count)
  if (coldStart) {
    const hasFooterOrEsp = !!(signals.listUnsubscribe || signals.unsubscribeLink || signals.managePrefs || signals.postalAddress || features.esp_fingerprint)
    const hasVolume = (features.body_char_len >= BODY_LEN_COLDSTART_MIN) || (textToLink >= TEXT_TO_LINK_RATIO_COLDSTART_MIN)
    if (!(hasFooterOrEsp && hasVolume && hostEntropyOk)) {
      return { isNewsletter: false, confidence: 0.12, classifierSource: "rule", reasons: { top_reasons: [], why_not_top: "cold-start: insufficient footer/volume/entropy", features: { host_entropy: features.host_entropy, text_to_link_ratio: Number(textToLink.toFixed(3)) }, applied_rules: ['cold_start_gate'], meta: { mapping: 'gate:cold_start' } } }
    }
    reasons.push("cold-start satisfied"); components.cold_start_satisfied = (components.cold_start_satisfied ?? 0) + 1
    // ensure tag is present for downstream audit/reconstruction
    if (Array.isArray((reasons as any).applied_rules)) {
      const ar = (reasons as any).applied_rules as string[]
      if (!ar.includes('cold_start_satisfied')) ar.push('cold_start_satisfied')
    } else {
      (reasons as any).applied_rules = ['cold_start_satisfied']
    }
    positive += 1
  }
  const negPenalty = Math.max(0, negative - 1)
  if (negPenalty > 0) components.negative_penalty = (components.negative_penalty ?? 0) - negPenalty
  const score = Math.max(0, positive - negPenalty)
  const isNewsletter = score >= 3 || signals.listId === true
  // Logistic mapping to match parse
  // Ensure components is summable even when empty
  if (Object.keys(components).length === 0) {
    components.baseline = 0
  }
  const logistic = (x: number) => 1 / (1 + Math.exp(-1.2 * (x - 3)))
  const confidence = Number(Math.max(0, Math.min(1, logistic(score))).toFixed(2))
  const meta: any = { mapping: 'logistic_v1', score: String(score), components }
  return { isNewsletter, confidence, classifierSource: "rule", reasons: { top_reasons: reasons.slice(0,2), why_not_top: isNewsletter ? undefined : (hostEntropyOk ? "signals insufficient" : "low host entropy"), features: { host_entropy: features.host_entropy, text_to_link_ratio: Number(textToLink.toFixed(3)), link_count: features.link_count, tracking_pixel_present: features.tracking_pixel_present }, meta } }
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let limit = 200
  let rebuildRollups = true
  try {
    const body = await req.json()
    if (body && typeof body.limit === 'number') limit = Math.max(1, Math.min(500, Math.floor(body.limit)))
    if (body && body.rebuildRollups === false) rebuildRollups = false
  } catch {}

  // Select candidate cleans that need re-enrich
  const { data: candidates, error: selErr } = await supabaseServiceRole
    .from("messages_clean")
    .select("id, raw_message_id, storage_path, html_url, text_url, headers_json, from_domain, sender_key, subject")
    .eq("user_id", user.id)
    // Re-enrich if version is old OR critical metadata missing (Beacon v6.1: include headers/features gaps)
    .or("classifier_version.is.null,classifier_version.neq.v6,sender_key.is.null,subject.is.null,headers_json.is.null,features_json.is.null")
    .limit(limit)

  if (selErr) return NextResponse.json({ ok: false, error: selErr.message })
  if (!candidates || candidates.length === 0) return NextResponse.json({ ok: true, selected: 0, updated: 0, remaining: 0 })

  let updated = 0
  const errors: Array<{ id: string, error: unknown }> = []

  for (const row of candidates as Array<any>) {
    try {
      const base = (row.storage_path ?? undefined) as string | undefined // e.g., emails-clean/{user}/{rawId}
      const htmlPath = row.html_url
        ? String(row.html_url).replace(/^emails-clean\//, "")
        : (typeof base === 'string' ? `${base}.html`.replace(/^emails-clean\//, "") : null)
      const txtPath = row.text_url
        ? String(row.text_url).replace(/^emails-clean\//, "")
        : (typeof base === 'string' ? `${base}.txt`.replace(/^emails-clean\//, "") : null)
      // Lookup raw storage path then parse raw .eml to rebuild headers and body; fallback to cleaned HTML/TXT if raw missing
      let rawKey: string | null = null
      try {
        let rawId: string | null = row.raw_message_id != null ? String(row.raw_message_id) : null
        if (rawId == null) {
          const candidateTail = (typeof base === 'string' ? base : (typeof htmlPath === 'string' ? htmlPath : null))
          if (candidateTail) {
            const parts = String(candidateTail).split('/')
            const last = parts[parts.length - 1].replace(/\.html$|\.txt$/i, '')
            if (/^\d+$/.test(last)) rawId = last
          }
        }
        if (rawId != null) {
          const rawRow = await supabaseServiceRole
            .from('messages_raw')
            .select('storage_path')
            .eq('id', rawId)
            .maybeSingle()
          const rawPath = rawRow.data?.storage_path || null
          if (rawPath) rawKey = rawPath.replace(/^emails-raw\//, "")
        }
      } catch {}

      let parsed: any = null
      let headers: Record<string, string | undefined> = {}
      let rawHtml: string = ""
      let cleanHtml: string = ""
      let text: string = ""

      if (rawKey) {
        const rawDl = await supabaseServiceRole.storage.from("emails-raw").download(rawKey)
        if (!rawDl.error && rawDl.data) {
          const rawBuf = Buffer.from(await rawDl.data.arrayBuffer())
          parsed = await simpleParser(rawBuf)
          if (parsed && parsed.headers) {
            for (const [k,v] of parsed.headers as any) headers[(k as string).toLowerCase()] = String(v)
          }
          rawHtml = parsed?.html ? String(parsed.html) : ""
          cleanHtml = sanitizeHtml(rawHtml, { allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img","table","thead","tbody","tr","td","th"]), allowedAttributes: { a:["href","name","target","rel"], img:["src","alt","width","height"] } })
          text = (parsed?.text as string) || htmlToText(cleanHtml, { wordwrap: 120 })
        }
      }
      if (!parsed) {
        // Fallback: use cleaned HTML/TXT from storage and existing headers_json
        try {
          if (htmlPath) {
            const dlHtml = await supabaseServiceRole.storage.from('emails-clean').download(htmlPath)
            if (!dlHtml.error && dlHtml.data) {
            cleanHtml = await dlHtml.data.text()
            }
          }
        } catch {}
        try {
          if (txtPath) {
            const dlTxt = await supabaseServiceRole.storage.from('emails-clean').download(txtPath)
            if (!dlTxt.error && dlTxt.data) {
            text = await dlTxt.data.text()
            }
          }
        } catch {}
        if (!cleanHtml && text) {
          // synthesize minimal HTML from text
          cleanHtml = `<pre>${text.replace(/</g,'&lt;')}</pre>`
        }
        const hj = (row.headers_json || {}) as Record<string, any>
        for (const k of Object.keys(hj)) headers[k.toLowerCase()] = (hj as any)[k]
      }
      const headerLines = (parsed as any)?.headerLines as Array<{ key: string; line: string }> | undefined
      const contentTypeRaw = headerLines?.find(h => h.key?.toLowerCase() === 'content-type')?.line

      // Sender fields
      const fromStructured = parsed?.from && Array.isArray((parsed as any).from?.value) && (parsed as any).from?.value?.[0] || null
      const fromEmail = fromStructured?.address || (headers["from"]?.match(/<([^>]+)>/)?.[1] || headers["from"]) || null
      const fromDomain = fromEmail && fromEmail.includes("@") ? fromEmail.split("@").pop()!.toLowerCase() : (row.from_domain || null)
      const rp = headers["return-path"] || ""
      const rpEmail = rp.replace(/[<>]/g, "").trim()
      const rpDomain = rpEmail.includes("@") ? (rpEmail.split("@").pop() || null) : null
      const dkimHeaders = ["dkim-signature"].map(k => headers[k]).filter(Boolean) as string[]
      const dCandidates: string[] = []
      for (const dh of dkimHeaders) { const m = dh.match(/\bd=([^;\s]+)/); if (m && m[1]) dCandidates.push(m[1].toLowerCase()) }
      const fromReg = toRegistrableDomain(fromDomain)
      let dkimDomain: string | null = null
      if (dCandidates.length > 0) {
        const aligned = dCandidates.find(d => toRegistrableDomain(d) === fromReg)
        dkimDomain = aligned || dCandidates.find(d => !isEspDomain(d)) || dCandidates[0]
      }
      const msgId = headers["message-id"] || ""
      const midMatch = msgId.match(/@([^>\s]+)>?$/)
      const midDomain = midMatch && midMatch[1] ? midMatch[1].toLowerCase() : null
      let chosen: string | null = null
      if (dkimDomain && !isEspDomain(dkimDomain)) chosen = dkimDomain
      else if (fromDomain) chosen = fromDomain
      else if (rpDomain && !isEspDomain(rpDomain)) chosen = rpDomain
      else if (midDomain) chosen = midDomain
      let senderKey = toRegistrableDomain(chosen)
      const beforeNorm = senderKey
      const normalizeRegistrableDup = (reg: string | null) => {
        if (!reg) return reg
        const parts = reg.toLowerCase().split('.')
        if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) parts.pop()
        return parts.join('.')
      }
      senderKey = normalizeRegistrableDup(senderKey)
      const subject = (parsed?.subject || row.subject || null)
      const receivedAtHeader = headers["date"]
      const receivedAt = receivedAtHeader ? new Date(receivedAtHeader).toISOString() : (parsed?.date ? new Date(parsed.date).toISOString() : null)

      const signals: Record<string, boolean> = {
        listId: !!headers["list-id"],
        listUnsubscribe: !!headers["list-unsubscribe"],
        listUnsubscribeOneClick: /one-click/i.test(String(headers["list-unsubscribe-post"]||"")),
        unsubscribeLink: /unsubscribe/i.test(`${cleanHtml}\n${text}`),
        managePrefs: /manage (preferences|prefs)/i.test(`${cleanHtml}\n${text}`),
        viewInBrowser: /view in browser/i.test(cleanHtml),
        postalAddress: /(\d+\s+\w+.*\n.*(USA|United States|UK|United Kingdom)|\bPO Box\b)/i.test(`${cleanHtml}\n${text}`),
        bulkPrecedence: /bulk|list/i.test(String(headers["precedence"]||"")),
        noReplyFrom: /no-?reply@/i.test(String(headers["from"]||""))
      }

      const linkMatches: RegExpMatchArray[] = [...cleanHtml.matchAll(/<a\s+[^>]*href=\"([^\"]+)\"/gi)]
      const links = linkMatches.map((m: RegExpMatchArray) => (m[1] ?? ""))
      const linkCount = links.length
      const linkHosts = links.map(l => { try { return new URL(l).hostname } catch { return "" } }).filter(Boolean)
      const hostEntropy = shannonEntropy(linkHosts)
      const features = {
        link_count: linkCount,
        external_link_ratio: linkCount > 0 ? Number((links.filter(h => /^https?:\/\//i.test(h)).length / linkCount).toFixed(3)) : 0,
        has_view_in_browser: /view in browser/i.test(cleanHtml),
        has_postal_address: /(\d+\s+\w+.*\n.*(USA|United States|UK|United Kingdom)|\bPO Box\b)/i.test(`${cleanHtml}\n${text}`),
        esp_fingerprint: /list-manage.com|sendgrid.net|mailgun.org|amazonses.com|mandrillapp.com|beehiiv.com|substack.com|campaign-archive|braze.com|blz.io|iterable.com|links.iterable.com|track.iterable.com|hubspot.com|hubspotemail.net|hs-analytics.net|hs-sites.com|exacttarget.com|marketingcloudapps.com|sfmc|createsend.com|cmail20.com|cmail19.com|cmail18.com|klaviyo.com|kmail-lists.com|klclick.com|klaviyo-mail.com|mlsend.com|mailerlite.com|customer.io|customeriomail.com/i.test(cleanHtml),
        tracking_pixel_present: /<img[^>]+(width=\"1\"[^>]*height=\"1\"|height=\"1\"[^>]*width=\"1\")[^>]*>/i.test(cleanHtml),
        body_char_len: text.length,
        link_host_count: new Set(linkHosts).size,
        host_entropy: hostEntropy,
        i18n_unsubscribe_present: /(désabonner|se désinscrire|cancelar suscripción|darse de baja|abbestellen|disiscriviti|cancelar assinatura|cancelar subscrição|afmelden|отподписаться|取消订阅|取消訂閱|退会|購読解除|구독취소|सदस्यता रद्द)/i.test(`${cleanHtml}\n${text}`)
      }

      const templateHash = computeSimHashHex(tokenizeStructure(cleanHtml))

      // Fetch sender profile for cadence and override inputs (Beacon v5)
      let counts30 = 0, spacing: number | null = null
      let overrideVal: boolean | null | undefined = null
      let overrideTtl: string | null | undefined = null
      if (row.sender_key) {
        const prof = await supabaseServiceRole
          .from('sender_profiles')
          .select('counts_30d, min_spacing_days, override_is_newsletter, override_ttl')
          .eq('user_id', user.id)
          .eq('sender_key', row.sender_key)
          .maybeSingle()
        if (prof.data) {
          counts30 = prof.data.counts_30d || 0
          spacing = prof.data.min_spacing_days as number | null
          overrideVal = (prof.data as any).override_is_newsletter as boolean | null | undefined
          overrideTtl = (prof.data as any).override_ttl as string | null | undefined
        }
      }

      // Time-invariant cold-start: recompute counts_30d relative to this message's received_at
      try {
        if (row.sender_key && receivedAt) {
          const priorWindowStart = new Date(Date.parse(receivedAt) - 30*24*60*60*1000).toISOString()
          const priorResp = await supabaseServiceRole
            .from('messages_clean')
            .select('id', { head: true, count: 'exact' })
            .eq('user_id', user.id)
            .eq('sender_key', row.sender_key)
            .gte('received_at', priorWindowStart)
            .lt('received_at', receivedAt)
          counts30 = (priorResp.count as number) ?? counts30
        }
      } catch {}

      const subjectStr = subject || ''
      // Time-invariant per-sender P40 host entropy (only prior rows)
      let hostEntropyP40: number | null = null
      try {
        if (row.sender_key && receivedAt) {
          const priorEnt = await supabaseServiceRole
            .from('messages_clean')
            .select('features_json, received_at')
            .eq('user_id', user.id)
            .eq('sender_key', row.sender_key)
            .lt('received_at', receivedAt)
            .order('received_at', { ascending: false })
            .limit(50)
          const vals = (priorEnt.data || [])
            .map(r => (r as any).features_json?.host_entropy)
            .filter((x: any) => typeof x === 'number' && !Number.isNaN(x)) as number[]
          if (vals.length > 5) {
            const sorted = vals.slice().sort((a, b) => a - b)
            const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(0.40 * (sorted.length - 1))))
            hostEntropyP40 = Number(sorted[idx].toFixed(3))
          }
        }
      } catch {}
      // Override gate (Beacon v5)
      const overrideActive = (() => {
        if (overrideVal == null) return false
        if (!overrideTtl) return true
        const exp = Date.parse(overrideTtl)
        if (Number.isNaN(exp)) return true
        return Date.now() <= exp
      })()
      let isNewsletter: boolean
      let confidence: number
      let classifierSource: string
      let reasons: any
      if (overrideActive) {
        isNewsletter = !!overrideVal
        confidence = 0.99
        classifierSource = 'rule'
        const ar: string[] = ['auto_promote']
        reasons = { top_reasons: ['auto promotion'], features: { host_entropy: features.host_entropy, text_to_link_ratio: Number((features.body_char_len/Math.max(1,features.link_count)).toFixed(3)), link_count: features.link_count, tracking_pixel_present: features.tracking_pixel_present }, applied_rules: ar }
      } else {
        // Transactional suppression gate (Beacon v5)
        const autoSubmitted = /auto-?submitted/i.test(String(headers["auto-submitted"] || headers["Auto-Submitted"] || ""))
        const contentType = String(headers["content-type"] || headers["Content-Type"] || "")
        const dsn = /delivery-status|multipart\/(report)/i.test(contentType) || /mailer-daemon|postmaster/i.test(String(headers["from"] || ""))
        const txnTerms = /\b(receipt|invoice|order|shipment|shipping|tracking number|reservation|booking|itinerary|pickup|drop[- ]?off|confirm(?:ed|ation)?|otp|2fa|verification code|password reset|login alert)\b/i
          .test(subjectStr || text || "")
        const txnSubject = /^(your\s+)?(order|order\s+#|order\s+confirmation|receipt|invoice|payment|delivered:|delivered\s*:|shipped:|shipped\s*:|tracking|tracking\s+number|reservation|booking|itinerary|pickup|drop[- ]?off|confirm(?:ed|ation)?)/i.test(subjectStr || "")
          || /(otp|2fa|verification code|password reset|login alert|account (?:alert|notice))/i.test(subjectStr || "")
        if (autoSubmitted || dsn || txnSubject) {
          isNewsletter = false
          confidence = 0.98
          classifierSource = 'rule'
          reasons = {
            top_reasons: [],
            why_not_top: 'transactional_signal',
            features: {
              host_entropy: features.host_entropy,
              text_to_link_ratio: Number((features.body_char_len/Math.max(1,features.link_count)).toFixed(3)),
              link_count: features.link_count,
              tracking_pixel_present: features.tracking_pixel_present
            },
            applied_rules: ['transactional_suppression']
          }
        } else {
          // Headline alert suppression (Beacon v5.2)
          const isAlert = /^(breaking|news alert|breaking news)\b/i.test(subjectStr || "")
          const thin = features.body_char_len < 700 || /read more/i.test(cleanHtml + "\n" + text)
          const lowDiversity = (features.link_host_count <= 2) || (features.host_entropy < 0.6)
          if (!signals.listId && !signals.listUnsubscribe && isAlert && thin && lowDiversity) {
            isNewsletter = false
            confidence = 0.9
            classifierSource = 'rule'
            reasons = {
              top_reasons: [],
              why_not_top: 'headline_alert',
              features: {
                host_entropy: features.host_entropy,
                text_to_link_ratio: Number((features.body_char_len/Math.max(1,features.link_count)).toFixed(3)),
                link_count: features.link_count,
                tracking_pixel_present: features.tracking_pixel_present
              },
              applied_rules: ['headline_alert_suppression']
            }
          } else {
      const r = applyBeaconV4Lite({ signals, features, subject: subjectStr, senderCounts30d: counts30, minSpacingDays: spacing, hostEntropyMinOverride: hostEntropyP40 })
          // LO/HI confidence gating mirrored from parse/run
          const LO = 0.15, HI = 0.85
          let p = typeof r.confidence === 'number' ? r.confidence : Number(r.confidence)
          if (Number.isNaN(p)) p = 0.5
          let gatedIs = r.isNewsletter
          if (p >= HI) gatedIs = true
          else if (p <= LO) gatedIs = false
          // Similarity to up to K=3 centroids (Beacon v5.4)
          const centroidsRow = await supabaseServiceRole
            .from('sender_profiles')
            .select('template_centroids')
            .eq('user_id', user.id)
            .eq('sender_key', row.sender_key)
            .maybeSingle()
          const centroids: string[] = Array.isArray(centroidsRow.data?.template_centroids) ? (centroidsRow.data!.template_centroids as unknown as string[]) : []
          let bestH: number | null = null
          for (const c of centroids.slice(0, 3)) {
            if (!c || typeof c !== 'string') continue
            const h = hammingDistanceHex(templateHash, c)
            bestH = bestH == null ? h : Math.min(bestH, h)
          }
          const rApplied = Array.isArray((r as any).reasons?.applied_rules) ? (r as any).reasons.applied_rules : []
          if (bestH != null) {
            (r.reasons.features as any).template_hamming_distance = String(bestH)
            if (bestH <= 6 && !rApplied.includes('simhash_strong')) rApplied.push('simhash_strong')
            else if (bestH <= 9 && !rApplied.includes('simhash_weak')) rApplied.push('simhash_weak')
          }
          if (beforeNorm && senderKey && beforeNorm !== senderKey && !rApplied.includes('sender_key_normalized')) rApplied.push('sender_key_normalized')
          // Monthly cadence nudge (ENABLE_MONTHLY)
          if ((spacing != null && spacing >= 28 && spacing <= 33)) {
            (r.reasons.top_reasons as any[]).unshift('monthly cadence')
            if (!rApplied.includes('cadence_monthly')) rApplied.push('cadence_monthly')
          }
          isNewsletter = gatedIs
          confidence = Number(Math.max(0, Math.min(1, p)).toFixed(2))
          classifierSource = r.classifierSource
          const appliedRules: string[] = Array.isArray((r as any).reasons?.applied_rules) ? (r as any).reasons.applied_rules : []
          if (signals.listId || signals.listUnsubscribe || signals.listUnsubscribeOneClick) {
            if (!appliedRules.includes('strong_headers')) appliedRules.push('strong_headers')
          }
          if (features.i18n_unsubscribe_present || signals.unsubscribeLink || signals.managePrefs) {
            if (!appliedRules.includes('footer_i18n')) appliedRules.push('footer_i18n')
          }
          if (features.esp_fingerprint) {
            if (!appliedRules.includes('esp_fingerprint')) appliedRules.push('esp_fingerprint')
          }
          if (features.tracking_pixel_present) {
            if (!appliedRules.includes('tracking_pixel')) appliedRules.push('tracking_pixel')
          }
          if (features.has_view_in_browser || signals.viewInBrowser) {
            if (!appliedRules.includes('view_in_browser')) appliedRules.push('view_in_browser')
          }
          // Cadence tags based on spacing if available
          if (spacing != null) {
            if (spacing <= 2 && !appliedRules.includes('cadence_daily')) {
              (r.reasons.top_reasons as any[]).unshift('daily cadence')
              appliedRules.push('cadence_daily')
            } else if (spacing <= 9 && !appliedRules.includes('cadence_weekly')) {
              (r.reasons.top_reasons as any[]).unshift('weekly/biweekly cadence')
              appliedRules.push('cadence_weekly')
            }
          }
          // Subject cue tag for explainability
          if ((subjectStr || '').length > 0) {
            const subj = subjectStr || ''
            const hasCue = /(newsletter|digest|round\s?up|round-up)/i.test(subj)
            if (hasCue && !appliedRules.includes('subject_cue')) appliedRules.push('subject_cue')
          }
          const APPLIED_RULE_ORDER = [
            'user_override',
            'transactional_suppression',
            'headline_alert_suppression',
            'cold_start_gate',
            'cold_start_satisfied',
            'strong_headers',
            'footer_i18n',
            'esp_fingerprint',
            'tracking_pixel',
            'view_in_browser',
            'subject_cue',
            'simhash_strong',
            'simhash_weak',
            'cadence_daily',
            'cadence_weekly',
            'cadence_monthly',
            'sender_key_normalized',
            'model',
            'llm'
          ]
          const seen = new Set<string>()
          const ordered = (rApplied as string[])
            .filter((x: string) => !!x && !seen.has(x) && (seen.add(x), true))
            .sort((a: string, b: string) => {
              const ia = APPLIED_RULE_ORDER.indexOf(a); const ib = APPLIED_RULE_ORDER.indexOf(b)
              return (ia<0?999:ia) - (ib<0?999:ib)
            })
          reasons = { ...r.reasons, applied_rules: ordered }
          }
        }
      }

      // Auto-promote sender to newsletter for digest purposes on high-confidence positives (v6.1 parity)
      try {
        if (ENABLE_AUTO_SINGLE_PROMOTE && senderKey && isNewsletter && confidence >= 0.85) {
          // annotate this message as the promoter
          try {
            const metaPrev: any = (reasons as any).meta || {}
            const meta = { ...metaPrev, promoted_sender: true, promoted_confidence: Number(confidence.toFixed(2)), promotion_source: 'auto_single' }
            reasons = { ...reasons, meta }
          } catch {}
          await supabaseServiceRole
            .from('sender_profiles')
            .upsert({
              user_id: user.id,
              sender_key: senderKey,
              override_is_newsletter: true,
              override_ttl: null
            }, { onConflict: 'user_id,sender_key' })
        }
      } catch {}

      const { error: upErr } = await supabaseServiceRole
        .from('messages_clean')
        .update({
          template_hash: templateHash,
          features_json: features,
          is_newsletter: isNewsletter,
          confidence,
          classifier_source: classifierSource,
          headers_json: {
            list_id: headers["list-id"] || null,
            list_unsubscribe: headers["list-unsubscribe"] || null,
            precedence: headers["precedence"] || null,
            reply_to: headers["reply-to"] || null,
            message_id: headers["message-id"] || null,
            date: headers["date"] || null,
            auto_submitted: headers["auto-submitted"] || headers["Auto-Submitted"] || null,
            content_type: contentTypeRaw || headers["content-type"] || headers["Content-Type"] || null
          },
          sender_key: senderKey,
          from_email: fromEmail,
          from_domain: fromDomain,
          subject: subject,
          received_at: receivedAt,
          classifier_version: 'v6',
          reasons
        })
        .eq('id', row.id)

      if (upErr) { errors.push({ id: row.id, error: upErr }); continue }
      updated += 1
    } catch (e) {
      errors.push({ id: row.id, error: String(e) })
    }
  }

  // Optional one-shot rollup rebuild for parity with parse (counts/spacing/centroids/cadence)
  if (rebuildRollups) {
    try {
      const all = await supabaseServiceRole
        .from('messages_clean')
        .select('sender_key, received_at, template_hash')
        .eq('user_id', user.id)
      const items = (all.data || []).filter((r: any) => !!r.sender_key)
      const bySender = new Map<string, Array<{ receivedAt: Date, templateHash: string | null }>>()
      const now = new Date()
      const cutoff7 = new Date(now.getTime() - 7*24*60*60*1000)
      const cutoff30 = new Date(now.getTime() - 30*24*60*60*1000)
      for (const r of items) {
        const k = String(r.sender_key)
        const ra = new Date(r.received_at as unknown as string)
        const th = (r as any).template_hash || null
        const arr = bySender.get(k) || []
        arr.push({ receivedAt: ra, templateHash: typeof th === 'string' ? th : null })
        bySender.set(k, arr)
      }
      const upserts: any[] = []
      for (const [senderKey, list] of bySender.entries()) {
        const sorted = list.slice().sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
        const counts7 = sorted.reduce((acc, x) => acc + (x.receivedAt >= cutoff7 ? 1 : 0), 0)
        const counts30 = sorted.reduce((acc, x) => acc + (x.receivedAt >= cutoff30 ? 1 : 0), 0)
        const firstSeen = sorted[0]?.receivedAt?.toISOString() || null
        const lastSeen = sorted[sorted.length - 1]?.receivedAt?.toISOString() || null
        let minSpacingDays: number | null = null
        let sameDayBuckets30d = 0
        let prevDate: Date | null = null
        for (const x of sorted) {
          const d = new Date(Date.UTC(x.receivedAt.getUTCFullYear(), x.receivedAt.getUTCMonth(), x.receivedAt.getUTCDate()))
          if (prevDate) {
            const diffDays = Math.round((d.getTime() - prevDate.getTime()) / (24*60*60*1000))
            if (diffDays > 0) {
              minSpacingDays = minSpacingDays == null ? diffDays : Math.min(minSpacingDays, diffDays)
            }
          }
          prevDate = d
        }
        // same-day buckets over last 30d
        {
          const dayKey = (dt: Date) => `${dt.getUTCFullYear()}-${dt.getUTCMonth()+1}-${dt.getUTCDate()}`
          const countsByDay = new Map<string, number>()
          for (const x of sorted) {
            if (x.receivedAt >= cutoff30) {
              const key = dayKey(x.receivedAt)
              countsByDay.set(key, (countsByDay.get(key) || 0) + 1)
            }
          }
          for (const c of countsByDay.values()) sameDayBuckets30d += Math.max(0, c - 1)
        }
        // template centroids: latest 3 by last-seen time
        const lastByHash = new Map<string, number>()
        for (const x of sorted) {
          if (x.templateHash) {
            const ts = x.receivedAt.getTime()
            const prev = lastByHash.get(x.templateHash) || 0
            if (ts > prev) lastByHash.set(x.templateHash, ts)
          }
        }
        const centroids = Array.from(lastByHash.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([h]) => h)
        const cadenceFlags: string[] = []
        if (minSpacingDays != null) {
          if (minSpacingDays <= 2) cadenceFlags.push('daily')
          else if (minSpacingDays <= 9) cadenceFlags.push('weekly')
          else if (minSpacingDays <= 16) cadenceFlags.push('biweekly')
          else cadenceFlags.push('monthly')
        }
        upserts.push({
          user_id: user.id,
          sender_key: senderKey,
          counts_7d: counts7,
          counts_30d: counts30,
          first_seen_at: firstSeen,
          last_seen_at: lastSeen,
          min_spacing_days: minSpacingDays,
          same_day_buckets_30d: sameDayBuckets30d,
          template_centroids: centroids,
          cadence_flags: cadenceFlags,
          updated_at: new Date().toISOString()
        })
      }
      if (upserts.length > 0) {
        await supabaseServiceRole
          .from('sender_profiles')
          .upsert(upserts, { onConflict: 'user_id,sender_key' })
      }
    } catch {}
  }

  // Onboarding snapshot promotion (Beacon v6.3): promote stable newsletter senders based on 30d stats
  try {
    const since30 = new Date(Date.now() - 30*24*60*60*1000).toISOString()
    const { data: rows30 } = await supabaseServiceRole
      .from('messages_clean')
      .select('sender_key, received_at, confidence')
      .eq('user_id', user.id)
      .gte('received_at', since30)
    const perSender: Map<string, Array<{ d: Date, c: number }>> = new Map()
    for (const r of (rows30 || [])) {
      const k = (r as any).sender_key as string | null
      if (!k) continue
      const d = new Date((r as any).received_at as string)
      const cRaw = (r as any).confidence
      const c = typeof cRaw === 'number' ? cRaw : Number(cRaw)
      if (Number.isNaN(c)) continue
      const arr = perSender.get(k) || []
      arr.push({ d, c })
      perSender.set(k, arr)
    }
    const promote: Array<{ user_id: string, sender_key: string, override_is_newsletter: boolean, override_ttl: null }> = []
    for (const [senderKey, list] of perSender.entries()) {
      const msgs30 = list.length
      if (msgs30 === 0) continue
      const confs = list.map(x => x.c).sort((a, b) => a - b)
      const mid = Math.floor(confs.length / 2)
      const median = confs.length % 2 === 1 ? confs[mid] : (confs[mid - 1] + confs[mid]) / 2
      const hiDays = (() => {
        const days = new Set<string>()
        for (const x of list) {
          if (x.c >= 0.85) {
            const key = `${x.d.getUTCFullYear()}-${x.d.getUTCMonth()+1}-${x.d.getUTCDate()}`
            days.add(key)
          }
        }
        return days.size
      })()
      const rule = (msgs30 >= 4 && median >= 0.85) || (hiDays >= 2)
      if (rule) promote.push({ user_id: user.id, sender_key: senderKey, override_is_newsletter: true, override_ttl: null })
    }
    if (promote.length > 0) {
      await supabaseServiceRole
        .from('sender_profiles')
        .upsert(promote, { onConflict: 'user_id,sender_key' })
    }
  } catch {}

  // Remaining count uses the same predicate as selection (Beacon v6)
  const { count: remaining } = await supabaseServiceRole
    .from('messages_clean')
    .select('id', { head: true, count: 'exact' })
    .eq('user_id', user.id)
    .or('classifier_version.is.null,classifier_version.neq.v6,sender_key.is.null,subject.is.null')

  return NextResponse.json({ ok: true, selected: candidates.length, updated, remaining: remaining ?? 0, errors })
}


