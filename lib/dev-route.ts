import { NextResponse } from "next/server"

export function requireDevOrAdminRequest(req: Request): NextResponse | null {
  if (process.env.NODE_ENV !== "production") return null

  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization")
  if (secret && authHeader === `Bearer ${secret}`) return null

  return NextResponse.json(
    { ok: false, error: "Not found" },
    { status: 404 }
  )
}
