export type LlmValidationStatus = "none" | "regex" | "schema" | "manual"

export type LlmTelemetryContext = {
  runId?: string | null
  userId?: string | null
  runeId?: string | null
  slotId?: string | null
  slotRunId?: string | null
  callSiteName: string
  filePath: string
  functionName: string
  validationStatus: LlmValidationStatus
  outputShapeName?: string | null
  metadata?: Record<string, any>
}

type LlmTelemetryRecord = LlmTelemetryContext & {
  provider: "anthropic" | "openai" | "openrouter"
  model: string
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs: number
  success: boolean
  errorMessage?: string | null
  providerRequestId?: string | null
}

type ModelPricing = {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
}

const MODEL_PRICING_USD_PER_1M_TOKENS: Record<string, ModelPricing> = {
  "gpt-4o": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 },
  "gpt-4o-mini": { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
  "claude-sonnet-4-20250514": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  "claude-haiku-4-5": { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
  "claude-3-5-haiku-20241022": { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 },
  "claude-3-5-haiku-latest": { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 }
}

function estimateCostUsd(input: {
  model: string
  inputTokens?: number | null
  outputTokens?: number | null
}) {
  const pricing = MODEL_PRICING_USD_PER_1M_TOKENS[input.model]
  if (!pricing) return null

  const inputCost = ((input.inputTokens || 0) / 1_000_000) * pricing.inputUsdPerMillion
  const outputCost = ((input.outputTokens || 0) / 1_000_000) * pricing.outputUsdPerMillion
  return Number((inputCost + outputCost).toFixed(8))
}

export function estimateTextTokens(text: string) {
  return Math.ceil(text.length / 4)
}

export function estimateMessageTokens(messages: Array<{ content: string }>) {
  return messages.reduce((sum, message) => sum + estimateTextTokens(message.content || ""), 0)
}

export async function recordLlmCall(record: LlmTelemetryRecord) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return
  }

  try {
    const { supabaseServiceRole } = await import("@/lib/supabase/service")
    const estimatedCostUsd = estimateCostUsd({
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens
    })

    const { error } = await supabaseServiceRole
      .from("llm_call_telemetry")
      .insert({
        run_id: record.runId || null,
        user_id: record.userId || null,
        rune_id: record.runeId || null,
        slot_id: record.slotId || null,
        slot_run_id: record.slotRunId || null,
        call_site_name: record.callSiteName,
        file_path: record.filePath,
        function_name: record.functionName,
        provider: record.provider,
        model: record.model,
        provider_request_id: record.providerRequestId || null,
        input_tokens: record.inputTokens ?? null,
        output_tokens: record.outputTokens ?? null,
        estimated_cost_usd: estimatedCostUsd,
        latency_ms: record.latencyMs,
        success: record.success,
        error_message: record.errorMessage || null,
        validation_status: record.validationStatus,
        output_shape_name: record.outputShapeName || null,
        metadata: {
          ...(record.metadata || {}),
          pricing_source: "static_phase_0a_rate_card",
          pricing_missing: estimatedCostUsd === null
        }
      })

    if (error) {
      console.warn("[llm-telemetry] insert failed:", error.message)
    }
  } catch (e: any) {
    console.warn("[llm-telemetry] record failed:", e?.message || e)
  }
}
