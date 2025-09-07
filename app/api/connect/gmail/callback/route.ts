import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { google } from "googleapis";
import { encrypt } from "@/lib/crypto";
import { supabaseServiceRole } from "@/lib/supabase/service";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    // If the code is missing, redirect with an error
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

    // 1. Exchange the authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    const { access_token, refresh_token } = tokens;

    // 2. Validate the presence of the refresh_token, as per the outline
    if (!refresh_token) {
      // This can happen if the user has already granted consent and 'prompt: consent' was not used.
      // Redirecting with an error message.
      console.warn("Refresh token not provided by Google. User may need to re-authenticate.");
      return NextResponse.redirect(`${origin}/connect/error?message=refresh_token_missing`);
    }

    oauth2Client.setCredentials(tokens);

    // 3. Get the user's Google profile information to derive a stable provider_account_id
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    
    if (!userInfo.id) {
        throw new Error("Could not retrieve Google user ID.");
    }

    // 4. Encrypt and store the refresh_token in the connected_accounts table
    const encryptedRefreshToken = encrypt(refresh_token);

    const { error: upsertError } = await supabaseServiceRole
      .from("connected_accounts")
      .upsert({
        user_id: user.id,
        provider: "google",
        provider_account_id: userInfo.id,
        refresh_token: encryptedRefreshToken,
        status: "connected",
      });

    if (upsertError) {
      console.error("Error upserting connected account:", upsertError);
      throw upsertError;
    }

    // 5. Initialize/updates system_state row for the user
    const { error: systemStateError } = await supabaseServiceRole
      .from("system_state")
      .upsert({
        user_id: user.id,
        // you can add more fields to initialize here as needed
      }, { onConflict: 'user_id' });

    if (systemStateError) {
      console.error("Error upserting system state:", systemStateError);
      throw systemStateError;
    }

    // 6. Redirect the user back to the application
    return NextResponse.redirect(`${origin}${next}`);

  } catch (error) {
    console.error("Error during Google OAuth callback:", error);
    return NextResponse.redirect(`${origin}/connect/error?message=oauth_failed`);
  }
}
