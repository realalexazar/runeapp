import type { LlmTelemetryContext } from "@/lib/ai/llm-telemetry"
import { redactLlmRawOutput } from "@/lib/ai/json"

type LlmValidationFailureRecord = Omit<LlmTelemetryContext, "validationStatus"> & {
  provider: "anthropic" | "openai" | "openrouter"
  model: string
  outputShapeName: string
  rawOutput: string
  validationError: unknown
}

export async function recordLlmValidationFailure(record: LlmValidationFailureRecord) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return
  }

  try {
    const { supabaseServiceRole } = await import("@/lib/supabase/service")
    const { error } = await supabaseServiceRole
      .from("llm_validation_failures")
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
        output_shape_name: record.outputShapeName,
        raw_output: redactLlmRawOutput(record.rawOutput),
        validation_error: record.validationError,
        metadata: {
          ...(record.metadata || {}),
          retention_days: 30,
          raw_output_redacted: true
        }
      })

    if (error) {
      console.warn("[llm-validation-failures] insert failed:", error.message)
    }
  } catch (e: any) {
    console.warn("[llm-validation-failures] record failed:", e?.message || e)
  }
}
