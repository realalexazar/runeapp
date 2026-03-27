"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import AuthDialog from '@/components/AuthDialog'

export default function ClosingCTA() {
  const [open, setOpen] = useState(false)

  return (
    <section className="relative py-20 sm:py-28 px-4 text-center">
      <h2
        className="mb-6 text-2xl font-semibold text-white sm:text-3xl"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Start your first briefing.
      </h2>
      <Button
        size="lg"
        variant="outline"
        className="min-w-[132px] border-white/20 bg-white/8 px-8 text-white backdrop-blur-md hover:border-white/30 hover:bg-white/12"
        onClick={() => setOpen(true)}
      >
        Sign Up
      </Button>
      <AuthDialog open={open} onOpenChange={setOpen} initialMode="signup" />
    </section>
  )
}
