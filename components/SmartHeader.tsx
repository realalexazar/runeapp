"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function SmartHeader() {
  const [active, setActive] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const isHovering = useRef(false)

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
        <div className="flex items-center gap-6">
          <Link href="/dashboard">
            <Button className="bg-white/15 text-white hover:bg-white/25">Dashboard</Button>
          </Link>
        </div>
      </nav>
    </header>
  )
}
