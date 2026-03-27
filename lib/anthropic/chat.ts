import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 60_000,
  maxRetries: 1
})

export async function callClaude(input: {
  system: string
  messages: Array<{ role: "user" | "assistant"; content: string }>
  temperature?: number
  maxTokens?: number
}) {
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
    max_tokens: input.maxTokens || 2048,
    system: input.system,
    temperature: input.temperature ?? 0.7,
    messages: input.messages
  })

  const textBlock = response.content.find(block => block.type === "text")
  return textBlock?.text || ""
} catch (e: any) {
    const status = e?.status || 0
    if (status === 529 || status === 503 || e?.code === "UND_ERR_CONNECT_TIMEOUT") {
      console.warn(`[anthropic] Sonnet unavailable (${status || e?.code}), falling back to Haiku`)
      const fallback = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: input.maxTokens || 2048,
        system: input.system,
        temperature: input.temperature ?? 0.7,
        messages: input.messages
      })

      const textBlock = fallback.content.find(block => block.type === "text")
      return textBlock?.text || ""
    }
    throw e
  }
}
