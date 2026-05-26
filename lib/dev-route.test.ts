import { afterEach, describe, expect, it, vi } from "vitest"
import { requireDevOrAdminRequest } from "@/lib/dev-route"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("requireDevOrAdminRequest", () => {
  it("allows local development requests without a secret", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("CRON_SECRET", "")

    const response = requireDevOrAdminRequest(new Request("https://example.com/api/manual"))

    expect(response).toBeNull()
  })

  it("hides production manual routes when the bearer secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CRON_SECRET", "secret")

    const response = requireDevOrAdminRequest(new Request("https://example.com/api/manual"))

    expect(response?.status).toBe(404)
    await expect(response?.json()).resolves.toEqual({ ok: false, error: "Not found" })
  })

  it("allows production manual routes with the cron bearer secret", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CRON_SECRET", "secret")

    const response = requireDevOrAdminRequest(new Request("https://example.com/api/manual", {
      headers: { authorization: "Bearer secret" },
    }))

    expect(response).toBeNull()
  })
})
