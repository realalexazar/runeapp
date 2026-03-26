import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import type { CookieOptions } from "@supabase/ssr"
import { env } from "@/lib/env"

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          res.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({ name, value: "", ...options, expires: new Date(0) })
        }
      }
    }
  )

  // Protect /dashboard routes
  if (req.nextUrl.pathname.startsWith("/dashboard")) {
    const {
      data: { session }
    } = await supabase.auth.getSession()

    if (!session) {
      const redirectUrl = new URL("/auth", req.url)
      redirectUrl.searchParams.set("redirectedFrom", req.nextUrl.pathname)
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Redirect authenticated users away from /auth (unless they came from onboarding)
  if (req.nextUrl.pathname === "/auth") {
    const {
      data: { session }
    } = await supabase.auth.getSession()
    if (session) {
      const redirectedFrom = req.nextUrl.searchParams.get("redirectedFrom")
      if (redirectedFrom?.startsWith("/onboard")) {
        return NextResponse.redirect(new URL(redirectedFrom, req.url))
      }
      return NextResponse.redirect(new URL("/dashboard", req.url))
    }
  }

  return res
}

export const config = {
  matcher: ["/dashboard/:path*", "/auth"],
}


