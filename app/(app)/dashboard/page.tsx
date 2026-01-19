import { getSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseServiceRole } from "@/lib/supabase/service"
import ConnectGmailCard from "@/components/ConnectGmailCard"
import BackfillParseControls from "@/components/BackfillParseControls"
import NewsletterSelectionCard from "@/components/NewsletterSelectionCard"

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

  return (
    <section className="pb-24 pt-40">
      <div className="container space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="mt-2 text-white/60">Manage your connections and run backfills.</p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <ConnectGmailCard isConnected={isConnected} />
          <BackfillParseControls />
          <NewsletterSelectionCard />
        </div>
      </div>
    </section>
  )
}


