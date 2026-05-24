import { z } from "zod"
import { callOpenAIChatCompletion } from "@/lib/openai/chat"
import type { LlmTelemetryContext } from "@/lib/ai/llm-telemetry"
import { extractJsonObject } from "@/lib/ai/json"
import { recordLlmValidationFailure } from "@/lib/ai/llm-validation-failures"

type GatewayTelemetryContext = Omit<LlmTelemetryContext, "validationStatus" | "outputShapeName">

export class LlmSchemaValidationError extends Error {
  constructor(
    message: string,
    readonly outputShapeName: string,
    readonly rawOutput: string,
    readonly validationError: unknown
  ) {
    super(message)
    this.name = "LlmSchemaValidationError"
  }
}

export async function generateOpenAIObject<TSchema extends z.ZodTypeAny>(input: {
  apiKey: string
  model: string
  temperature: number
  messages: Array<{ role: string; content: string }>
  schema: TSchema
  outputShapeName: string
  maxTokens?: number
  telemetry: GatewayTelemetryContext
}): Promise<z.infer<TSchema>> {
  const provider = process.env.OPENROUTER_API_KEY ? "openrouter" : "openai"
  const resp = await callOpenAIChatCompletion({
    apiKey: input.apiKey,
    model: input.model,
    temperature: input.temperature,
    messages: input.messages,
    maxTokens: input.maxTokens,
    telemetry: {
      ...input.telemetry,
      validationStatus: "schema",
      outputShapeName: input.outputShapeName,
      metadata: {
        ...(input.telemetry.metadata || {}),
        gateway: "phase0b"
      }
    }
  })

  const data = await resp.json()
  const rawOutput = data?.choices?.[0]?.message?.content || ""
  const parsed = extractJsonObject(rawOutput)
  const result = input.schema.safeParse(parsed)

  if (!result.success) {
    const validationError = parsed === null
      ? { message: "No JSON object found in model output" }
      : result.error.flatten()

    await recordLlmValidationFailure({
      ...input.telemetry,
      provider,
      model: input.model,
      outputShapeName: input.outputShapeName,
      rawOutput,
      validationError,
      metadata: {
        ...(input.telemetry.metadata || {}),
        gateway: "phase0b"
      }
    })

    throw new LlmSchemaValidationError(
      `LLM output failed schema validation for ${input.outputShapeName}`,
      input.outputShapeName,
      rawOutput,
      validationError
    )
  }

  return result.data
}
