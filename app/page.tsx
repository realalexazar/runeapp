import dynamic from 'next/dynamic'

const SynthesisHero = dynamic(() => import('@/components/SynthesisHero'), { ssr: false })

export default function Home() {
  return <SynthesisHero />
}
