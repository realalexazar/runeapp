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

  // Check if user has digest config (post-onboarding state)
  let hasDigestConfig = false
  if (user) {
    const { data } = await supabaseServiceRole
      .from("digest_configs")
      .select("user_id")
      .eq("user_id", user.id)
      .single()
    hasDigestConfig = !!data
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
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
              <p className="text-white/60">Post-onboarding dashboard coming soon...</p>
            </div>
          </div>
        ) : (
          <OnboardingFlow isConnected={isConnected} />
        )}
      </div>
    </section>
  )
}


