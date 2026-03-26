import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { google } from "googleapis";
import { encrypt } from "@/lib/crypto";
import { supabaseServiceRole } from "@/lib/supabase/service";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const next = state || searchParams.get("next") || "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401 }
    );
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      `${process.env.NEXT_PUBLIC_SITE_URL}/api/connect/gmail/callback`
    );

    const { tokens } = await oauth2Client.getToken(code);
    const { refresh_token } = tokens;

    if (!refresh_token) {
      console.warn("Refresh token not provided by Google. User may need to re-authenticate.");
      return NextResponse.redirect(`${origin}/connect/error?message=refresh_token_missing`);
    }

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    if (!userInfo.id) throw new Error("Could not retrieve Google user ID.");

    const encryptedRefreshToken = encrypt(refresh_token);

    const { error: upsertError } = await supabaseServiceRole
      .from("connected_accounts")
      .upsert(
        {
          user_id: user.id,
          provider: "google",
          provider_account_id: userInfo.id,
          account_email: userInfo.email ?? "",
          refresh_token: encryptedRefreshToken,
          refresh_token_ciphertext: encryptedRefreshToken,
          status: "connected",
        },
        { onConflict: "user_id,provider,account_email" }
      );

    if (upsertError) {
      console.error("Error upserting connected account:", upsertError);
      throw upsertError;
    }

    // Non-blocking initialization of system_state. Table schemas can differ.
    const { error: systemStateError } = await supabaseServiceRole
      .from("system_state")
      .upsert({ 
        user_id: user.id, 
        key: "default",
        value: "\"backfill\"" // JSON string
      }, { onConflict: 'user_id' });
    if (systemStateError) {
      console.warn("Non-blocking system_state init error:", systemStateError);
    }

    return NextResponse.redirect(`${origin}${next}`);
  } catch (error) {
    console.error("Error during Google OAuth callback:", error);
    return NextResponse.redirect(`${origin}/connect/error?message=oauth_failed`);
  }
}
