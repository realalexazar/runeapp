"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import AuthDialog from "@/components/AuthDialog"
import type { User } from "@supabase/supabase-js"

export default function SmartHeader() {
  const [active, setActive] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const isHovering = useRef(false)
  const [user, setUser] = useState<User | null>(null)
  const [signupOpen, setSignupOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)

  function scheduleHide(delay = 5000) {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!isHovering.current) setActive(false)
    }, delay)
  }

  useEffect(() => {
    function onScroll() {
      if (!active) setActive(true)
      scheduleHide(5000)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      window.removeEventListener("scroll", onScroll)
    }
  }, [active])

  // Check auth state
  useEffect(() => {
    let supabase: ReturnType<typeof getSupabaseBrowserClient>
    try {
      supabase = getSupabaseBrowserClient()
    } catch {
      setUser(null)
      return
    }
    
    // Get initial session
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    window.location.href = "/"
  }

  return (
    <header
      className={[
        "pointer-events-none fixed inset-x-0 top-0 z-50 transition-all duration-300",
        active ? "opacity-100 backdrop-blur-md bg-white/10 border-b border-white/10 shadow-lg" : "opacity-0 bg-transparent border-transparent",
      ].join(" ")}
    >
      <nav
        className="pointer-events-auto container flex items-center justify-between py-3"
        onMouseEnter={() => {
          isHovering.current = true
          if (!active) setActive(true)
          if (hideTimer.current) window.clearTimeout(hideTimer.current)
        }}
        onMouseLeave={() => {
          isHovering.current = false
          scheduleHide(5000)
        }}
      >
        <Link href="/" className="font-serif text-xl text-white">Rune</Link>
        <div className="flex items-center gap-4">
          {user ? (
            <Button 
              variant="outline" 
              className="bg-white/5 border-white/20 text-white hover:bg-white/10 text-sm px-4"
              onClick={handleSignOut}
            >
              Sign Out
            </Button>
          ) : (
            <>
              <Button 
                variant="outline" 
                className="bg-white/5 border-white/20 text-white hover:bg-white/10 text-sm px-4"
                onClick={() => setLoginOpen(true)}
              >
                Login
              </Button>
              <Button 
                variant="outline" 
                className="bg-white/8 border-white/20 text-white hover:bg-white/12 backdrop-blur-md text-sm px-4"
                onClick={() => setSignupOpen(true)}
              >
                Sign Up
              </Button>
            </>
          )}
        </div>
        <AuthDialog open={signupOpen} onOpenChange={setSignupOpen} initialMode="signup" />
        <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialMode="login" />
      </nav>
    </header>
  )
}
