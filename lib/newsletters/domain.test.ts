import { describe, it, expect } from "vitest"
import { toRegistrableDomain, isEspDomain, normalizeRegistrableDuplicateTld } from "./domain"

describe("toRegistrableDomain (PSL + IDN)", () => {
  it("handles simple domains", () => {
    expect(toRegistrableDomain("news.example.com")).toBe("example.com")
  })
  it("handles multi-label TLDs", () => {
    expect(toRegistrableDomain("a.b.c.gov.uk")).toBe("c.gov.uk")
  })
  it("handles IDN (punycode)", () => {
    expect(toRegistrableDomain("www.xn--bcher-kva.de")).toBe("bücher.de".normalize("NFC").includes("bücher") ? "bücher.de" : "xn--bcher-kva.de")
  })
})

describe("isEspDomain", () => {
  it("detects known ESPs", () => {
    expect(isEspDomain("mail.sparkpostmail.com")).toBe(true)
    expect(isEspDomain("amazonses.com")).toBe(true)
    expect(isEspDomain("marketing.example.com")).toBe(false)
  })
})

describe("normalizeRegistrableDuplicateTld", () => {
  it("collapses duplicated .com.com suffix", () => {
    expect(normalizeRegistrableDuplicateTld("example.com.com")).toBe("example.com")
  })
  it("leaves normal domains intact", () => {
    expect(normalizeRegistrableDuplicateTld("linkedin.com")).toBe("linkedin.com")
    expect(normalizeRegistrableDuplicateTld("foo.co.uk")).toBe("foo.co.uk")
  })
  it("is null-safe", () => {
    expect(normalizeRegistrableDuplicateTld(null)).toBeNull()
    expect(normalizeRegistrableDuplicateTld(undefined)).toBeNull()
  })
})
