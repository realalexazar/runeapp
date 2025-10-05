import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { simpleParser } from "mailparser"
import sanitizeHtml from "sanitize-html"
import { htmlToText } from "html-to-text"
import { createHash } from "crypto"
import { ESP_REGISTRABLE_BLOCKLIST, isEspRegistrableDomain, telemetry } from "@/lib/newsletters/config"
import { toRegistrableDomain as pslRegistrableDomain, isEspDomain as isEspByConfig } from "@/lib/newsletters/domain"

function detectNewsletterSignals(headers: Record<string, string | undefined>, html: string, text: string) {
  const signals: Record<string, boolean> = {}
  const header = (k: string) => headers[k] || headers[k.toLowerCase()] || headers[k.toUpperCase()]

  // Core list headers
  const listId = header("list-id")
  const listUnsub = header("list-unsubscribe")
  const listUnsubPost = header("list-unsubscribe-post")
  signals.listId = !!listId
  signals.listUnsubscribe = !!listUnsub
  signals.listUnsubscribeOneClick = /one-click/i.test(listUnsubPost || "")

  // Content/footer tells
  const htmlOrText = `${html}\n${text}`
  signals.unsubscribeLink = /unsubscribe/i.test(htmlOrText)
  signals.managePrefs = /manage (preferences|prefs)/i.test(htmlOrText)
  signals.viewInBrowser = /view in browser/i.test(htmlOrText)
  signals.postalAddress = /(\d+\s+\w+.*\n.*(USA|United States|UK|United Kingdom)|\bPO Box\b)/i.test(htmlOrText)

  // Precedence and sender behavior
  signals.bulkPrecedence = /bulk|list/i.test(header("precedence") || "")
  const fromVal = header("from") || ""
  signals.noReplyFrom = /no-?reply@/i.test(fromVal)

  // Transactional keywords (guardrail)
  const transactional = /(order|receipt|invoice|otp|verification code|password reset|tracking number|ticket)/i.test(htmlOrText)

  // Simple weighted score
  let score = 0
  if (signals.listId) score += 4
  if (signals.listUnsubscribe) score += 2
  if (signals.listUnsubscribeOneClick) score += 2
  if (signals.unsubscribeLink) score += 1
  if (signals.bulkPrecedence) score += 1
  if (signals.managePrefs) score += 1
  if (signals.viewInBrowser) score += 1
  if (signals.postalAddress) score += 1
  if (signals.noReplyFrom) score += 1

  // Demote on transactional if no strong list signals
  if (transactional && !signals.listId && !signals.listUnsubscribe) {
    score -= 3
  }

  const isNewsletter = score >= 5 || signals.listId === true
  return { isNewsletter, score, signals }
}

function extractDomainFromEmail(addr: string): string | null {
  const m = addr.match(/@([^>\s]+)>?$/)
  return m ? m[1].toLowerCase() : null
}

const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk","org.uk","ac.uk","gov.uk","sch.uk",
  "com.au","net.au","org.au","edu.au",
  "com.br","com.tr","com.mx","com.cn","com.hk","com.sg","com.jp","co.jp","co.in","com.in"
])

function toRegistrableDomain(host: string | null | undefined): string | null {
  return pslRegistrableDomain(host)
}

function isEspDomain(domain: string | null): boolean {
  return isEspByConfig(domain || undefined)
}

function extractSenderKey(headers: Record<string, string | undefined>, fallbackDomain: string | null): string | null {
  const rp = headers["return-path"] || headers["Return-Path"] || ""
  const rpEmail = rp.replace(/[<>]/g, "").trim()
  const rpDomain = rpEmail.includes("@") ? (rpEmail.split("@").pop() || null) : null

  // Multiple DKIM signatures possible — collect all d= and prefer one aligned with From domain
  const dkimHeaders = ["dkim-signature","DKIM-Signature"].map(k => headers[k]).filter(Boolean) as string[]
  const dCandidates: string[] = []
  for (const dh of dkimHeaders) {
    const m = dh.match(/\bd=([^;\s]+)/)
    if (m && m[1]) dCandidates.push(m[1].toLowerCase())
  }
  let dkimDomain: string | null = null
  if (dCandidates.length > 0) {
    const fromReg = toRegistrableDomain(fallbackDomain)
    // prefer DKIM whose registrable matches From registrable, else first non-ESP
    const aligned = dCandidates.find(d => toRegistrableDomain(d) === fromReg)
    dkimDomain = aligned || dCandidates.find(d => !isEspDomain(d)) || dCandidates[0]
    if (aligned) telemetry.senderKey.dkimAligned++
    else if (dkimDomain && !isEspDomain(dkimDomain)) telemetry.senderKey.dkimNonEsp++
  }

  const fromDom = fallbackDomain ? fallbackDomain.toLowerCase() : null

  const msgId = headers["message-id"] || headers["Message-Id"] || ""
  const midMatch = msgId.match(/@([^>\s]+)>?$/)
  const midDomain = midMatch && midMatch[1] ? midMatch[1].toLowerCase() : null

  // Preference: DKIM if not ESP; else From domain; else Return-Path if not ESP; else Message-Id; else fallback
  let chosen: string | null = null
  if (dkimDomain && !isEspDomain(dkimDomain)) {
    chosen = dkimDomain
  } else if (fromDom) {
    chosen = fromDom
    telemetry.senderKey.fromFallback++
  } else if (rpDomain && !isEspDomain(rpDomain)) {
    chosen = rpDomain
    telemetry.senderKey.returnPathFallback++
  } else if (midDomain) {
    chosen = midDomain
    telemetry.senderKey.messageIdFallback++
  } else {
    chosen = null
  }

  return toRegistrableDomain(chosen)
}

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

function hash64Bytes(token: string): Uint8Array {
  const h = createHash("sha256").update(token).digest()
  return new Uint8Array(h.buffer, h.byteOffset, 8)
}

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

function hexToBytes(hex: string): number[] {
  const out: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    out.push(parseInt(hex.slice(i, i + 2), 16))
  }
  return out
}

const POPCOUNT_TABLE: number[] = (() => {
  const t = new Array<number>(256)
  for (let i = 0; i < 256; i++) {
    let c = 0, v = i
    while (v) { v &= v - 1; c++ }
    t[i] = c
  }
  return t
})()

function hammingDistanceHex(a: string, b: string): number {
  const ab = hexToBytes(a)
  const bb = hexToBytes(b)
  const n = Math.min(ab.length, bb.length)
  let d = 0
  for (let i = 0; i < n; i++) d += POPCOUNT_TABLE[ab[i] ^ bb[i]]
  // if unequal length, count remaining bits in longer
  for (let i = n; i < ab.length; i++) d += POPCOUNT_TABLE[ab[i]]
  for (let i = n; i < bb.length; i++) d += POPCOUNT_TABLE[bb[i]]
  return d
}

// Placeholder model and LLM hooks (disabled by default)
function predictWithModel(_features: BeaconInputs["features"], _signals: Record<string, boolean>): number | null {
  if (!ENABLE_MODEL) return null
  // TODO: plug real model here; return p in [0,1]
  return null
}

function adjudicateWithLLM(_summary: string): number | null {
  if (!ENABLE_LLM) return null
  // TODO: call LLM and return p in [0,1]
  return null
}

function normalizeRegistrableDup(reg: string | null): string | null {
  if (!reg) return reg
  const lower = reg.toLowerCase()
  const parts = lower.split('.')
  if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
    parts.pop()
  }
  return parts.join('.')
}

// Deterministic ordering for applied_rules
const APPLIED_RULE_ORDER = [
  "user_override",
  "transactional_suppression",
  "headline_alert_suppression",
  "cold_start_gate",
  "strong_headers",
  "footer_i18n",
  "esp_fingerprint",
  "tracking_pixel",
  "view_in_browser",
  "subject_cue",
  "simhash_strong",
  "simhash_weak",
  "cadence_daily",
  "cadence_weekly",
  "cadence_monthly",
  "sender_key_normalized",
  "model",
  "llm"
]

function orderAppliedRules(rules: string[] | undefined | null): string[] {
  if (!Array.isArray(rules)) return []
  const seen = new Set<string>()
  const uniq = rules.filter((r): r is string => !!r && !seen.has(r) && (seen.add(r), true))
  return uniq.sort((a, b) => {
    const ia = APPLIED_RULE_ORDER.indexOf(a)
    const ib = APPLIED_RULE_ORDER.indexOf(b)
    const sa = ia < 0 ? 999 : ia
    const sb = ib < 0 ? 999 : ib
    return sa - sb
  })
}

function shannonEntropy(values: string[]): number {
  if (values.length === 0) return 0
  const freq = new Map<string, number>()
  for (const v of values) freq.set(v, (freq.get(v) || 0) + 1)
  const n = values.length
  let H = 0
  for (const c of freq.values()) {
    const p = c / n
    H += -p * Math.log2(p)
  }
  return Number(H.toFixed(3))
}

// Beacon v4 rule thresholds (defaults; per-user tuning later)
const HOST_ENTROPY_MIN_DEFAULT = 1.0
const TEXT_TO_LINK_RATIO_COLDSTART_MIN = 120
const BODY_LEN_COLDSTART_MIN = 500

type BeaconInputs = {
  signals: Record<string, boolean>
  features: {
    link_count: number
    external_link_ratio: number
    has_view_in_browser: boolean
    has_postal_address: boolean
    esp_fingerprint: boolean
    tracking_pixel_present: boolean
    body_char_len: number
    link_host_count: number
    host_entropy: number
    i18n_unsubscribe_present: boolean
  }
  subject: string
  fromDomain: string
  senderKey?: string | null
  senderCounts30d: number
  minSpacingDays: number | null
  hostEntropyMinOverride?: number | null
}

const PERSONAL_PROVIDERS = new Set(["gmail.com","outlook.com","hotmail.com","yahoo.com","icloud.com","proton.me","protonmail.com"])
const ENABLE_MONTHLY = true
const ENABLE_MODEL = false
const ENABLE_LLM = false
const MODEL_VERSION = "v0"
const LLM_PROMPT_VERSION = "v0"

function applyBeaconV4(inputs: BeaconInputs) {
  const { signals, features, subject, senderCounts30d, minSpacingDays, hostEntropyMinOverride } = inputs

  const reasons: string[] = []
  let positive = 0
  let negative = 0

  // 1) Strong headers
  if (signals.listId) { positive += 3; reasons.push("list-id header present") }
  if (signals.listUnsubscribe) { positive += 2; reasons.push("list-unsubscribe present") }
  if (signals.listUnsubscribeOneClick) { positive += 1; reasons.push("one-click unsubscribe") }

  // 2) Content/footer & ESP path
  if (signals.viewInBrowser) { positive += 1; reasons.push("view in browser") }
  if (signals.postalAddress) { positive += 1; reasons.push("postal address footer") }
  if (features.i18n_unsubscribe_present) { positive += 1; reasons.push("i18n unsubscribe") }
  if (features.esp_fingerprint) { positive += 1; reasons.push("ESP fingerprint") }
  if (features.link_count > 8) { positive += 1; reasons.push("many links") }
  if (features.tracking_pixel_present) { positive += 1; reasons.push("tracking pixel") }
  // 2b) Subject/from cues (lightweight)
  const subj = subject || ""
  const subjectCue = /(newsletter|digest|round\s?up|round-up)/i.test(subj) || /[\p{Emoji}\p{Extended_Pictographic}]/u.test(subj)
  if (subjectCue) { positive += 0.5; reasons.push("subject cue") }

  // 3) Transactional guards (lightweight)
  const transactional = /\b(order|receipt|invoice|otp|verification code|password reset|tracking number|ticket)\b/i
    .test(subject)
  if (transactional && !signals.listId && !signals.listUnsubscribe) {
    negative += 3
    reasons.push("transactional terms without list headers")
  }

  // 4) Host entropy and ratios
  const hostEntropyThreshold = typeof hostEntropyMinOverride === 'number' && !Number.isNaN(hostEntropyMinOverride)
    ? hostEntropyMinOverride
    : HOST_ENTROPY_MIN_DEFAULT
  const hostEntropyOk = features.host_entropy >= hostEntropyThreshold
  const lowExternalLinks = (features.external_link_ratio ?? 0) < 0.2
  // Treat entropy=0 as neutral and ignore entropy when very few external links
  if (hostEntropyOk) { positive += 1; reasons.push("high host entropy") }

  // 4b) Infra/personal guards unless strong newsletter path
  const senderReg = toRegistrableDomain(inputs.senderKey || null)
  const fromReg = toRegistrableDomain(inputs.fromDomain || null)
  const hasFooterPath = !!(signals.listUnsubscribe || signals.unsubscribeLink || signals.managePrefs || signals.postalAddress || features.esp_fingerprint || features.has_view_in_browser || features.i18n_unsubscribe_present)
  if (!hasFooterPath) {
    if (senderReg && (isEspDomain(senderReg) || senderReg.endsWith("outlook.com"))) {
      return { isNewsletter: false, confidence: 0.11, classifierSource: "rule", reasons: { top_reasons: [], why_not_top: "infra_no_list_signals", features: { host_entropy: features.host_entropy, text_to_link_ratio: Number((features.body_char_len/Math.max(1,features.link_count)).toFixed(3)) } } }
    }
    if (fromReg && PERSONAL_PROVIDERS.has(fromReg)) {
      return { isNewsletter: false, confidence: 0.11, classifierSource: "rule", reasons: { top_reasons: [], why_not_top: "personal_sender_no_list", features: { host_entropy: features.host_entropy, text_to_link_ratio: Number((features.body_char_len/Math.max(1,features.link_count)).toFixed(3)) } } }
    }
  }

  // 5) Cadence hints from spacing (if available)
  if (minSpacingDays != null) {
    if (minSpacingDays <= 2) { positive += 1; reasons.push("near-daily cadence") }
    else if (minSpacingDays <= 9) { positive += 1; reasons.push("weekly/biweekly cadence") }
  }

  // 6) Cold-start explicit rule
  const coldStart = senderCounts30d <= 2
  const textToLink = features.body_char_len / Math.max(1, features.link_count)
  if (coldStart) {
    const hasFooterOrEsp = !!(signals.listUnsubscribe || signals.unsubscribeLink || signals.managePrefs || signals.postalAddress || features.esp_fingerprint || features.has_view_in_browser || features.i18n_unsubscribe_present)
    const hasVolume = (features.body_char_len >= BODY_LEN_COLDSTART_MIN) || (textToLink >= TEXT_TO_LINK_RATIO_COLDSTART_MIN)
    const entropyRequired = !(signals.listUnsubscribe) && !lowExternalLinks
    const entropyPass = hostEntropyOk || !entropyRequired
    if (!(hasFooterOrEsp && hasVolume && entropyPass)) {
      return {
        isNewsletter: false,
        confidence: 0.12,
        classifierSource: "rule",
        reasons: { top_reasons: [], why_not_top: "cold-start: insufficient footer/volume/entropy", features: { host_entropy: features.host_entropy, text_to_link_ratio: Number(textToLink.toFixed(3)) } }
      }
    }
    reasons.push("cold-start satisfied")
    positive += 1
  }

  // Aggregate decision
  const score = Math.max(0, positive - Math.max(0, negative - 1))
  const prelimIsNewsletter = score >= 3 || signals.listId === true
  // Confidence mapping + gating (LO/HI)
  const LO = 0.15, HI = 0.85
  const logistic = (x: number) => 1 / (1 + Math.exp(-1.2 * (x - 3)))
  const p = logistic(score)
  let isNewsletter = prelimIsNewsletter
  let classifierSource: "rule" | "model" | "llm" = "rule"
  let appliedRulesLocal: string[] = []
  if (p >= HI) {
    isNewsletter = true
  } else if (p <= LO) {
    isNewsletter = false
  } else {
    // Gray-zone → model → LLM (stubs)
    const pModel = predictWithModel(inputs.features, inputs.signals)
    if (typeof pModel === 'number') {
      appliedRulesLocal.push('model')
      classifierSource = 'model'
      if (pModel >= HI) isNewsletter = true
      else if (pModel <= LO) isNewsletter = false
    }
    if (p > LO && p < HI && classifierSource === 'rule') {
      const pLlm = adjudicateWithLLM('')
      if (typeof pLlm === 'number') {
        appliedRulesLocal.push('llm')
        classifierSource = 'llm'
        isNewsletter = pLlm >= 0.5
      }
    }
  }
  const confidence = Number(Math.max(0, Math.min(1, p)).toFixed(2))

  // Top-2 reasons for positives; top why-not otherwise
  const top_reasons = isNewsletter ? reasons.slice(0, 2) : []
  const why_not_top = isNewsletter ? undefined : (hostEntropyOk ? "signals insufficient" : "low host entropy")

  const meta: Record<string, string> = {}
  if (classifierSource === 'model') meta.model_version = MODEL_VERSION
  if (classifierSource === 'llm') meta.llm_prompt_version = LLM_PROMPT_VERSION

  return {
    isNewsletter,
    confidence,
    classifierSource,
    reasons: {
      top_reasons,
      why_not_top,
      features: {
        host_entropy: features.host_entropy,
        text_to_link_ratio: Number(textToLink.toFixed(3)),
        link_count: features.link_count,
        tracking_pixel_present: features.tracking_pixel_present
      },
      applied_rules: appliedRulesLocal,
      meta: Object.keys(meta).length ? meta : undefined
    }
  }
}

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Read optional limit from body
  let limit = 100
  try {
    const body = await req.json()
    if (body && typeof body.limit === "number") {
      const n = Math.floor(body.limit)
      // clamp between 1 and 500 for safety
      limit = Math.max(1, Math.min(500, n))
    }
  } catch {}

  // Simple retry helper for transient storage/network hiccups
  async function retry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 300): Promise<T> {
    let lastErr: any
    for (let i = 0; i < attempts; i++) {
      try { return await fn() } catch (e) { lastErr = e }
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, i)))
    }
    throw lastErr
  }

  // Count cleaned before this run
  const beforeClean = await supabaseServiceRole
    .from("messages_clean")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id)
  const beforeCleanCount = beforeClean.count ?? 0

  // Selection: only unprocessed via RPC (server-side NOT EXISTS)
  const { data: rows, error: selErr } = await supabaseServiceRole.rpc(
    "get_unprocessed_raws",
    { p_user_id: user.id, p_limit: limit }
  )
  if (selErr) {
    return NextResponse.json({ ok: false, error: selErr.message })
  }

  if (!rows || rows.length === 0) {
    const rawCount = await supabaseServiceRole
      .from("messages_raw")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", user.id)
    const rawTotal = rawCount.count ?? 0
    const remaining = Math.max(0, rawTotal - beforeCleanCount)
    return NextResponse.json({ ok: true, parsed: 0, errors: [], clean: beforeCleanCount, remaining, selected: 0 })
  }

  let parsed = 0
  const errors: Array<{ raw_id: string, error: unknown }> = []

  for (const r of rows as Array<{ id: string, raw_url: string }>) {
    // rows are already filtered to only unprocessed by the RPC

    const dl = await retry(() => supabaseServiceRole.storage.from("emails-raw").download(r.raw_url.replace("emails-raw/", "")))
    if (dl.error || !dl.data) { errors.push({ raw_id: r.id, error: dl.error || "download failed" }); continue }
    const rawBuf = Buffer.from(await dl.data.arrayBuffer())

    const parsedMail = await simpleParser(rawBuf)
    const headers: Record<string, string | undefined> = {}
    for (const [k, v] of parsedMail.headers) headers[k as string] = String(v)
    const rawHtml = parsedMail.html ? String(parsedMail.html) : ""
    const cleanHtml = sanitizeHtml(rawHtml, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img","table","thead","tbody","tr","td","th"]),
      allowedAttributes: { a: ["href","name","target","rel"], img: ["src","alt","width","height"] }
    })
    const text = parsedMail.text || htmlToText(cleanHtml, { wordwrap: 120 })

    const { isNewsletter: prelimIsNewsletter, signals, score } = (() => {
      const r = detectNewsletterSignals(headers, cleanHtml, text)
      return { ...r, score: (r as any).score as number }
    })()

    // Enrichment fields
    const subject = parsedMail.subject || ""
    // Prefer structured From from mailparser; fallback to raw header regex
    let fromEmail = (parsedMail.from && Array.isArray((parsedMail as any).from?.value) && (parsedMail as any).from?.value?.[0]?.address) || ""
    if (!fromEmail) {
      const fromHeader = headers["from"] || ""
      const emailMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)
      fromEmail = emailMatch ? (emailMatch[1] || emailMatch[0]) : ""
    }
    const fromDomain = fromEmail && fromEmail.includes("@") ? fromEmail.split("@")[1].toLowerCase() : ""
    // Received at from message Date header when available
    const receivedAtHeader = headers["date"] || headers["Date"]
    const receivedAt = receivedAtHeader ? new Date(receivedAtHeader).toISOString() : null

    // Sender key and template hash
    let senderKey = extractSenderKey(headers, fromDomain || null)
    const beforeNorm = senderKey
    senderKey = normalizeRegistrableDup(senderKey)
    const templateHash = computeSimHashHex(tokenizeStructure(cleanHtml))

    // Pre-fetch existing sender profile for cadence/spacing inputs
    let existingProfile: any = null
    if (senderKey) {
      const existingResp = await supabaseServiceRole
        .from("sender_profiles")
        .select("counts_7d, counts_30d, first_seen_at, last_seen_at, min_spacing_days, same_day_buckets_30d, template_centroids, cadence_flags, override_is_newsletter, override_ttl")
        .eq("user_id", user.id)
        .eq("sender_key", senderKey)
        .maybeSingle()
      existingProfile = existingResp.data || null
    }

    // Compact headers_json subset
    // Prefer raw header line for content-type to avoid "[object Object]"
    const headerLines = (parsedMail as any).headerLines as Array<{ key: string; line: string }> | undefined
    const contentTypeRaw = headerLines?.find(h => h.key?.toLowerCase() === 'content-type')?.line

    const headersJson = {
      list_id: headers["list-id"] || null,
      list_unsubscribe: headers["list-unsubscribe"] || null,
      precedence: headers["precedence"] || null,
      reply_to: headers["reply-to"] || null,
      message_id: headers["message-id"] || null,
      date: headers["date"] || null,
      auto_submitted: headers["auto-submitted"] || headers["Auto-Submitted"] || null,
      content_type: contentTypeRaw || headers["content-type"] || headers["Content-Type"] || null
    }

    // Features
    const linkMatches: RegExpMatchArray[] = [...cleanHtml.matchAll(/<a\s+[^>]*href=\"([^\"]+)\"/gi)]
    const links = linkMatches.map((m: RegExpMatchArray) => (m[1] ?? ""))
    const linkCount = links.length
    const externalLinks = links.filter(h => /^https?:\/\//i.test(h))
    const externalRatio = linkCount > 0 ? externalLinks.length / linkCount : 0
    const hasViewInBrowser = /view in browser/i.test(cleanHtml)
    const hasPostalAddress = /(\d+\s+\w+.*\n.*(USA|United States|UK|United Kingdom)|\bPO Box\b)/i.test(`${cleanHtml}\n${text}`)
    const espHosts = [
      // Existing
      "list-manage.com","sendgrid.net","mailgun.org","amazonses.com",
      "mandrillapp.com","beehiiv.com","substack.com","campaign-archive",
      // New major ESPs
      "braze.com","blz.io",
      "iterable.com","links.iterable.com","track.iterable.com",
      "hubspot.com","hubspotemail.net","hs-analytics.net","hs-sites.com",
      "exacttarget.com","marketingcloudapps.com","sfmc",
      "createsend.com","cmail20.com","cmail19.com","cmail18.com",
      "klaviyo.com","kmail-lists.com","klclick.com","klaviyo-mail.com",
      "mlsend.com","mailerlite.com",
      "customer.io","customeriomail.com"
    ]
    const espFingerprint = espHosts.some(h => cleanHtml.toLowerCase().includes(h))
    const trackingPixel = /<img[^>]+(width=\"1\"[^>]*height=\"1\"|height=\"1\"[^>]*width=\"1\")[^>]*>/i.test(cleanHtml)
    const bodyCharLen = (text || "").length

    const linkHosts = links.map(l => { try { return new URL(l).hostname } catch { return "" } }).filter(Boolean)
    const linkHostCount = new Set(linkHosts).size
    const hostEntropy = shannonEntropy(linkHosts)
    const i18nUnsub = /(désabonner|se désinscrire|cancelar suscripción|darse de baja|abbestellen|disiscriviti|cancelar assinatura|cancelar subscrição|afmelden|отподписаться|取消订阅|取消訂閱|退会|購読解除|구독취소|सदस्यता रद्द)/i.test(`${cleanHtml}\n${text}`)

    const features = {
      link_count: linkCount,
      external_link_ratio: Number(externalRatio.toFixed(3)),
      has_view_in_browser: hasViewInBrowser,
      has_postal_address: hasPostalAddress,
      esp_fingerprint: espFingerprint,
      tracking_pixel_present: trackingPixel,
      body_char_len: bodyCharLen,
      link_host_count: linkHostCount,
      host_entropy: hostEntropy,
      i18n_unsubscribe_present: i18nUnsub
    }

    // Override gate (Beacon v5): TTL-aware per-user override short-circuits classification
    let isNewsletter = false
    let confidence = 0
    let classifierSource: "rule" | "model" | "llm" = "rule"
    let reasons: any = { top_reasons: [], features: { host_entropy: features.host_entropy, text_to_link_ratio: Number(((features.body_char_len)/Math.max(1,features.link_count)).toFixed(3)), link_count: features.link_count, tracking_pixel_present: features.tracking_pixel_present }, applied_rules: [] as string[] }

    const overrideVal = existingProfile?.override_is_newsletter as boolean | null | undefined
    const overrideTtl = existingProfile?.override_ttl as string | null | undefined
    const overrideActive = (() => {
      if (overrideVal == null) return false
      if (!overrideTtl) return true
      const now = Date.now()
      const exp = Date.parse(overrideTtl)
      if (Number.isNaN(exp)) return true
      return now <= exp
    })()

    if (overrideActive) {
      isNewsletter = !!overrideVal
      confidence = 0.99
      classifierSource = "rule"
      reasons.top_reasons = ["user override"]
      reasons.applied_rules.push("user_override")
    } else {
      // Transactional suppression gate (Beacon v5)
      const autoSubmitted = /auto-?submitted/i.test(String(headers["auto-submitted"] || headers["Auto-Submitted"] || ""))
      const contentType = String(headers["content-type"] || headers["Content-Type"] || "")
      const dsn = /delivery-status|multipart\/(report)/i.test(contentType) || /mailer-daemon|postmaster/i.test(String(headers["from"] || ""))
      const txnSubject = /^(your\s+)?(order|order\s+#|order\s+confirmation|receipt|invoice|payment|delivered:|delivered\s*:|shipped:|shipped\s*:|tracking|tracking\s+number)/i.test(subject || "")
        || /(otp|2fa|verification code|password reset|login alert)/i.test(subject || "")
      if (autoSubmitted || dsn || txnSubject) {
        isNewsletter = false
        confidence = 0.98
        classifierSource = "rule"
        const appliedRules: string[] = []
        reasons = {
          top_reasons: [],
          why_not_top: "transactional_signal",
          features: {
            host_entropy: features.host_entropy,
            text_to_link_ratio: Number(((features.body_char_len)/Math.max(1,features.link_count)).toFixed(3)),
            link_count: features.link_count,
            tracking_pixel_present: features.tracking_pixel_present
          },
          applied_rules: appliedRules.concat("transactional_suppression")
        }
      } else {
        // Headline alert suppression (Beacon v5.2)
        const isAlert = /^(breaking|news alert|breaking news)\b/i.test(subject || "")
        const thin = features.body_char_len < 700 || /read more/i.test(cleanHtml + "\n" + text)
        const lowDiversity = (features.link_host_count <= 2) || (features.host_entropy < 0.6)
        if (!signals.listId && !signals.listUnsubscribe && isAlert && thin && lowDiversity) {
          isNewsletter = false
          confidence = 0.9
          classifierSource = "rule"
          reasons = {
            top_reasons: [],
            why_not_top: "headline_alert",
            features: {
              host_entropy: features.host_entropy,
              text_to_link_ratio: Number(((features.body_char_len)/Math.max(1,features.link_count)).toFixed(3)),
              link_count: features.link_count,
              tracking_pixel_present: features.tracking_pixel_present
            },
            applied_rules: ["headline_alert_suppression"]
          }
        } else {
        // Cold-start strict gate (Beacon v5.6) wraps the existing fallback
        const counts30 = existingProfile?.counts_30d || 0
        const isColdStart = counts30 === 1
        if (isColdStart) {
          const textToLink = features.body_char_len / Math.max(1, features.link_count)
          const hasFooterOrEsp = !!(signals.listUnsubscribe || signals.unsubscribeLink || signals.managePrefs || signals.postalAddress || features.esp_fingerprint || features.has_view_in_browser || features.i18n_unsubscribe_present)
          const hasVolume = (features.body_char_len >= 700) || (textToLink >= 200)
          const entropyOk = features.host_entropy >= 1.2
          if (!(hasFooterOrEsp && hasVolume && entropyOk)) {
            isNewsletter = false
            confidence = 0.10
            classifierSource = "rule"
            reasons = {
              top_reasons: [],
              why_not_top: "cold_start_requirements_not_met",
              features: {
                host_entropy: features.host_entropy,
                text_to_link_ratio: Number(((features.body_char_len)/Math.max(1,features.link_count)).toFixed(3)),
                link_count: features.link_count,
                tracking_pixel_present: features.tracking_pixel_present
              },
              applied_rules: ["cold_start_gate"]
            }
          } else {
            const r = applyBeaconV4({
              signals,
              features,
              subject,
              fromDomain,
              senderKey,
              senderCounts30d: counts30,
              minSpacingDays: (existingProfile?.min_spacing_days as number | null) ?? null
            })
            let applied = (r as any).reasons?.applied_rules ?? []
            const centroids: string[] = Array.isArray(existingProfile?.template_centroids) ? (existingProfile!.template_centroids as unknown as string[]) : []
            let bestH: number | null = null
            for (const c of centroids.slice(0, 3)) {
              if (!c || typeof c !== 'string') continue
              const h = hammingDistanceHex(templateHash, c)
              bestH = bestH == null ? h : Math.min(bestH, h)
            }
            if (bestH != null) {
              (r.reasons.features as any).template_hamming_distance = String(bestH)
              if (bestH <= 6) { applied = [...applied, 'simhash_strong'] }
              else if (bestH <= 9) { applied = [...applied, 'simhash_weak'] }
            }
            if (ENABLE_MONTHLY) {
              const msd = (existingProfile?.min_spacing_days as number | null) ?? null
              const hasMonthlyFlag = Array.isArray(existingProfile?.cadence_flags) && (existingProfile!.cadence_flags as unknown as string[]).includes('monthly')
              if (hasMonthlyFlag || (msd != null && msd >= 28 && msd <= 33)) {
                (r.reasons.top_reasons as any[]).unshift('monthly cadence')
                applied = [...applied, 'cadence_monthly']
              }
            }
            isNewsletter = r.isNewsletter
            confidence = r.confidence
            classifierSource = r.classifierSource as any
        reasons = { ...r.reasons, applied_rules: orderAppliedRules(applied) }
          }
        } else {
          const r = applyBeaconV4({
            signals,
            features,
            subject,
            fromDomain,
            senderKey,
            senderCounts30d: existingProfile?.counts_30d || 0,
            minSpacingDays: (existingProfile?.min_spacing_days as number | null) ?? null
          })
          isNewsletter = r.isNewsletter
          confidence = r.confidence
          classifierSource = r.classifierSource as any
          reasons = { ...r.reasons, applied_rules: (r as any).reasons?.applied_rules ?? [] }
        }
        }
      }
    }

    // Record applied_rules for strong headers (Beacon v5 observability)
    {
      const appliedRules: string[] = Array.isArray((reasons as any)?.applied_rules)
        ? ((reasons as any).applied_rules as string[])
        : []
      if (signals.listId || signals.listUnsubscribe || signals.listUnsubscribeOneClick) {
        if (!appliedRules.includes("strong_headers")) appliedRules.push("strong_headers")
      }
      if (beforeNorm && senderKey && beforeNorm !== senderKey) {
        if (!appliedRules.includes("sender_key_normalized")) appliedRules.push("sender_key_normalized")
      }
      if (features.i18n_unsubscribe_present || signals.unsubscribeLink || signals.managePrefs) {
        if (!appliedRules.includes("footer_i18n")) appliedRules.push("footer_i18n")
      }
      if (features.esp_fingerprint) {
        if (!appliedRules.includes("esp_fingerprint")) appliedRules.push("esp_fingerprint")
      }
      if (features.tracking_pixel_present) {
        if (!appliedRules.includes("tracking_pixel")) appliedRules.push("tracking_pixel")
      }
      if (features.has_view_in_browser || signals.viewInBrowser) {
        if (!appliedRules.includes("view_in_browser")) appliedRules.push("view_in_browser")
      }
    // Subject cue tag for explainability
    if ((subject || "").length > 0) {
      const subj = subject || ""
      const hasCue = /(newsletter|digest|round\s?up|round-up)/i.test(subj) || /[\p{Emoji}\p{Extended_Pictographic}]/u.test(subj)
      if (hasCue && !appliedRules.includes("subject_cue")) appliedRules.push("subject_cue")
    }
      // Cadence tags based on min_spacing_days if available
      const msd = (existingProfile?.min_spacing_days as number | null) ?? null
      if (msd != null) {
        if (msd <= 2 && !appliedRules.includes("cadence_daily")) {
          (reasons.top_reasons as any[]).unshift('daily cadence')
          appliedRules.push("cadence_daily")
        } else if (msd <= 9 && !appliedRules.includes("cadence_weekly")) {
          (reasons.top_reasons as any[]).unshift('weekly/biweekly cadence')
          appliedRules.push("cadence_weekly")
        }
      }
      reasons = { ...reasons, applied_rules: orderAppliedRules(appliedRules) }
    }

    const base = `${user.id}/${r.id}`
    const upHtml = await retry(() => supabaseServiceRole.storage.from("emails-clean").upload(`${base}.html`, new Blob([cleanHtml], { type: "text/html" }), { upsert: true }))
    const upTxt = await retry(() => supabaseServiceRole.storage.from("emails-clean").upload(`${base}.txt`, new Blob([text], { type: "text/plain" }), { upsert: true }))

    const htmlUrl = upHtml.error ? null : `emails-clean/${user.id}/${r.id}.html`
    const textUrl = upTxt.error ? null : `emails-clean/${user.id}/${r.id}.txt`
    const storagePath = `emails-clean/${user.id}/${r.id}`

    const { error: insErr } = await supabaseServiceRole.from("messages_clean").upsert({
      user_id: user.id,
      raw_message_id: r.id,
      html_url: htmlUrl,
      text_url: textUrl,
      storage_path: storagePath,
      is_newsletter: isNewsletter,
      signals,
      sender_key: senderKey,
      template_hash: templateHash,
      confidence,
      classifier_source: classifierSource,
      classifier_version: 'v5b2',
      reasons,
      from_email: fromEmail || null,
      from_domain: fromDomain || null,
      subject: subject || null,
      received_at: receivedAt,
      headers_json: headersJson,
      features_json: features
    }, { onConflict: "raw_message_id" })

    if (insErr) {
      errors.push({ raw_id: r.id, error: insErr })
    } else {
      parsed += 1
    }

    // Update sender_profiles rollups (best-effort)
    try {
      if (senderKey) {
        const nowIso = new Date().toISOString()
        const rec = receivedAt ? new Date(receivedAt) : new Date()
        const now = new Date()
        const within7 = (now.getTime() - rec.getTime()) <= 7 * 24 * 60 * 60 * 1000
        const within30 = (now.getTime() - rec.getTime()) <= 30 * 24 * 60 * 60 * 1000

        const existing = existingProfile

        let counts7 = existing?.counts_7d || 0
        let counts30 = existing?.counts_30d || 0
        if (within7) counts7 += 1
        if (within30) counts30 += 1

        const lastSeen = existing?.last_seen_at ? new Date(existing.last_seen_at as unknown as string) : null
        let minSpacingDays: number | null = (existing?.min_spacing_days as unknown as number) || null
        let sameDayBuckets = existing?.same_day_buckets_30d || 0
        if (lastSeen) {
          const lastUTC = new Date(Date.UTC(lastSeen.getUTCFullYear(), lastSeen.getUTCMonth(), lastSeen.getUTCDate()))
          const curUTC = new Date(Date.UTC(rec.getUTCFullYear(), rec.getUTCMonth(), rec.getUTCDate()))
          const diffDays = Math.round((curUTC.getTime() - lastUTC.getTime()) / (24 * 60 * 60 * 1000))
          if (diffDays === 0 && within30) {
            sameDayBuckets += 1
          } else if (diffDays > 0) {
            const delta = diffDays
            minSpacingDays = minSpacingDays == null ? delta : Math.min(minSpacingDays, delta)
          }
        }

        const centroids = Array.isArray(existing?.template_centroids) ? (existing!.template_centroids as unknown as string[]) : []
        const newCentroids = centroids.includes(templateHash) ? centroids : (centroids.concat(templateHash)).slice(-3)

        // Cadence flags from spacing
        const cadenceFlags: string[] = []
        if (minSpacingDays != null) {
          if (minSpacingDays <= 2) cadenceFlags.push("daily")
          else if (minSpacingDays <= 9) cadenceFlags.push("weekly")
          else if (minSpacingDays <= 16) cadenceFlags.push("biweekly")
          else cadenceFlags.push("monthly")
        }

        await supabaseServiceRole
          .from("sender_profiles")
          .upsert({
            user_id: user.id,
            sender_key: senderKey,
            counts_7d: counts7,
            counts_30d: counts30,
            first_seen_at: existing?.first_seen_at || rec.toISOString(),
            last_seen_at: rec.toISOString(),
            min_spacing_days: minSpacingDays,
            same_day_buckets_30d: sameDayBuckets,
            template_centroids: newCentroids,
            cadence_flags: cadenceFlags,
            updated_at: nowIso
          }, { onConflict: "user_id,sender_key" })
      }
    } catch {}
  }

  // Count cleaned after this run and compute delta from DB truth
  const afterClean = await supabaseServiceRole
    .from("messages_clean")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id)
  const afterCleanCount = afterClean.count ?? beforeCleanCount + parsed

  const rawCount = await supabaseServiceRole
    .from("messages_raw")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id)
  const rawTotal = rawCount.count ?? 0

  const remaining = Math.max(0, rawTotal - afterCleanCount)
  const parsedDelta = Math.max(0, afterCleanCount - beforeCleanCount)

  return NextResponse.json({ ok: true, parsed: parsedDelta, errors, clean: afterCleanCount, remaining, selected: rows.length })
}
