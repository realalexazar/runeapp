import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { google } from "googleapis";

export async function GET() {
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

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    // IMPORTANT: This must match the URI you've configured in your Google Cloud Console
    `${process.env.NEXT_PUBLIC_SITE_URL}/api/connect/gmail/callback`
  );

  const url = oauth2Client.generateAuthUrl({
    // As per your outline, 'offline' is crucial for getting a refresh token
    access_type: "offline",
    // As per your outline, 'consent' is crucial to ensure the user is prompted for all scopes
    // and that a refresh token is issued even if they've authorized before.
    prompt: "consent",
    // As per your outline, we need the readonly scope for Gmail.
    scope: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    // As per your outline
    include_granted_scopes: true,
  });

  return NextResponse.json({ url });
}
