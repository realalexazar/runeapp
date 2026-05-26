import { defineConfig, devices } from "@playwright/test"

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL
const localBaseURL = "http://127.0.0.1:3000"

export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  use: {
    baseURL: externalBaseURL || localBaseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: externalBaseURL
    ? undefined
      : {
        command: "pnpm build && pnpm exec next start -H 127.0.0.1 -p 3000",
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "smoke-test-anon-key",
        },
        url: localBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
})
