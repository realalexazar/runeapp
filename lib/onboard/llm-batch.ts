/**
 * Batch LLM classification for sender-level newsletter detection
 * Uses subject lines only (fast, cheap, effective)
 */

import pLimit from "p-limit"
import { generateOpenAIObject } from "@/lib/ai/gateway"
import { senderClassificationBatchSchema } from "@/lib/ai/schemas/onboarding"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const BATCH_SIZE = 20 // Candidates per API call
const CONCURRENT_BATCHES = 3 // Max parallel API calls

export interface Candidate {
  sender_key: string
  from_name: string | null
  from_email: string | null
  count_14d: number
  subjects: string[] // Up to 5 subject lines
}

export interface ClassificationResult {
  sender_key: string
  bucket: "positive" | "grey" | "low"
  sample_size: number
  low_confidence: boolean
}

type BatchTelemetryContext = {
  userId?: string | null
}

/**
 * Classify multiple senders using batched LLM calls
 * - If <= 20 candidates: single API call
 * - If > 20 candidates: split into batches of 20 and process concurrently
 */
export async function classifyBatch(candidates: Candidate[], telemetry?: BatchTelemetryContext): Promise<ClassificationResult[]> {
  if (candidates.length === 0) return []

  // Single batch if <= BATCH_SIZE
  if (candidates.length <= BATCH_SIZE) {
    return await classifyBatchSingle(candidates, 0, telemetry)
  }

  // Split into batches and process concurrently
  const chunks: Candidate[][] = []
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    chunks.push(candidates.slice(i, i + BATCH_SIZE))
  }

  const limit = pLimit(CONCURRENT_BATCHES)
  const batchTasks = chunks.map((chunk, chunkIndex) =>
    limit(async () => {
      const offset = chunkIndex * BATCH_SIZE
      return await classifyBatchSingle(chunk, offset, telemetry)
    })
  )

  const allResults = await Promise.all(batchTasks)
  return allResults.flat()
}

/**
 * Classify a single batch of candidates (one API call)
 */
async function classifyBatchSingle(
  candidates: Candidate[],
  offset: number = 0,
  telemetry?: BatchTelemetryContext
): Promise<ClassificationResult[]> {
  // Build batch prompt
  const candidatesText = candidates.map((c, i) => {
    const subjectsText = c.subjects.map((s, j) => `  ${j + 1}. ${s}`).join("\n")
    return `Candidate ${offset + i + 1}:
Sender: ${c.sender_key}${c.from_name ? ` (${c.from_name})` : ""}
Messages in 14d: ${c.count_14d}
Subjects:
${subjectsText}`
  }).join("\n\n")

  const prompt = `You are an expert email classifier. Your task is to identify substantive, knowledge-based newsletters from a list of email senders.

## Data Format
You will receive a list of email senders. For each sender, you will see:
- **Sender**: The domain name (e.g., "theepochtimes.com") and optionally the sender name (e.g., "The Epoch Times")
- **Messages in 14d**: The number of emails received from this sender in the last 14 days
- **Subjects**: Up to 5 most recent subject lines from this sender

## Classification Criteria

A substantive newsletter is:
- Regular email updates (daily, weekly, monthly) that deliver content
- Content-focused: news, articles, analysis, digests, research, insights, commentary
- Knowledge/information dense: educational, informative, thought-provoking
- Examples: The New York Times newsletters, The Atlantic Daily, Stratechery, Morning Brew, Axios newsletters, research digests, industry analysis

NOT a newsletter:
- Transactional emails: receipts, invoices, order confirmations, shipping notifications, password resets, security alerts
- Promotional spam: sales, discounts, deals, coupons, "buy now", clearance sales
- Personal correspondence: one-on-one emails, invitations, calendar invites
- Automated notifications: system alerts, app notifications, account updates
- Examples: Amazon order confirmations, bank statements, promotional emails from retailers

## Sender Data

${candidatesText}

## Classification Instructions

For each candidate, use ALL available information to make your classification:

- **Sender domain/name**: Consider the reputation and type of sender (media organization vs retailer vs service)
- **Message frequency**: Higher frequency (many messages in 14d) suggests regular newsletter cadence
- **Subject lines**: Analyze patterns, topics, and language across all subject lines together
- **Holistic reasoning**: Look at the entire dataset - do the subjects form a coherent content pattern? Is this clearly transactional/promotional, or does it show editorial/informational focus?

Think step-by-step:
1. What type of sender is this? 
2. What do the subject lines reveal about content? (news, analysis, transactions, promotions)
3. Does the message frequency suggest regular content delivery?
4. Taken together, is this a substantive newsletter or something else or uncertain?

Classification options:
- "Yes" = Definitely a substantive newsletter (clear content focus, regular cadence, editorial tone)
- "No" = Definitely NOT a newsletter (transactional, promotional, personal, or automated)
- "Uncertain" = Ambiguous or edge case (could be either, needs human review)

Respond with a JSON object in this exact format:
{
  "classifications": [
    {"candidate": ${offset + 1}, "classification": "Yes"},
    {"candidate": ${offset + 2}, "classification": "Uncertain"},
    {"candidate": ${offset + 3}, "classification": "No"}
  ]
}

Use the candidate number from above (${offset + 1}, ${offset + 2}, etc.).`

  try {
    if (!OPENAI_API_KEY) {
      console.warn("No OpenAI API key configured, marking all as uncertain")
      return candidates.map(c => ({
        sender_key: c.sender_key,
        bucket: "grey" as const,
        sample_size: c.subjects.length,
        low_confidence: c.count_14d < 3
      }))
    }

    const parsed = await generateOpenAIObject({
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.1,
      maxTokens: 500,
      messages: [{ role: "user", content: prompt }],
      schema: senderClassificationBatchSchema,
      outputShapeName: "SenderClassificationBatch",
      telemetry: {
        userId: telemetry?.userId || null,
        callSiteName: "onboard.classify_senders.batch",
        filePath: "lib/onboard/llm-batch.ts",
        functionName: "classifyBatchSingle",
        metadata: {
          offset,
          candidate_count: candidates.length
        }
      }
    })

    return mapClassificationResponse(parsed.classifications, candidates, offset)
  } catch (e) {
    console.error("OpenAI batch classification error:", e)
    // Fallback: mark all as uncertain on error
    return candidates.map(c => ({
      sender_key: c.sender_key,
      bucket: "grey" as const,
      sample_size: c.subjects.length,
      low_confidence: c.count_14d < 3
    }))
  }
}

function mapClassificationResponse(
  classifications: Array<{ candidate: number; classification: "Yes" | "No" | "Uncertain" }>,
  candidates: Candidate[],
  offset: number = 0
): ClassificationResult[] {
  const results: ClassificationResult[] = []

  const resultMap = new Map<number, "Yes" | "No" | "Uncertain">()
  for (const item of classifications) {
    resultMap.set(item.candidate, item.classification)
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidateNumber = offset + i + 1
    const classification = resultMap.get(candidateNumber) || "Uncertain"
    results.push({
      sender_key: candidates[i].sender_key,
      bucket: classification === "Yes" ? "positive" : classification === "Uncertain" ? "grey" : "low",
      sample_size: candidates[i].subjects.length,
      low_confidence: candidates[i].count_14d < 3
    })
  }

  return results
}
