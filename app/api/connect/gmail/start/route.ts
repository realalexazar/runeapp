import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { google } from "googleapis";
import { recordOnboardingEvent } from "@/lib/onboard/state";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const redirect = searchParams.get("redirect") || "/dashboard";

    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check for required environment variables
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

    if (!clientId || !clientSecret) {
      console.error("Missing OAuth credentials:", { 
        hasClientId: !!clientId, 
        hasClientSecret: !!clientSecret 
      });
      return NextResponse.json({ 
        error: "OAuth configuration error", 
        message: "Missing Google OAuth credentials. Check server environment variables." 
      }, { status: 500 });
    }

    if (!siteUrl) {
      console.error("Missing NEXT_PUBLIC_SITE_URL");
      return NextResponse.json({ 
        error: "Configuration error", 
        message: "Missing NEXT_PUBLIC_SITE_URL environment variable." 
      }, { status: 500 });
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      // IMPORTANT: This must match the URI you've configured in your Google Cloud Console
      `${siteUrl}/api/connect/gmail/callback`
    );

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
      include_granted_scopes: true,
      state: redirect,
    });

    await recordOnboardingEvent(user.id, "gmail_connect_started", {
      redirect_target: redirect,
    });

    return NextResponse.redirect(url);
  } catch (error: any) {
    console.error("OAuth start error:", error);
    return NextResponse.json({ 
      error: "Failed to start OAuth", 
      message: error?.message || "Unknown error occurred" 
    }, { status: 500 });
  }
}
