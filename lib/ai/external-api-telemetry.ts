export type ExternalApiTelemetryContext = {
  runId?: string | null
  userId?: string | null
  runeId?: string | null
  slotId?: string | null
  slotRunId?: string | null
  callSiteName: string
  filePath: string
  functionName: string
  provider: "tavily" | "google_news" | "gmail" | "google_oauth" | "web_fetch"
  endpoint: string
  requestUnits?: number | null
  estimatedCostUsd?: number | null
  metadata?: Record<string, any>
}

export function getExternalApiStatusCode(error: any): number | null {
  const candidates = [
    error?.status,
    error?.code,
    error?.response?.status,
    error?.response?.statusCode,
  ]

  for (const value of candidates) {
    const numeric = Number(value)
    if (Number.isInteger(numeric) && numeric >= 100 && numeric <= 599) {
      return numeric
    }
  }

  return null
}

export function getExternalApiResponseStatus(response: any): number | null {
  const candidates = [
    response?.status,
    response?.res?.status,
    response?.response?.status,
  ]

  for (const value of candidates) {
    const numeric = Number(value)
    if (Number.isInteger(numeric) && numeric >= 100 && numeric <= 599) {
      return numeric
    }
  }

  return null
}

export function getExternalApiErrorMessage(error: any): string {
  return String(
    error?.errors?.[0]?.message ||
      error?.response?.data?.error_description ||
      error?.response?.data?.error ||
      error?.message ||
      error
  ).slice(0, 500)
}

export async function recordExternalApiCall(record: ExternalApiTelemetryContext & {
  latencyMs: number
  success: boolean
  statusCode?: number | null
  errorMessage?: string | null
}) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return
  }

  try {
    const { supabaseServiceRole } = await import("@/lib/supabase/service")
    const { error } = await supabaseServiceRole
      .from("external_api_call_telemetry")
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
        endpoint: record.endpoint,
        request_units: record.requestUnits ?? 1,
        estimated_cost_usd: record.estimatedCostUsd ?? null,
        latency_ms: record.latencyMs,
        success: record.success,
        status_code: record.statusCode ?? null,
        error_message: record.errorMessage || null,
        metadata: record.metadata || {}
      })

    if (error) {
      console.warn("[external-api-telemetry] insert failed:", error.message)
    }
  } catch (e: any) {
    console.warn("[external-api-telemetry] record failed:", e?.message || e)
  }
}
