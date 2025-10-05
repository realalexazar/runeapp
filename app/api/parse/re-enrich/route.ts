import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { htmlToText } from "html-to-text"
import sanitizeHtml from "sanitize-html"
import { simpleParser } from "mailparser"

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
  const { signals, features, subject, senderCounts30d, minSpacingDays } = inputs
  const HOST_ENTROPY_MIN_DEFAULT = 1.2
  const TEXT_TO_LINK_RATIO_COLDSTART_MIN = 200
  const BODY_LEN_COLDSTART_MIN = 700

  const reasons: string[] = []
  let positive = 0
  let negative = 0
  if (signals.listId) { positive += 3; reasons.push("list-id header present") }
  if (signals.listUnsubscribe) { positive += 2; reasons.push("list-unsubscribe present") }
  if (signals.listUnsubscribeOneClick) { positive += 1; reasons.push("one-click unsubscribe") }
  if (signals.viewInBrowser) { positive += 1; reasons.push("view in browser") }
  if (signals.postalAddress) { positive += 1; reasons.push("postal address footer") }
  if (features.i18n_unsubscribe_present) { positive += 1; reasons.push("i18n unsubscribe") }
  if (features.esp_fingerprint) { positive += 1; reasons.push("ESP fingerprint") }
  if (features.link_count > 8) { positive += 1; reasons.push("many links") }
  if (features.tracking_pixel_present) { positive += 1; reasons.push("tracking pixel") }
  const transactional = /\b(order|receipt|invoice|otp|verification code|password reset|tracking number|ticket)\b/i.test(subject || "")
  if (transactional && !signals.listId && !signals.listUnsubscribe) { negative += 3; reasons.push("transactional terms without list headers") }
  const hostEntropyOk = features.host_entropy >= HOST_ENTROPY_MIN_DEFAULT
  if (hostEntropyOk) { positive += 1; reasons.push("high host entropy") } else { negative += 1 }
  if (minSpacingDays != null) { if (minSpacingDays <= 2) { positive += 1; reasons.push("near-daily cadence") } else if (minSpacingDays <= 9) { positive += 1; reasons.push("weekly/biweekly cadence") } }
  const coldStart = (senderCounts30d || 0) <= 1
  const textToLink = features.body_char_len / Math.max(1, features.link_count)
  if (coldStart) {
    const hasFooterOrEsp = !!(signals.listUnsubscribe || signals.unsubscribeLink || signals.managePrefs || signals.postalAddress || features.esp_fingerprint)
    const hasVolume = (features.body_char_len >= BODY_LEN_COLDSTART_MIN) || (textToLink >= TEXT_TO_LINK_RATIO_COLDSTART_MIN)
    if (!(hasFooterOrEsp && hasVolume && hostEntropyOk)) {
      return { isNewsletter: false, confidence: 0.12, classifierSource: "rule", reasons: { top_reasons: [], why_not_top: "cold-start: insufficient footer/volume/entropy", features: { host_entropy: features.host_entropy, text_to_link_ratio: Number(textToLink.toFixed(3)) } } }
    }
    reasons.push("cold-start satisfied"); positive += 1
  }
  const score = Math.max(0, positive - Math.max(0, negative - 1))
  const isNewsletter = score >= 3 || signals.listId === true
  const confidence = Number(Math.min(0.98, 0.2 + score * 0.12).toFixed(2))
  return { isNewsletter, confidence, classifierSource: "rule", reasons: { top_reasons: reasons.slice(0,2), why_not_top: isNewsletter ? undefined : (hostEntropyOk ? "signals insufficient" : "low host entropy"), features: { host_entropy: features.host_entropy, text_to_link_ratio: Number(textToLink.toFixed(3)), link_count: features.link_count, tracking_pixel_present: features.tracking_pixel_present } } }
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let limit = 200
  try { const body = await req.json(); if (body && typeof body.limit === 'number') limit = Math.max(1, Math.min(500, Math.floor(body.limit))) } catch {}

  // Select candidate cleans that need re-enrich
  const { data: candidates, error: selErr } = await supabaseServiceRole
    .from("messages_clean")
    .select("id, raw_message_id, storage_path, html_url, text_url, headers_json, from_domain, sender_key, subject")
    .eq("user_id", user.id)
    // Re-enrich if version is old OR critical metadata missing (Beacon v5b2)
    .or("classifier_version.is.null,classifier_version.neq.v5b2,sender_key.is.null,subject.is.null")
    .limit(limit)

  if (selErr) return NextResponse.json({ ok: false, error: selErr.message })
  if (!candidates || candidates.length === 0) return NextResponse.json({ ok: true, selected: 0, updated: 0, remaining: 0 })

  let updated = 0
  const errors: Array<{ id: string, error: unknown }> = []

  for (const row of candidates as Array<any>) {
    try {
      const base = row.storage_path as string // e.g., emails-clean/{user}/{rawId}
      const htmlPath = `${base}.html`.replace(/^emails-clean\//, "")
      const txtPath = `${base}.txt`.replace(/^emails-clean\//, "")
      // Lookup raw storage path then parse raw .eml to rebuild headers and body
      const rawRow = await supabaseServiceRole
        .from('messages_raw')
        .select('storage_path')
        .eq('id', row.raw_message_id)
        .maybeSingle()
      const rawPath = rawRow.data?.storage_path
      if (!rawPath) { errors.push({ id: row.id, error: 'missing storage_path for raw' }); continue }
      const rawDl = await supabaseServiceRole.storage.from("emails-raw").download(rawPath)
      if (rawDl.error || !rawDl.data) { errors.push({ id: row.id, error: rawDl.error || 'raw download failed' }); continue }
      const rawBuf = Buffer.from(await rawDl.data.arrayBuffer())
      const parsed = await simpleParser(rawBuf)
      const headers: Record<string, string | undefined> = {}
      for (const [k,v] of parsed.headers) headers[k as string] = String(v)
      const headerLines = (parsed as any).headerLines as Array<{ key: string; line: string }> | undefined
      const contentTypeRaw = headerLines?.find(h => h.key?.toLowerCase() === 'content-type')?.line
      const rawHtml = parsed.html ? String(parsed.html) : ""
      const cleanHtml = sanitizeHtml(rawHtml, { allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img","table","thead","tbody","tr","td","th"]), allowedAttributes: { a:["href","name","target","rel"], img:["src","alt","width","height"] } })
      const text = parsed.text || htmlToText(cleanHtml, { wordwrap: 120 })

      // Sender fields
      const fromStructured = (parsed.from && Array.isArray((parsed as any).from?.value) && (parsed as any).from?.value?.[0]) || null
      const fromEmail = fromStructured?.address || (headers["from"]?.match(/<([^>]+)>/)?.[1] || headers["from"]) || null
      const fromDomain = fromEmail && fromEmail.includes("@") ? fromEmail.split("@").pop()!.toLowerCase() : (row.from_domain || null)
      const rp = headers["return-path"] || headers["Return-Path"] || ""
      const rpEmail = rp.replace(/[<>]/g, "").trim()
      const rpDomain = rpEmail.includes("@") ? (rpEmail.split("@").pop() || null) : null
      const dkimHeaders = ["dkim-signature","DKIM-Signature"].map(k => headers[k]).filter(Boolean) as string[]
      const dCandidates: string[] = []
      for (const dh of dkimHeaders) { const m = dh.match(/\bd=([^;\s]+)/); if (m && m[1]) dCandidates.push(m[1].toLowerCase()) }
      const fromReg = toRegistrableDomain(fromDomain)
      let dkimDomain: string | null = null
      if (dCandidates.length > 0) {
        const aligned = dCandidates.find(d => toRegistrableDomain(d) === fromReg)
        dkimDomain = aligned || dCandidates.find(d => !isEspDomain(d)) || dCandidates[0]
      }
      const msgId = headers["message-id"] || headers["Message-Id"] || ""
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
      const subject = parsed.subject || null
      const receivedAtHeader = headers["date"] || headers["Date"]
      const receivedAt = receivedAtHeader ? new Date(receivedAtHeader).toISOString() : (parsed.date ? new Date(parsed.date).toISOString() : null)

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

      const subjectStr = subject || ''
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
        reasons = { top_reasons: ['user override'], features: { host_entropy: features.host_entropy, text_to_link_ratio: Number((features.body_char_len/Math.max(1,features.link_count)).toFixed(3)), link_count: features.link_count, tracking_pixel_present: features.tracking_pixel_present }, applied_rules: ['user_override'] }
      } else {
        // Transactional suppression gate (Beacon v5)
        const autoSubmitted = /auto-?submitted/i.test(String(headers["auto-submitted"] || headers["Auto-Submitted"] || ""))
        const contentType = String(headers["content-type"] || headers["Content-Type"] || "")
        const dsn = /delivery-status|multipart\/(report)/i.test(contentType) || /mailer-daemon|postmaster/i.test(String(headers["from"] || ""))
        const txnTerms = /\b(receipt|invoice|order|shipment|shipping|tracking number|otp|2fa|verification code|password reset|login alert)\b/i
          .test(subjectStr || text || "")
        const txnSubject = /^(your\s+)?(order|order\s+#|order\s+confirmation|receipt|invoice|payment|delivered:|delivered\s*:|shipped:|shipped\s*:|tracking|tracking\s+number)/i.test(subjectStr || "")
          || /(otp|2fa|verification code|password reset|login alert)/i.test(subjectStr || "")
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
          const r = applyBeaconV4Lite({ signals, features, subject: subjectStr, senderCounts30d: counts30, minSpacingDays: spacing })
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
              (reasons.top_reasons as any[]).unshift('daily cadence')
              appliedRules.push('cadence_daily')
            } else if (spacing <= 9 && !appliedRules.includes('cadence_weekly')) {
              (reasons.top_reasons as any[]).unshift('weekly/biweekly cadence')
              appliedRules.push('cadence_weekly')
            }
          }
          // Subject cue tag for explainability
          if ((subjectStr || '').length > 0) {
            const subj = subjectStr || ''
            const hasCue = /(newsletter|digest|round\s?up|round-up)/i.test(subj) || /[\p{Emoji}\p{Extended_Pictographic}]/u.test(subj)
            if (hasCue && !appliedRules.includes('subject_cue')) appliedRules.push('subject_cue')
          }
          const APPLIED_RULE_ORDER = [
            'user_override','transactional_suppression','headline_alert_suppression','cold_start_gate','strong_headers','footer_i18n','esp_fingerprint','tracking_pixel','view_in_browser','simhash_strong','simhash_weak','cadence_monthly','sender_key_normalized','model','llm'
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
          classifier_version: 'v5b2',
          reasons
        })
        .eq('id', row.id)

      if (upErr) { errors.push({ id: row.id, error: upErr }); continue }
      updated += 1
    } catch (e) {
      errors.push({ id: row.id, error: String(e) })
    }
  }

  // Remaining count uses the same predicate as selection to avoid confusion (Beacon v5b2)
  const { count: remaining } = await supabaseServiceRole
    .from('messages_clean')
    .select('id', { head: true, count: 'exact' })
    .eq('user_id', user.id)
    .or('classifier_version.is.null,classifier_version.neq.v5b2,sender_key.is.null,subject.is.null')

  return NextResponse.json({ ok: true, selected: candidates.length, updated, remaining: remaining ?? 0, errors })
}


