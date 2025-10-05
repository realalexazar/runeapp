import { parse as parseDomain } from "tldts"
import punycode from "punycode"
import { isEspRegistrableDomain } from "@/lib/newsletters/config"

export function toRegistrableDomain(host: string | null | undefined): string | null {
  if (!host) return null
  const ascii = punycode.toASCII(String(host).toLowerCase())
  const info = parseDomain(ascii, { detectIp: true })
  if (!info) return null
  if (info.isIp) return ascii
  // tldts parse().domain already includes the public suffix; return Unicode for IDNs
  if (!info.domain) return ascii
  try {
    const unicode = punycode.toUnicode(info.domain)
    return unicode
  } catch {
    return info.domain
  }
}

export function isEspDomain(domain: string | null | undefined): boolean {
  if (!domain) return false
  const d = toRegistrableDomain(domain)
  return isEspRegistrableDomain(d || undefined)
}

// Normalize registrable domain by collapsing duplicated TLD suffixes like "example.com.com" → "example.com"
export function normalizeRegistrableDuplicateTld(registrable: string | null | undefined): string | null {
  if (!registrable) return registrable ?? null
  const lower = String(registrable).toLowerCase()
  const parts = lower.split('.')
  if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
    parts.pop()
  }
  return parts.join('.')
}


