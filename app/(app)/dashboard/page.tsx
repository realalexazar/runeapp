import { getSupabaseServerClient } from "@/lib/supabase/server"

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  return (
    <section className="pb-24 pt-40">
      <div className="container">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">
          {user ? `Welcome, ${user.email}` : "Loading session..."}
        </p>
      </div>
    </section>
  )
}


