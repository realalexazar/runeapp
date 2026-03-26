import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

export async function callClaude(input: {
  system: string
  messages: Array<{ role: "user" | "assistant"; content: string }>
  temperature?: number
  maxTokens?: number
}) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: input.maxTokens || 1024,
    system: input.system,
    temperature: input.temperature ?? 0.7,
    messages: input.messages
  })

  const textBlock = response.content.find(block => block.type === "text")
  return textBlock?.text || ""
}
