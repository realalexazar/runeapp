import {
  estimateMessageTokens,
  recordLlmCall,
  type LlmTelemetryContext
} from "@/lib/ai/llm-telemetry"

const OPENAI_API_URL = process.env.OPENROUTER_API_KEY
  ? "https://openrouter.ai/api/v1/chat/completions"
  : "https://api.openai.com/v1/chat/completions"
const CONNECT_TIMEOUT_MS = 30000
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 1200

let openAiDispatcherPromise: Promise<any> | null = null

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getOpenAiDispatcher() {
  if (!openAiDispatcherPromise) {
    openAiDispatcherPromise = import("undici").then((undici) => {
      const Agent = (undici as any).Agent
      return new Agent({
        connectTimeout: CONNECT_TIMEOUT_MS
      })
    })
  }
  return openAiDispatcherPromise
}

export function isTransientNetworkError(err: any): boolean {
  const code = String(err?.cause?.code || err?.code || "")
  const message = String(err?.message || err || "").toLowerCase()
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    message.includes("connect timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("network")
  )
}

export async function callOpenAIChatCompletion(input: {
  apiKey: string
  model: string
  temperature: number
  messages: Array<{ role: string; content: string }>
  maxTokens?: number
  telemetry?: LlmTelemetryContext
}) {
  let lastError: any = null
  const startedAt = Date.now()
  const provider = process.env.OPENROUTER_API_KEY ? "openrouter" : "openai"
  const estimatedInputTokens = estimateMessageTokens(input.messages)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const dispatcher = await getOpenAiDispatcher()
      const apiKey = process.env.OPENROUTER_API_KEY || input.apiKey
      const resp = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: input.model,
          temperature: input.temperature,
          messages: input.messages,
          ...(input.maxTokens ? { max_tokens: input.maxTokens } : {})
        }),
        // Next.js runtime accepts extra undici options at runtime.
        dispatcher
      } as any)

      if (!resp.ok) {
        throw new Error(`OpenAI request failed (${resp.status})`)
      }

      if (input.telemetry) {
        const usagePayload = await resp.clone().json().catch(() => null)
        const usage = usagePayload?.usage || {}
        const inputTokens = Number(usage.prompt_tokens || usage.input_tokens) || estimatedInputTokens
        const outputTokens = Number(usage.completion_tokens || usage.output_tokens) || null

        await recordLlmCall({
          ...input.telemetry,
          provider,
          model: input.model,
          providerRequestId: usagePayload?.id || resp.headers.get("x-request-id"),
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - startedAt,
          success: true,
          metadata: {
            ...(input.telemetry.metadata || {}),
            attempt
          }
        })
      }

      return resp
    } catch (e: any) {
      lastError = e
      if (!isTransientNetworkError(e) || attempt === MAX_ATTEMPTS) {
        if (input.telemetry) {
          await recordLlmCall({
            ...input.telemetry,
            provider,
            model: input.model,
            inputTokens: estimatedInputTokens,
            outputTokens: null,
            latencyMs: Date.now() - startedAt,
            success: false,
            errorMessage: String(e?.message || e),
            metadata: {
              ...(input.telemetry.metadata || {}),
              attempt
            }
          })
        }
        throw e
      }
      await sleep(BASE_BACKOFF_MS * attempt)
    }
  }

  throw lastError || new Error("OpenAI request failed")
}
