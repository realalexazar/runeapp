import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"

/**
 * POST /api/onboard/finalize-selections
 * 
 * Saves user's newsletter selections to the database.
 * Receives an array of selections and upserts them into user_newsletter_selections.
 */
export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { selections } = body

    // Validate request body
    if (!Array.isArray(selections)) {
      return NextResponse.json({ 
        ok: false, 
        error: "Invalid request body. Expected 'selections' array." 
      }, { status: 400 })
    }

    if (selections.length === 0) {
      return NextResponse.json({ 
        ok: true, 
        saved: 0,
        message: "No selections to save." 
      })
    }

    // Validate each selection object
    for (const sel of selections) {
      if (typeof sel.sender_key !== "string" || sel.sender_key.length === 0) {
        return NextResponse.json({ 
          ok: false, 
          error: "Invalid selection: 'sender_key' must be a non-empty string." 
        }, { status: 400 })
      }
      if (typeof sel.selected !== "boolean") {
        return NextResponse.json({ 
          ok: false, 
          error: "Invalid selection: 'selected' must be a boolean." 
        }, { status: 400 })
      }
    }

    // Verify that all sender_keys exist in digest_candidates for this user
    const senderKeys = selections.map(s => s.sender_key)
    const { data: existingCandidates, error: verifyErr } = await supabaseServiceRole
      .from("digest_candidates")
      .select("sender_key")
      .eq("user_id", user.id)
      .in("sender_key", senderKeys)

    if (verifyErr) {
      return NextResponse.json({ 
        ok: false, 
        error: `Failed to verify sender keys: ${verifyErr.message}` 
      }, { status: 500 })
    }

    const validSenderKeys = new Set(existingCandidates?.map(c => c.sender_key) || [])
    const invalidKeys = senderKeys.filter(key => !validSenderKeys.has(key))
    
    if (invalidKeys.length > 0) {
      return NextResponse.json({ 
        ok: false, 
        error: `Invalid sender keys: ${invalidKeys.join(", ")}` 
      }, { status: 400 })
    }

    // Prepare upsert data
    const now = new Date().toISOString()
    const upserts = selections.map(sel => ({
      user_id: user.id,
      sender_key: sel.sender_key,
      selected: sel.selected,
      updated_at: now
    }))

    // Upsert selections into user_newsletter_selections
    const { error: upsertErr } = await supabaseServiceRole
      .from("user_newsletter_selections")
      .upsert(upserts, { 
        onConflict: "user_id,sender_key",
        ignoreDuplicates: false
      })

    if (upsertErr) {
      console.error("Error upserting selections:", upsertErr)
      return NextResponse.json({ 
        ok: false, 
        error: `Failed to save selections: ${upsertErr.message}` 
      }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      saved: selections.length,
      message: `Successfully saved ${selections.length} selection(s).`
    })

  } catch (e: any) {
    console.error("Error finalizing selections:", e)
    
    // Handle JSON parse errors
    if (e instanceof SyntaxError || e.message?.includes("JSON")) {
      return NextResponse.json({ 
        ok: false, 
        error: "Invalid JSON in request body." 
      }, { status: 400 })
    }

    return NextResponse.json({ 
      ok: false, 
      error: String(e.message || e) 
    }, { status: 500 })
  }
}
