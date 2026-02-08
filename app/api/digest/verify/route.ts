import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import { google } from "googleapis"
import { decrypt } from "@/lib/crypto"

/**
 * GET /api/digest/verify
 * 
 * Verifies that all required data is stored for the authenticated user
 * to generate and send digests. Returns a detailed status report.
 */
export async function GET() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const verification: {
      user_id: string
      user_email: string | null
      has_google_connection: boolean
      oauth_token_valid: boolean | null // null = not tested, true = valid, false = expired
      has_newsletter_selections: boolean
      newsletter_count: number
      has_digest_config: boolean
      digest_config: any | null
      has_messages_raw: boolean
      messages_count: number
      ready_for_digest: boolean
      missing_requirements: string[]
    } = {
      user_id: user.id,
      user_email: user.email || null,
      has_google_connection: false,
      oauth_token_valid: null,
      has_newsletter_selections: false,
      newsletter_count: 0,
      has_digest_config: false,
      digest_config: null,
      has_messages_raw: false,
      messages_count: 0,
      ready_for_digest: false,
      missing_requirements: []
    }

    // 1. Check Google OAuth connection - actually test the token
    const { data: acct } = await supabaseServiceRole
      .from("connected_accounts")
      .select("refresh_token, refresh_token_ciphertext")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .limit(1)
      .single()

    if (acct) {
      verification.has_google_connection = true
      
      // Actually test the OAuth token by making a lightweight Gmail API call
      try {
        const enc = acct.refresh_token_ciphertext ?? acct.refresh_token
        if (enc) {
          const refreshToken = decrypt(enc)
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_OAUTH_CLIENT_ID,
            process.env.GOOGLE_OAUTH_CLIENT_SECRET
          )
          oauth2Client.setCredentials({ refresh_token: refreshToken })
          
          // Test token with lightweight API call
          const gmail = google.gmail({ version: "v1", auth: oauth2Client })
          await gmail.users.getProfile({ userId: "me" })
          
          verification.oauth_token_valid = true
        } else {
          verification.oauth_token_valid = false
        }
      } catch (oauthErr: any) {
        // Token is expired or invalid
        verification.oauth_token_valid = false
        console.log("OAuth token validation failed:", oauthErr?.message)
      }
    }

    // Check messages_raw count
    const { count: messagesCount } = await supabaseServiceRole
      .from("messages_raw")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
    
    verification.has_messages_raw = (messagesCount || 0) > 0
    verification.messages_count = messagesCount || 0

    // 2. Check newsletter selections
    const { data: selections, count: selectionsCount } = await supabaseServiceRole
      .from("user_newsletter_selections")
      .select("sender_key", { count: "exact" })
      .eq("user_id", user.id)
      .eq("selected", true)
    
    verification.has_newsletter_selections = (selectionsCount || 0) > 0
    verification.newsletter_count = selectionsCount || 0

    // 3. Check digest configuration
    const { data: config } = await supabaseServiceRole
      .from("digest_configs")
      .select("*")
      .eq("user_id", user.id)
      .single()
    
    verification.has_digest_config = !!config
    verification.digest_config = config

    // 4. Determine if ready for digest generation
    const missing: string[] = []
    
    if (!verification.has_google_connection) {
      missing.push("Google account not connected")
    } else if (verification.oauth_token_valid === false) {
      missing.push("Google OAuth token expired - please reconnect")
    }
    if (!verification.has_newsletter_selections) {
      missing.push("No newsletters selected")
    }
    if (!verification.has_digest_config) {
      missing.push("Digest configuration not set")
    }
    if (!verification.has_messages_raw) {
      missing.push("No email messages found (need to run backfill)")
    }

    verification.missing_requirements = missing
    verification.ready_for_digest = missing.length === 0

    return NextResponse.json({
      ok: true,
      verification,
      summary: {
        ready: verification.ready_for_digest,
        message: verification.ready_for_digest
          ? "✅ All requirements met! Ready to generate digests."
          : `❌ Missing ${missing.length} requirement(s): ${missing.join(", ")}`
      }
    })

  } catch (e: any) {
    console.error("Error verifying user data:", e)
    return NextResponse.json({ 
      ok: false, 
      error: String(e.message || e) 
    }, { status: 500 })
  }
}
