import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import OnboardingFlow from "@/components/OnboardingFlow"
import DigestStatusCard from "@/components/DigestStatusCard"
import DevModePanel from "@/components/DevModePanel"

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  let isConnected = false
  if (user) {
    const { data } = await supabaseServiceRole
      .from("connected_accounts")
      .select("id,status")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .single()
    isConnected = !!data && data.status === "connected"
  }

  // Check if user has COMPLETE digest config (post-onboarding state)
  let hasDigestConfig = false
  if (user) {
    const { data } = await supabaseServiceRole
      .from("digest_configs")
      .select("user_id, cadence, send_time, timezone, style")
      .eq("user_id", user.id)
      .single()

    const hasRequiredConfig =
      !!data &&
      typeof data.cadence === "string" &&
      Array.isArray(data.send_time) &&
      data.send_time.length > 0 &&
      typeof data.timezone === "string" &&
      data.timezone.length > 0 &&
      typeof data.style === "string" &&
      data.style.length > 0

    hasDigestConfig = hasRequiredConfig
  }

  return (
    <section className="pb-24 pt-40">
      <div className="container space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="mt-2 text-white/60">
            {hasDigestConfig 
              ? "Your digest preferences are configured." 
              : "Manage your connections and run backfills."}
          </p>
        </div>
        {hasDigestConfig ? (
          <div className="space-y-6">
            <DigestStatusCard />
            {process.env.NODE_ENV !== 'production' && <DevModePanel />}
          </div>
        ) : (
          <OnboardingFlow isConnected={isConnected} />
        )}
      </div>
    </section>
  )
}

