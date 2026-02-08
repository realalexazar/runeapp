import { toRegistrableDomain, isEspDomain, normalizeRegistrableDuplicateTld } from "@/lib/newsletters/domain"

/**
 * Extract sender key (registrable domain) from email headers
 * Priority: DKIM (if not ESP) > From domain > Return-Path (if not ESP) > Message-Id
 */
export function extractSenderKey(
  headers: Record<string, string | undefined>, 
  fallbackDomain: string | null
): string | null {
  const rp = headers["return-path"] || headers["Return-Path"] || ""
  const rpEmail = rp.replace(/[<>]/g, "").trim()
  const rpDomain = rpEmail.includes("@") ? (rpEmail.split("@").pop() || null) : null

  // Multiple DKIM signatures possible — collect all d= and prefer one aligned with From domain
  const dkimHeaders = ["dkim-signature", "DKIM-Signature"].map(k => headers[k]).filter(Boolean) as string[]
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
  }

  const fromDom = fallbackDomain ? fallbackDomain.toLowerCase() : null

  const msgId = headers["message-id"] || headers["Message-Id"] || ""
  const midMatch = msgId.match(/@([^>\s]+)>?$/)
  const midDomain = midMatch && midMatch[1] ? midMatch[1].toLowerCase() : null

  // Preference: DKIM if aligned with From domain AND not ESP; else From domain; else Return-Path if not ESP; else Message-Id; else fallback
  // This ensures we use the visible From domain when DKIM doesn't match (avoids ESP collisions)
  let chosen: string | null = null
  const fromReg = fromDom ? toRegistrableDomain(fromDom) : null
  
  if (dkimDomain && !isEspDomain(dkimDomain)) {
    const dkimReg = toRegistrableDomain(dkimDomain)
    // Only use DKIM if it aligns with From domain (user sees From, so trust it for grouping)
    if (fromReg && dkimReg === fromReg) {
      chosen = dkimDomain
    } else if (!fromReg) {
      // No From domain, use DKIM as fallback
      chosen = dkimDomain
    } else {
      // DKIM doesn't match From - prefer From domain (what user sees)
      chosen = fromDom
    }
  } else if (fromDom) {
    chosen = fromDom
  } else if (rpDomain && !isEspDomain(rpDomain)) {
    chosen = rpDomain
  } else if (midDomain) {
    chosen = midDomain
  } else {
    chosen = null
  }

  const registrable = toRegistrableDomain(chosen)
  return normalizeRegistrableDuplicateTld(registrable)
}

