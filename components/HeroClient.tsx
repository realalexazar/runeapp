"use client"

import dynamic from 'next/dynamic'

const SynthesisHero = dynamic(() => import('@/components/SynthesisHero'), {
  ssr: false,
  loading: () => <section className="relative h-[100svh] w-full" />
})

export default function HeroClient() {
  return <SynthesisHero />
}
