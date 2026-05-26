import { expect, test } from "@playwright/test"

test("onboarding shell renders without a client crash", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const response = await page.goto("/onboard?smoke=onboard", {
    waitUntil: "domcontentloaded",
  })

  expect(response?.status()).toBeLessThan(500)
  await expect(page).toHaveTitle(/Rune/)

  const bodyText = await page.locator("body").innerText()
  expect(bodyText).toMatch(/Rune|Message Rune|Click below|Sign in|Sign Up|Log in/i)
  expect(pageErrors).toEqual([])
})

test("onboarding state endpoint requires auth on deployed env", async ({ request }) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only asserted against deployed environments with configured Supabase env.")

  const response = await request.get("/api/onboard/state")
  expect(response.status()).toBe(401)
})

test("manual expensive routes are hidden on deployed env without admin bearer", async ({ request }) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Only asserted against deployed environments.")

  const checks: Array<{ method: "GET" | "POST"; path: string }> = [
    { method: "POST", path: "/api/digest/generate" },
    { method: "POST", path: "/api/digest/generate-daily-news-topics" },
    { method: "POST", path: "/api/digest/generate-daily-lessons" },
    { method: "POST", path: "/api/digest/generate-summaries" },
    { method: "GET", path: "/api/onboard/backfill-curricula" },
    { method: "GET", path: "/api/export/features" },
    { method: "GET", path: "/api/cron/generate-digests" },
  ]

  for (const check of checks) {
    const response = check.method === "GET"
      ? await request.get(check.path)
      : await request.post(check.path, { data: {} })
    expect(response.status(), `${check.method} ${check.path}`).toBe(404)
  }
})
