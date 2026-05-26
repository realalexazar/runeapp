import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { google } from "googleapis";
import { encrypt } from "@/lib/crypto";
import { supabaseServiceRole } from "@/lib/supabase/service";
import {
  getExternalApiErrorMessage,
  getExternalApiResponseStatus,
  getExternalApiStatusCode,
  recordExternalApiCall,
} from "@/lib/ai/external-api-telemetry";
import { setGmailStatus } from "@/lib/onboard/state";

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

    const tokenStartedAt = Date.now();
    let tokenResponse;
    try {
      tokenResponse = await oauth2Client.getToken(code);
      await recordExternalApiCall({
        userId: user.id,
        callSiteName: "connect.gmail.google_oauth_get_token",
        filePath: "app/api/connect/gmail/callback/route.ts",
        functionName: "GET",
        provider: "google_oauth",
        endpoint: "oauth2.getToken",
        requestUnits: 1,
        latencyMs: Date.now() - tokenStartedAt,
        success: true,
        statusCode: getExternalApiResponseStatus(tokenResponse),
        metadata: { flow: "gmail_connect" }
      });
    } catch (e: any) {
      await recordExternalApiCall({
        userId: user.id,
        callSiteName: "connect.gmail.google_oauth_get_token",
        filePath: "app/api/connect/gmail/callback/route.ts",
        functionName: "GET",
        provider: "google_oauth",
        endpoint: "oauth2.getToken",
        requestUnits: 1,
        latencyMs: Date.now() - tokenStartedAt,
        success: false,
        statusCode: getExternalApiStatusCode(e),
        errorMessage: getExternalApiErrorMessage(e),
        metadata: { flow: "gmail_connect" }
      });
      throw e;
    }

    const { tokens } = tokenResponse;
    const { refresh_token } = tokens;

    if (!refresh_token) {
      console.warn("Refresh token not provided by Google. User may need to re-authenticate.");
      return NextResponse.redirect(`${origin}/connect/error?message=refresh_token_missing`);
    }

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfoStartedAt = Date.now();
    let userInfoResponse;
    try {
      userInfoResponse = await oauth2.userinfo.get();
      await recordExternalApiCall({
        userId: user.id,
        callSiteName: "connect.gmail.google_oauth_userinfo",
        filePath: "app/api/connect/gmail/callback/route.ts",
        functionName: "GET",
        provider: "google_oauth",
        endpoint: "userinfo.get",
        requestUnits: 1,
        latencyMs: Date.now() - userInfoStartedAt,
        success: true,
        statusCode: getExternalApiResponseStatus(userInfoResponse),
        metadata: { flow: "gmail_connect" }
      });
    } catch (e: any) {
      await recordExternalApiCall({
        userId: user.id,
        callSiteName: "connect.gmail.google_oauth_userinfo",
        filePath: "app/api/connect/gmail/callback/route.ts",
        functionName: "GET",
        provider: "google_oauth",
        endpoint: "userinfo.get",
        requestUnits: 1,
        latencyMs: Date.now() - userInfoStartedAt,
        success: false,
        statusCode: getExternalApiStatusCode(e),
        errorMessage: getExternalApiErrorMessage(e),
        metadata: { flow: "gmail_connect" }
      });
      throw e;
    }

    const { data: userInfo } = userInfoResponse;
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

    await setGmailStatus(user.id, "connected");

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
    await setGmailStatus(user.id, "failed").catch((stateError) => {
      console.warn("Failed to record Gmail onboarding failure:", stateError);
    });
    return NextResponse.redirect(`${origin}/connect/error?message=oauth_failed`);
  }
}
