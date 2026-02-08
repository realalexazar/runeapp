import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"

/**
 * GET /api/digest/config
 * 
 * Returns the user's digest configuration, or null if not configured.
 */
export async function GET() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { data, error } = await supabaseServiceRole
      .from("digest_configs")
      .select("*")
      .eq("user_id", user.id)
      .single()

    if (error) {
      // If no rows found, that's okay - user hasn't configured yet
      if (error.code === "PGRST116") {
        return NextResponse.json({ ok: true, config: null })
      }
      throw error
    }

    return NextResponse.json({ ok: true, config: data })
  } catch (e: any) {
    console.error("Error fetching digest config:", e)
    return NextResponse.json({ 
      ok: false, 
      error: String(e.message || e) 
    }, { status: 500 })
  }
}

/**
 * POST /api/digest/config
 * 
 * Saves or updates the user's digest configuration.
 * Body: { cadence, send_time, timezone, style, rune_name? }
 */
export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { cadence, send_time, timezone, style, rune_name } = body

    // Validate required fields
    if (!cadence || !send_time || !timezone || !style) {
      return NextResponse.json({ 
        ok: false, 
        error: "Missing required fields: cadence, send_time, timezone, style" 
      }, { status: 400 })
    }

    // Validate cadence
    const validCadences = ['twice-daily', 'daily', 'every-other-day', 'weekly']
    if (!validCadences.includes(cadence)) {
      return NextResponse.json({ 
        ok: false, 
        error: `Invalid cadence. Must be one of: ${validCadences.join(', ')}` 
      }, { status: 400 })
    }

    // Validate send_time array
    if (!Array.isArray(send_time) || send_time.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: "send_time must be a non-empty array" 
      }, { status: 400 })
    }

    // Validate twice-daily has exactly 2 times
    if (cadence === 'twice-daily' && send_time.length !== 2) {
      return NextResponse.json({ 
        ok: false, 
        error: "twice-daily cadence requires exactly 2 send times" 
      }, { status: 400 })
    }

    // Validate non-twice-daily has exactly 1 time
    if (cadence !== 'twice-daily' && send_time.length !== 1) {
      return NextResponse.json({ 
        ok: false, 
        error: `${cadence} cadence requires exactly 1 send time` 
      }, { status: 400 })
    }

    // Validate style
    const validStyles = ['morning-brief', 'deep-read', 'reference-mode']
    if (!validStyles.includes(style)) {
      return NextResponse.json({ 
        ok: false, 
        error: `Invalid style. Must be one of: ${validStyles.join(', ')}` 
      }, { status: 400 })
    }

    // Validate timezone (basic check - should be IANA timezone)
    if (typeof timezone !== 'string' || timezone.length === 0) {
      return NextResponse.json({ 
        ok: false, 
        error: "timezone must be a non-empty string" 
      }, { status: 400 })
    }

    // Prepare upsert data
    const now = new Date().toISOString()
    const configData = {
      user_id: user.id,
      cadence,
      send_time,
      timezone,
      style,
      rune_name: rune_name || null,
      updated_at: now
    }

    // Upsert into digest_configs
    const { data, error } = await supabaseServiceRole
      .from("digest_configs")
      .upsert(configData, { 
        onConflict: "user_id",
        ignoreDuplicates: false
      })
      .select()
      .single()

    if (error) {
      console.error("Error upserting digest config:", error)
      return NextResponse.json({ 
        ok: false, 
        error: `Failed to save config: ${error.message}` 
      }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      config: data,
      message: "Digest configuration saved successfully"
    })

  } catch (e: any) {
    console.error("Error saving digest config:", e)
    
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
