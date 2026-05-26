"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { useState } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

type AuthMode = "login" | "signup"

interface AuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMode?: AuthMode
}

export default function AuthDialog({ open, onOpenChange, initialMode = "signup" }: AuthDialogProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)

  async function handleEmailAuth() {
    setLoading(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) {
          setConfirmationSent(true)
          setLoading(false)
          return
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
      onOpenChange(false)
      window.location.href = "/onboard"
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setLoading(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    try {
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${location.origin}/auth/callback?next=/onboard` }
      })
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong")
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-[#0B0B0F]/95 p-6 shadow-2xl backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-white">
              {mode === "signup" ? "Create your account" : "Welcome back"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-md p-1 text-white/60 hover:text-white">✕</button>
            </Dialog.Close>
          </div>

          <div className="mb-4 flex gap-2">
            <Button 
              variant="outline" 
              className={mode === "signup" ? "bg-white/12 border-white/25 text-white" : "bg-white/5 border-white/10 text-white/50"}
              onClick={() => setMode("signup")}
            >
              Sign Up
            </Button>
            <Button 
              variant="outline" 
              className={mode === "login" ? "bg-white/12 border-white/25 text-white" : "bg-white/5 border-white/10 text-white/50"}
              onClick={() => setMode("login")}
            >
              Login
            </Button>
          </div>

          {confirmationSent ? (
            <div className="space-y-3 text-center py-4">
              <p className="text-[15px] text-white/80">Check your email</p>
              <p className="text-[13px] text-white/45 leading-relaxed">
                We sent a confirmation link to <span className="text-white/70">{email}</span>. Click it to activate your account, then come back here to log in.
              </p>
              <Button
                variant="outline"
                className="mt-2 bg-white/5 border-white/15 text-white/60 hover:bg-white/10"
                onClick={() => { setConfirmationSent(false); setMode("login") }}
              >
                Back to login
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder="Email"
                  className="w-full rounded-md border border-white/15 bg-white/5 p-3 text-[16px] text-white placeholder-white/40 outline-none focus:border-white/30"
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Password"
                  className="w-full rounded-md border border-white/15 bg-white/5 p-3 text-[16px] text-white placeholder-white/40 outline-none focus:border-white/30"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <Button 
                variant="outline" 
                className="w-full bg-white/10 border-white/20 text-white hover:bg-white/15" 
                disabled={loading} 
                onClick={handleEmailAuth}
              >
                {loading ? "Please wait..." : mode === "signup" ? "Create account" : "Login"}
              </Button>

              <div className="flex items-center gap-3">
                <div className="h-px w-full bg-white/10" />
                <span className="text-xs text-white/50">or</span>
                <div className="h-px w-full bg-white/10" />
              </div>

              <Button variant="outline" className="w-full bg-white/5 text-white hover:bg-white/10" onClick={handleGoogle}>
                Continue with Google
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
