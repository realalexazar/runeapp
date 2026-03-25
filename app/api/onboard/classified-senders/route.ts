import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"

function isTransientNetworkError(err: any): boolean {
  const code = String(err?.cause?.code || err?.code || "")
  const message = String(err?.message || err || "").toLowerCase()
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    message.includes("connect timeout") ||
    message.includes("fetch failed") ||
    message.includes("network")
  )
}

/**
 * GET /api/onboard/classified-senders
 * 
 * Fetches all classified senders with newsletter names and selection state.
 * Returns all senders (Yes/Grey/No) for display in the newsletter selection UI.
 */
export async function GET() {
  const supabase = await getSupabaseServerClient()

  try {
    const authResult = await supabase.auth.getUser()
    if (authResult.error) {
      const status = isTransientNetworkError(authResult.error) ? 503 : 500
      return NextResponse.json({
        ok: false,
        retryable: isTransientNetworkError(authResult.error),
        error: isTransientNetworkError(authResult.error)
          ? "Temporary auth connectivity issue. Please retry."
          : "Failed to validate session."
      }, { status })
    }

    const user = authResult.data.user
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    // Step 1: Get all classified senders from digest_candidates
    const { data: candidates, error: candidatesErr } = await supabaseServiceRole
      .from("digest_candidates")
      .select("sender_key, bucket, msgs_14d, classifier_source, low_confidence")
      .eq("user_id", user.id)

    if (candidatesErr) {
      return NextResponse.json({ ok: false, error: candidatesErr.message }, { status: 500 })
    }

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ 
        ok: true, 
        senders: [],
        message: "No classified senders found. Run 'Classify Senders' first." 
      })
    }

    // Step 2: Get most common from_name per sender_key from messages_raw
    const senderKeys = candidates.map(c => c.sender_key).filter(Boolean)
    
    const { data: messages, error: messagesErr } = await supabaseServiceRole
      .from("messages_raw")
      .select("sender_key, from_name")
      .eq("user_id", user.id)
      .in("sender_key", senderKeys)
      .not("from_name", "is", null)
      .neq("from_name", "")

    if (messagesErr) {
      console.error("Error fetching messages for newsletter names:", messagesErr)
      // Continue without from_name, will fall back to domain parsing
    }

    // Step 3: Calculate most common from_name per sender_key
    const fromNameMap = new Map<string, string>()
    if (messages) {
      const nameCounts = new Map<string, Map<string, number>>() // sender_key -> (from_name -> count)
      
      for (const msg of messages) {
        if (!msg.sender_key || !msg.from_name) continue
        
        if (!nameCounts.has(msg.sender_key)) {
          nameCounts.set(msg.sender_key, new Map())
        }
        
        const counts = nameCounts.get(msg.sender_key)!
        const current = counts.get(msg.from_name) || 0
        counts.set(msg.from_name, current + 1)
      }

      // Get most common from_name for each sender_key
      for (const [senderKey, counts] of nameCounts.entries()) {
        let maxCount = 0
        let mostCommon = ""
        
        for (const [name, count] of counts.entries()) {
          if (count > maxCount) {
            maxCount = count
            mostCommon = name
          }
        }
        
        if (mostCommon) {
          fromNameMap.set(senderKey, mostCommon)
        }
      }
    }

    // Step 4: Get user selections from user_newsletter_selections
    const { data: selections, error: selectionsErr } = await supabaseServiceRole
      .from("user_newsletter_selections")
      .select("sender_key, selected")
      .eq("user_id", user.id)

    if (selectionsErr) {
      console.error("Error fetching user selections:", selectionsErr)
      // Continue without selections, will default based on bucket
    }

    const selectionsMap = new Map<string, boolean>()
    if (selections) {
      for (const sel of selections) {
        selectionsMap.set(sel.sender_key, sel.selected)
      }
    }

    // Step 5: Helper function to extract newsletter name
    const extractNewsletterName = (senderKey: string): string => {
      // Prefer from_name if available
      const fromName = fromNameMap.get(senderKey)
      if (fromName) {
        return fromName
      }

      // Fall back to parsed domain name
      let domainName = senderKey
        .replace(/\.com$/, "")
        .replace(/\.org$/, "")
        .replace(/\.net$/, "")
        .replace(/\.io$/, "")
        .replace(/\.co$/, "")
        .split(".")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")

      // If parsing resulted in empty or same as original, return original
      if (!domainName || domainName === senderKey) {
        return senderKey
      }

      return domainName
    }

    // Step 6: Helper function to determine confidence string
    const getConfidence = (
      bucket: string,
      classifierSource: string | null,
      lowConfidence: boolean | null
    ): string => {
      if (bucket === "positive") {
        return lowConfidence ? "Low Confidence" : "High Confidence"
      }
      if (bucket === "grey") {
        return lowConfidence ? "Low Confidence" : "High Confidence"
      }
      if (bucket === "low") {
        if (classifierSource === "rule") {
          return "Rule Filtered"
        }
        return lowConfidence ? "Low Confidence" : "LLM Classified"
      }
      return "Unknown"
    }

    // Step 7: Build response array
    const senders = candidates.map(candidate => {
      const newsletterName = extractNewsletterName(candidate.sender_key)
      
      // Determine selected state:
      // - If in selections table, use that value
      // - If "Yes" (positive) and not in selections, default to true
      // - Otherwise default to false
      let selected = false
      if (selectionsMap.has(candidate.sender_key)) {
        selected = selectionsMap.get(candidate.sender_key) ?? false
      } else if (candidate.bucket === "positive") {
        selected = true // Auto-select "Yes" newsletters
      }

      return {
        newsletter_name: newsletterName,
        sender_key: candidate.sender_key,
        status: candidate.bucket === "positive" ? "Yes" : candidate.bucket === "grey" ? "Grey" : "No",
        messages: candidate.msgs_14d || 0,
        confidence: getConfidence(
          candidate.bucket,
          candidate.classifier_source,
          candidate.low_confidence
        ),
        selected
      }
    })

    // Step 8: Sort by status (Yes → Grey → No) then by message count
    senders.sort((a, b) => {
      const statusOrder = { "Yes": 1, "Grey": 2, "No": 3 }
      const aOrder = statusOrder[a.status as keyof typeof statusOrder] || 99
      const bOrder = statusOrder[b.status as keyof typeof statusOrder] || 99
      
      if (aOrder !== bOrder) {
        return aOrder - bOrder
      }
      
      return b.messages - a.messages // Descending by message count
    })

    return NextResponse.json({
      ok: true,
      senders
    })

  } catch (e: any) {
    console.error("Error fetching classified senders:", e)
    return NextResponse.json({ 
      ok: false, 
      error: String(e.message || e) 
    }, { status: 500 })
  }
}
