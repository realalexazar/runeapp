import Anthropic from "@anthropic-ai/sdk"
import {
  estimateMessageTokens,
  estimateTextTokens,
  recordLlmCall,
  type LlmTelemetryContext
} from "@/lib/ai/llm-telemetry"

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
  telemetry?: LlmTelemetryContext
}) {
  const primaryModel = "claude-sonnet-4-20250514"
  const fallbackModel = "claude-haiku-4-5"
  const estimatedInputTokens = estimateTextTokens(input.system) + estimateMessageTokens(input.messages)
  const startedAt = Date.now()

  try {
    const response = await client.messages.create({
      model: primaryModel,
      max_tokens: input.maxTokens || 2048,
      system: input.system,
      temperature: input.temperature ?? 0.7,
      messages: input.messages
    })

    const textBlock = response.content.find(block => block.type === "text")
    if (input.telemetry) {
      await recordLlmCall({
        ...input.telemetry,
        provider: "anthropic",
        model: primaryModel,
        providerRequestId: response.id,
        inputTokens: response.usage?.input_tokens ?? estimatedInputTokens,
        outputTokens: response.usage?.output_tokens ?? (textBlock?.type === "text" ? estimateTextTokens(textBlock.text) : null),
        latencyMs: Date.now() - startedAt,
        success: true
      })
    }
    return textBlock?.text || ""
  } catch (e: any) {
    const status = e?.status || 0
    if (status === 529 || status === 503 || e?.code === "UND_ERR_CONNECT_TIMEOUT") {
      if (input.telemetry) {
        await recordLlmCall({
          ...input.telemetry,
          provider: "anthropic",
          model: primaryModel,
          inputTokens: estimatedInputTokens,
          outputTokens: null,
          latencyMs: Date.now() - startedAt,
          success: false,
          errorMessage: String(e?.message || e),
          metadata: {
            ...(input.telemetry.metadata || {}),
            fallback: true
          }
        })
      }
      console.warn(`[anthropic] Sonnet unavailable (${status || e?.code}), falling back to Haiku`)
      const fallbackStartedAt = Date.now()
      const fallback = await client.messages.create({
        model: fallbackModel,
        max_tokens: input.maxTokens || 2048,
        system: input.system,
        temperature: input.temperature ?? 0.7,
        messages: input.messages
      })

      const textBlock = fallback.content.find(block => block.type === "text")
      if (input.telemetry) {
        await recordLlmCall({
          ...input.telemetry,
          provider: "anthropic",
          model: fallbackModel,
          providerRequestId: fallback.id,
          inputTokens: fallback.usage?.input_tokens ?? estimatedInputTokens,
          outputTokens: fallback.usage?.output_tokens ?? (textBlock?.type === "text" ? estimateTextTokens(textBlock.text) : null),
          latencyMs: Date.now() - fallbackStartedAt,
          success: true,
          metadata: {
            ...(input.telemetry.metadata || {}),
            fallback_from: primaryModel
          }
        })
      }
      return textBlock?.text || ""
    }
    if (input.telemetry) {
      await recordLlmCall({
        ...input.telemetry,
        provider: "anthropic",
        model: primaryModel,
        inputTokens: estimatedInputTokens,
        outputTokens: null,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: String(e?.message || e)
      })
    }
    throw e
  }
}
