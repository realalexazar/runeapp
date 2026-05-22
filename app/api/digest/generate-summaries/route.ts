import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import pLimit from "p-limit"
import { convert } from "html-to-text"
import { callOpenAIChatCompletion, isTransientNetworkError } from "@/lib/openai/chat"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const BATCH_SIZE = 12 // Conservative batch size (10-15 range)
const CONCURRENT_BATCHES = 3 // Max parallel API calls

// Style-based content length limits (chars, ~1 token = 4 chars)
// Can be overridden for testing via request body
// Phase 2: Increased truncation limits
const DEFAULT_CONTENT_LIMITS: Record<string, number> = {
  "morning-brief": 15000,   // ~3.75k tokens - increased from 10k
  "reference-mode": 20000,  // ~5k tokens - increased from 15k
  "deep-read": 30000        // ~7.5k tokens - increased from 25k
}

const MAX_SUMMARY_LENGTH = 2000 // Max chars for summary output (prevents UI issues)
const MIN_CONTENT_LENGTH = 100 // Minimum content length before skipping LLM (sparse content protocol)

/**
 * POST /api/digest/generate-summaries
 * 
 * Generates LLM summaries for fetched email content.
 * Reads from digest_items where digest_id IS NULL (temporary storage).
 * Updates content_summary field for each item.
 * 
 * Body: { lookback_days?: number, style?: string, regenerate?: boolean, truncation_limit?: number, batch_size?: number, concurrent_batches?: number, model?: string }
 * - lookback_days: Override (for dev mode)
 * - style: 'morning-brief' | 'deep-read' | 'reference-mode' (defaults to user's config)
 * - regenerate: If true, clear existing summaries and regenerate
 * - truncation_limit: Override default truncation limit
 * - batch_size: Override default batch size
 * - concurrent_batches: Override concurrent batch processing
 * - model: 'gpt-4o-mini' or 'gpt-4o'
 */
export async function POST(req: Request) {
  const startTime = Date.now()
  const supabase = await getSupabaseServerClient()

  try {
    const authResult = await supabase.auth.getUser()
    if (authResult.error) {
      const retryable = isTransientNetworkError(authResult.error)
      return NextResponse.json({
        ok: false,
        retryable,
        error: retryable
          ? "Temporary auth connectivity issue. Please retry."
          : "Failed to validate session."
      }, { status: retryable ? 503 : 500 })
    }

    const user = authResult.data.user
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const lookbackDays = body.lookback_days ? parseInt(body.lookback_days) : null
    const styleOverride = body.style || null // For dev mode testing
    const regenerate = body.regenerate === true // If true, clear existing summaries and regenerate
    
    // Testing parameters (for iteration testing)
    const truncationLimitOverride = body.truncation_limit ? parseInt(body.truncation_limit) : null
    const batchSizeOverride = body.batch_size ? parseInt(body.batch_size) : null
    const concurrentBatchesOverride = body.concurrent_batches ? parseInt(body.concurrent_batches) : null
    const modelOverride = body.model || null // 'gpt-4o-mini' or 'gpt-4o'

    // Get user's digest config (for style if not overridden)
    let userStyle = styleOverride
    if (!userStyle) {
      const { data: config } = await supabaseServiceRole
        .from("digest_configs")
        .select("style")
        .eq("user_id", user.id)
        .single()
      userStyle = config?.style || "morning-brief" // Default fallback
    }

    // Check if items exist (with or without summaries)
    const { data: allItems } = await supabaseServiceRole
      .from("digest_items")
      .select("id, content_summary")
      .eq("user_id", user.id)
      .is("digest_id", null)
      .limit(1)

    if (!allItems || allItems.length === 0) {
      return NextResponse.json({
        ok: true,
        summaries_generated: 0,
        message: "No items found to summarize. Run 'Fetch Selected Emails' first."
      })
    }

    // If regenerate is true, clear existing summaries first
    if (regenerate) {
      const { error: clearErr } = await supabaseServiceRole
        .from("digest_items")
        .update({ content_summary: null })
        .eq("user_id", user.id)
        .is("digest_id", null)
        .not("content_summary", "is", null)
      
      if (clearErr) {
        return NextResponse.json({ ok: false, error: `Failed to clear summaries: ${clearErr.message}` }, { status: 500 })
      }
    }

    // Get temporary items (digest_id IS NULL) that need summarization
    const { data: items, error: itemsErr } = await supabaseServiceRole
      .from("digest_items")
      .select("id, sender_key, newsletter_name, subject, html_content, text_content, links")
      .eq("user_id", user.id)
      .is("digest_id", null)
      .is("content_summary", null) // Only summarize if not already done
      .order("received_at", { ascending: false })

    if (itemsErr) {
      return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 })
    }

    if (!items || items.length === 0) {
      // Check if summaries already exist
      const { data: existingSummaries } = await supabaseServiceRole
        .from("digest_items")
        .select("id, content_summary")
        .eq("user_id", user.id)
        .is("digest_id", null)
        .not("content_summary", "is", null)
        .limit(1)

      if (existingSummaries && existingSummaries.length > 0) {
        return NextResponse.json({
          ok: true,
          summaries_generated: 0,
          message: "Summaries already generated for these items. Fetch new emails to generate more summaries."
        })
      }

      return NextResponse.json({
        ok: true,
        summaries_generated: 0,
        message: "No items found to summarize. Run 'Fetch Selected Emails' first."
      })
    }

    // Prepare content for LLM (preprocess, strip boilerplate, truncate by style)
    const itemsToSummarize = items.map(item => {
      // Prefer text_content, fallback to html_content
      let rawContent = item.text_content || item.html_content || ""
      
      // Convert HTML to plain text if needed (Phase 1: HTML Preprocessing)
      if (item.html_content && !item.text_content) {
        rawContent = convertHtmlToText(item.html_content)
      }
      
      // Strip boilerplate (unsubscribe links, footers, etc.)
      let cleanedContent = stripBoilerplate(rawContent)
      
      // Safety Valve: If we had substantial content but cleaned is tiny, the trimmer was too aggressive
      // Fallback to simple truncation to ensure LLM has something to read
      if (rawContent.length > 2000 && cleanedContent.length < 200) {
        console.warn(`Boilerplate stripping too aggressive for item ${item.id}: ${rawContent.length} -> ${cleanedContent.length} chars. Using raw content.`)
        cleanedContent = rawContent // Use raw content, will be truncated below
      }
      
      // Phase 2: Dynamic truncation based on content length
      const baseLimit = truncationLimitOverride || DEFAULT_CONTENT_LIMITS[userStyle] || DEFAULT_CONTENT_LIMITS["morning-brief"]
      const contentLength = cleanedContent.length
      
      let maxChars: number
      if (contentLength < 15000) {
        // Full pass for shorter emails
        maxChars = contentLength
      } else if (contentLength <= 30000) {
        // Allow up to 30k for medium-length emails
        maxChars = 30000
      } else {
        // For very long emails, use base limit (will be chunked later if needed)
        maxChars = baseLimit
      }
      
      const truncatedContent = cleanedContent.length > maxChars
        ? cleanedContent.substring(0, maxChars) + "\n\n[... truncated for digest ...]"
        : cleanedContent

      // Sparse Content Protocol: Detect if content is too sparse for LLM
      let skip_llm = false
      let skip_reason: string | null = null
      
      if (!truncatedContent || truncatedContent.length === 0) {
        skip_llm = true
        skip_reason = 'EMPTY'
      } else if (truncatedContent.length < MIN_CONTENT_LENGTH) {
        skip_llm = true
        skip_reason = 'SPARSE'
      }
      
      // For sparse/empty emails, inject subject line as content hint
      let finalContent = truncatedContent
      if (skip_llm && item.subject) {
        // Prepend subject line for LLM context (even if we skip, this helps with fallback)
        finalContent = `Subject: ${item.subject}\n\n${truncatedContent || 'This email contains minimal text content.'}`
      }

      return {
        id: item.id,
        sender_key: item.sender_key,
        newsletter_name: item.newsletter_name,
        subject: item.subject || "",
        content: finalContent, // For LLM (may include subject injection)
        originalContent: truncatedContent, // Original preprocessed content (for storage)
        links: (item.links as string[]) || [],
        skip_llm,
        skip_reason
      }
    })

    // Create map of item_id -> original preprocessed_content (before subject injection)
    const preprocessedContentMap = new Map<string, string>()
    itemsToSummarize.forEach(item => {
      preprocessedContentMap.set(item.id, item.originalContent)
    })

    // Sparse Content Protocol: Separate valid items from sparse items
    const validItems = itemsToSummarize.filter(item => !item.skip_llm)
    const sparseItems = itemsToSummarize.filter(item => item.skip_llm)
    
    // Generate LLM summaries only for valid items
    const summaries = validItems.length > 0
      ? await summarizeBatch(
          user.id,
          validItems, 
          userStyle,
          batchSizeOverride || BATCH_SIZE,
          concurrentBatchesOverride || CONCURRENT_BATCHES,
          modelOverride || "gpt-4o-mini"
        )
      : []
    
    // Generate fallback summaries for sparse items (no LLM call)
    const fallbackSummaries = sparseItems.map(item => {
      let fallbackSummary = ""
      
      if (item.skip_reason === 'EMPTY') {
        fallbackSummary = "Unable to extract content from this email. Please view the original email."
      } else if (item.skip_reason === 'SPARSE') {
        // For sparse emails, try to generate something useful from subject line
        if (item.subject) {
          // Use subject line to create a basic summary
          fallbackSummary = `This email contains minimal text content. Subject: ${item.subject}`
        } else {
          fallbackSummary = "This email contains minimal text content. Please view the original email."
        }
      }
      
      return {
        item_id: item.id,
        summary: fallbackSummary,
        skip_reason: item.skip_reason
      }
    })
    
    // Combine LLM summaries and fallback summaries
    const allSummaries = [...summaries, ...fallbackSummaries]

    // Update digest_items with summaries and preprocessed content
    let updated = 0
    const errors: Array<{ item_id: string; error: string }> = []

    for (const summary of allSummaries) {
      const preprocessedContent = preprocessedContentMap.get(summary.item_id) || null
      const skipReason = 'skip_reason' in summary ? summary.skip_reason : null
      
      const { error: updateErr } = await supabaseServiceRole
        .from("digest_items")
        .update({ 
          content_summary: summary.summary,
          preprocessed_content: preprocessedContent, // Store exact content sent to LLM
          skip_reason: skipReason // Store skip reason (NULL for normal processing)
        })
        .eq("id", summary.item_id)
        .eq("user_id", user.id)

      if (updateErr) {
        errors.push({ item_id: summary.item_id, error: updateErr.message })
      } else {
        updated++
      }
    }

    const elapsed = Date.now() - startTime

    // Calculate approximate cost (for testing tracking)
    // Rough estimates: gpt-4o-mini: $0.15/$0.60 per 1M tokens, gpt-4o: $2.50/$10 per 1M tokens
    const modelUsed = modelOverride || "gpt-4o-mini"
    const inputCostPer1M = modelUsed === "gpt-4o" ? 2.50 : 0.15
    const outputCostPer1M = modelUsed === "gpt-4o" ? 10.00 : 0.60
    
    // Rough token estimation (4 chars = 1 token, add 20% overhead for prompt)
    // Only count valid items (sparse items don't use LLM)
    const estimatedInputTokens = validItems.reduce((sum, item) => sum + Math.ceil(item.content.length / 4 * 1.2), 0)
    const estimatedOutputTokens = summaries.reduce((sum, s) => sum + Math.ceil(s.summary.length / 4), 0)
    const estimatedCost = (estimatedInputTokens / 1_000_000 * inputCostPer1M) + (estimatedOutputTokens / 1_000_000 * outputCostPer1M)

    return NextResponse.json({
      ok: true,
      summaries_generated: updated,
      summaries_failed: allSummaries.length - updated,
      summaries_skipped: sparseItems.length, // New: count of sparse items skipped
      style_used: userStyle,
      batches_processed: summaries.length > 0 ? Math.ceil(validItems.reduce((sum, item) => sum + item.content.length, 0) / 50000) : 0,
      time_ms: elapsed,
      model_used: modelUsed,
      estimated_cost: estimatedCost,
      estimated_input_tokens: estimatedInputTokens,
      estimated_output_tokens: estimatedOutputTokens,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined
    })

  } catch (e: any) {
    console.error("Error generating summaries:", e)
    const retryable = isTransientNetworkError(e)
    return NextResponse.json({
      ok: false,
      retryable,
      error: retryable
        ? "Temporary network issue while generating summaries. Please retry."
        : String(e.message || e)
    }, { status: retryable ? 503 : 500 })
  }
}

/**
 * Batch summarize items using LLM
 * Phase 4: Batching by character count instead of item count
 */
async function summarizeBatch(
  userId: string,
  items: Array<{ id: string; sender_key: string | null; newsletter_name: string | null; subject: string; content: string; links: string[] }>,
  style: string,
  batchSize: number = BATCH_SIZE,
  concurrentBatches: number = CONCURRENT_BATCHES,
  model: string = "gpt-4o-mini"
): Promise<Array<{ item_id: string; summary: string }>> {
  if (items.length === 0) return []

  // Phase 4: Group by character count (~50k chars per batch = ~12-15k tokens)
  const MAX_CHARS_PER_BATCH = 50000
  const chunks: typeof items[] = []
  let currentBatch: typeof items = []
  let currentCharCount = 0

  for (const item of items) {
    const itemChars = item.content.length
    // If adding this item would exceed limit and we have items, start new batch
    if (currentCharCount + itemChars > MAX_CHARS_PER_BATCH && currentBatch.length > 0) {
      chunks.push(currentBatch)
      currentBatch = [item]
      currentCharCount = itemChars
    } else {
      currentBatch.push(item)
      currentCharCount += itemChars
    }
  }
  
  // Add remaining batch
  if (currentBatch.length > 0) {
    chunks.push(currentBatch)
  }

  // Single batch - process directly
  if (chunks.length === 1) {
    return await summarizeBatchSingle(userId, chunks[0], 0, style, model)
  }

  // Multiple batches - process concurrently
  const limit = pLimit(concurrentBatches)
  let offset = 0
  const batchTasks = chunks.map((chunk) =>
    limit(async () => {
      const currentOffset = offset
      offset += chunk.length
      return await summarizeBatchSingle(userId, chunk, currentOffset, style, model)
    })
  )

  const allResults = await Promise.all(batchTasks)
  return allResults.flat()
}

/**
 * Summarize a single batch of items (one LLM call)
 */
async function summarizeBatchSingle(
  userId: string,
  items: Array<{ id: string; sender_key: string | null; newsletter_name: string | null; subject: string; content: string; links: string[] }>,
  offset: number,
  style: string,
  model: string = "gpt-4o-mini"
): Promise<Array<{ item_id: string; summary: string }>> {
  // Build style-specific prompt
  const stylePrompts = {
    "morning-brief": {
      instruction: `Your goal: Deliver a complete morning brief that allows the reader to understand all key stories without reading the underlying articles.

Format: For each main story or article, provide:
- Headline: One headline capturing the main takeaways and central themes
- Bullets: As many bullet points as necessary to cover the most important facts and details

CRITICAL: Extract and summarize EVERY main story or article separately. If an email contains multiple unrelated articles or stories, provide a separate headline and bullets for EACH one. There is no limit—provide as many headlines and bullet points as needed to deliver a complete morning brief. The reader should be able to skim your summary and understand all key stories without reading the underlying articles.

Focus on extracting concrete information: numbers, names, dates, and specific facts that make each story unique. Include as many bullets as needed to cover the highlights—let the content determine the number. If content includes "[... truncated for digest ...]", summarize only what exists. End with a brief implication when it adds value. Use neutral, professional tone.

For opportunity-based emails (internships, programs, offers), prioritize the action: who is it for, what is the deadline, and how do they apply?`,
      tone: "Concise and fact-dense"
    },
    "deep-read": {
      instruction: `Provide a detailed summary with context, insights, and important details. This summary should be as long as needed to constitute a "deep read" of the source material (a few setences to paragraphs as necessary).

- Synthesize information to highlight key takeaways and why they matter.
- Add background context, implications, or connections that help readers understand the significance.
- Make dense or technical content more accessible.`,
      tone: "Comprehensive and analytical"
    },
    "reference-mode": {
      instruction: `Provide a structured summary with main topics and key points.

- Format: Start with main topics, the list key points for each topic.
- Synthesize information to highlight what matters most.
- Add context or implications where helpful.
- For multi-article newsletters, organize by topic.
- Use clear structure: topic first, then bullet points or numbered items.`,
      tone: "Structured and organized"
    }
  }

  const styleConfig = stylePrompts[style as keyof typeof stylePrompts] || stylePrompts["morning-brief"]

  // Build items text for LLM (with unique IDs)
  const itemsText = items.map((item) => {
    const linksText = item.links.length > 0
      ? `\nTopLinks: ${item.links.slice(0, 5).join(", ")}${item.links.length > 5 ? " ..." : ""}`
      : ""
    return `BEGIN_ITEM ${item.id}
SenderOrBrand: ${item.newsletter_name || item.sender_key || "Unknown"}
SubjectLine: ${item.subject || "No subject"}
${linksText}
BodyText:
${item.content}
END_ITEM ${item.id}`
  }).join("\n\n")

  // Build system prompt
  const systemPrompt = `You are an expert newsletter summarizer for a professional inbox digest.

Your task: create ${styleConfig.tone} summaries that help readers quickly understand what matters.

Guidelines:
- Synthesize the email content to highlight key takeaways and why they matter.
- Extract concrete information: numbers, names, dates, and specific facts that make each story unique.
- AVOID FILLER. WE WANT THE USERS TO RECEIVE SUBSTANCE.
- Add context, implications, or background information when it helps readers understand the significance of the story.
- Make dense or technical content more accessible and actionable.
- Be brief but useful—let specificity and newsletter content guide length.
- Respond with a single valid JSON object only.
- Do not wrap the JSON in backticks or markdown.

## Strict Isolation Rule
Each summary must be derived EXCLUSIVELY from the text between its specific BEGIN_ITEM and END_ITEM markers. Do not let details from one item influence the summary of another. However, you may add relevant background knowledge, context, or implications that help readers understand the significance of the story (e.g., explaining who a person is, what an event means, or why it matters).

## Instructions
${styleConfig.instruction}

## Output Format
Respond with a JSON object where each key is the unique item ID (the identifier shown in BEGIN_ITEM markers above) and the value is the summary text.

IMPORTANT: Use the exact item ID from the BEGIN_ITEM markers as the JSON key (e.g., "${items[0]?.id || "example-id"}"), NOT sequential numbers.

Each summary must follow this format:
- Start with "Headline: " followed by one headline capturing the main takeaways and central themes
- Then include bullet points (•) with the most important facts and details
- Include as many bullets as needed to cover the highlights—let the content determine the number

Example format:
{
  "${items[0]?.id || "example-id-1"}": "Headline: [headline text]\\n• [important fact/detail]\\n• [important fact/detail]\\n• [additional detail if needed]",
  "${items[1]?.id || "example-id-2"}": "Headline: [headline text]\\n• [important fact/detail]"
}

Use the exact item ID from BEGIN_ITEM markers as keys (e.g., "${items[0]?.id || "example-id"}"), NOT "1", "2", "3", etc.
The number of bullets should match the content—some stories need one bullet, others need several.`

  const userPrompt = `Summarize the following newsletters. Each item starts with "BEGIN_ITEM" and ends with "END_ITEM".

${itemsText}`

  // Call OpenAI
  let responseText: string
  try {
    if (!OPENAI_API_KEY) {
      throw new Error("OpenAI API key not configured")
    }

    const response = await callOpenAIChatCompletion({
      apiKey: OPENAI_API_KEY,
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      telemetry: {
        userId,
        callSiteName: "digest.dev_generate_summaries.batch",
        filePath: "app/api/digest/generate-summaries/route.ts",
        functionName: "summarizeBatchSingle",
        validationStatus: "regex",
        outputShapeName: "NewsletterSummaryArray",
        metadata: {
          batch_item_count: items.length,
          offset,
          style
        }
      }
    })

    const data = await response.json()
    responseText = data.choices[0]?.message?.content || "{}"
  } catch (e: any) {
    console.error("OpenAI API call failed:", e)
    throw e
  }

  // Parse JSON response
  let parsed: Record<string, string>
  try {
    // Try to extract JSON if wrapped in markdown
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0])
    } else {
      parsed = JSON.parse(responseText)
    }
  } catch (parseErr: any) {
    console.error("Failed to parse LLM response as JSON:", parseErr)
    console.error("Raw response:", responseText)
    // Fallback: return error summaries
    return items.map(item => ({
      item_id: item.id,
      summary: `[Failed to parse summary: ${parseErr.message}]`
    }))
  }

  // Map parsed results back to items
  // Try item.id first, then fallback to sequential numbers (in case LLM didn't follow instructions)
  const results = items.map((item, i) => {
    // First try: Use item.id as key (correct approach)
    let summary = parsed[item.id]
    
    // Fallback: If not found, try sequential number (offset + i + 1)
    if (!summary) {
      const sequentialKey = String(offset + i + 1)
      summary = parsed[sequentialKey]
    }
    
    // If still not found, return error message
    if (!summary) {
      return {
        item_id: item.id,
        summary: `[Missing summary for item ${item.id} - LLM may have used wrong key format]`
      }
    }
    
    return {
      item_id: item.id,
      summary: typeof summary === "string" ? cleanSummary(summary) : "[Invalid summary format]"
    }
  })

  return results
}

/**
 * Convert HTML to plain text (Phase 1: HTML Preprocessing)
 * Strips HTML tags, CSS, tracking pixels while preserving content structure
 * 
 * Improvements (Gemini recommendations):
 * - Size limit check (200k chars) to prevent timeout on serverless
 * - Base64 image stripping before processing
 * - Better fallback for large/complex HTML
 */
function convertHtmlToText(html: string): string {
  if (!html) return ""
  
  // CRITICAL ORDER: Base64 stripping MUST be first to prevent ReDoS attacks
  // Base64 image strings can be massive (2MB+) and cause CPU slowdown/ReDoS if processed by regex
  // Strip Base64 image bloat before any other processing (can turn 10kb into 1MB)
  html = html.replace(/data:image\/[^;]+;base64,[^\s"'>]+/gi, '[image removed]')
  
  // Size limit check: Skip html-to-text library for very large files (prevent timeout)
  const MAX_HTML_SIZE = 200000 // 200k chars
  if (html.length > MAX_HTML_SIZE) {
    console.warn(`HTML too large (${html.length} chars), using fallback regex extraction`)
    return basicHtmlFallback(html)
  }
  
  try {
    let text = convert(html, {
      wordwrap: false, // Don't wrap lines
      preserveNewlines: true, // Keep line breaks
      selectors: [
        { selector: "a", options: { ignoreHref: false } }, // Keep links with URLs
        { selector: "img", format: "skip" }, // Skip images
        { selector: "style", format: "skip" }, // Skip CSS
        { selector: "script", format: "skip" }, // Skip scripts
        { selector: "noscript", format: "skip" }, // Skip noscript
      ],
      // Skip common email tracking patterns
      longWordSplit: {
        wrapCharacters: [],
        forceWrapOnLimit: false
      }
    })
    
    // Strip invisible non-breaking spaces and normalize whitespace
    text = text.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s\s+/g, ' ').trim()
    
    // Validate output isn't empty or suspiciously short
    if (!text || text.trim().length < 50) {
      console.warn("html-to-text returned empty/short result, using fallback")
      return basicHtmlFallback(html)
    }
    
    return text
  } catch (e) {
    console.error("Error converting HTML to text:", e)
    return basicHtmlFallback(html)
  }
}

/**
 * Basic HTML fallback: regex-based tag stripping for large/complex HTML
 * Faster than html-to-text library but less accurate
 * 
 * CRITICAL: Base64 stripping MUST be first to prevent ReDoS attacks
 */
function basicHtmlFallback(html: string): string {
  // CRITICAL: Strip Base64 images FIRST (before any regex operations)
  // Base64 strings can be massive (2MB+) and cause ReDoS if processed by regex
  html = html.replace(/data:image\/[^;]+;base64,[^\s"'>]+/gi, '[image removed]')
  
  // Remove script and style tags completely
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
  
  // Convert common HTML entities
  text = text.replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
  
  // Remove HTML tags but preserve text content
  text = text.replace(/<[^>]*>/g, " ")
  
  // Normalize whitespace
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  
  return text
}

/**
 * Strip boilerplate content (unsubscribe links, footers, etc.)
 * 
 * Improvements (Gemini recommendations):
 * - "Only URL + short line" rule: Remove lines with URLs ONLY if line is short (<100 chars)
 *   This preserves substantive news lines that happen to contain links
 * - More selective URL filtering
 */
function stripBoilerplate(text: string): string {
  if (!text) return ""
  
  const lines = text.split("\n")
  const filtered = lines.filter(line => {
    const l = line.toLowerCase().trim()
    if (!l) return false

    // CRITICAL FIX: "Only URL + short line" rule
    // Remove tracking URLs ONLY if the line is short (<100 chars)
    // This preserves substantive news lines like "The Fed met yesterday (read more: https://...)"
    const hasTrackingUrl = l.match(/https?:\/\/[^\s]*(lists\.|links\.|email-st\.|track\/click|utm_source|utm_campaign|utm_medium)/i)
    if (hasTrackingUrl && l.length < 100) {
      return false
    }
    
    // Remove social media links ONLY if line is short
    const hasSocialUrl = l.match(/https?:\/\/[^\s]*(facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|threads)/i)
    if (hasSocialUrl && l.length < 100) {
      return false
    }
    
    // Remove lines that are mostly URLs (>50% of line is URLs) - keep this rule
    const urlMatches = l.match(/https?:\/\/[^\s]+/g) || []
    const urlLength = urlMatches.reduce((sum, url) => sum + url.length, 0)
    if (urlLength > l.length * 0.5) {
      return false
    }

    // Footer pattern matching (unchanged - these are always boilerplate)
    const footerPatterns = [
      /share this email/i,
      /received this email from a friend/i,
      /trouble viewing this email/i,
      /view in browser/i,
      /manage my subscriptions/i,
      /click here to subscribe/i,
      /you are receiving this/i,
      /sent by/i,
      /this email was sent to/i,
      /unsubscribe/i,
      /update your preferences/i,
      /forward this email/i,
      /privacy policy/i,
      /terms of service/i,
      /sponsored by/i,
      /advertisement/i,
      /advertiser's note/i
    ]
    
    if (footerPatterns.some(pattern => pattern.test(l))) {
      return false
    }
    
    // Remove copyright lines
    if (l.match(/© \d{4}/)) return false
    
    // Remove physical addresses (street number + city/state pattern)
    if (l.match(/\d+\s+\w+\s+(st|street|ave|avenue|rd|road|blvd|boulevard|way|dr|drive)[\s,]+/i) ||
        l.match(/,\s*[A-Z]{2}\s+\d{5}/)) {
      return false
    }
    
    // Remove legal disclaimers
    const legalPatterns = [
      /past performance is no guarantee/i,
      /any content and tools/i,
      /no recommendation or advice/i,
      /does not take account/i
    ]
    
    if (legalPatterns.some(pattern => pattern.test(l))) {
      return false
    }

    return true
  })

  // Clean up excessive whitespace (max 2 consecutive newlines)
  return filtered.join("\n")
    .replace(/\n{4,}/g, "\n\n")
    .trim()
}

/**
 * Clean summary output (normalize whitespace, cap length)
 */
function cleanSummary(summary: string): string {
  if (!summary || typeof summary !== "string") {
    return "[Invalid summary format]"
  }

  // Normalize whitespace (multiple spaces/newlines → single)
  let cleaned = summary
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()

  // Cap length to prevent UI issues
  if (cleaned.length > MAX_SUMMARY_LENGTH) {
    cleaned = cleaned.substring(0, MAX_SUMMARY_LENGTH) + "..."
  }

  return cleaned
}
