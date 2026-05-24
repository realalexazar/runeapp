export function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}

  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {}
  }

  return null
}

export function redactLlmRawOutput(text: string, maxChars = 20_000) {
  return text
    .slice(0, maxChars)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(refresh_token|access_token|client_secret|api_key|authorization)\s*[:=]\s*["']?[^"',\s}]+/gi, "$1:[redacted]")
}
