"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'

gsap.registerPlugin(MotionPathPlugin)

type FloatingWord = {
  id: number
  text: string
  size: number
}

const CHAOS_WORDS = [
  'AI', 'Markets', 'Earnings', 'Politics', 'Inflation', 'Climate', 'Cyber', 'Quantum', 'Startups', 'Funding',
  'NVIDIA', 'OpenAI', 'Rare earths', 'Geopolitics', 'Taiwan', 'Chip bans', 'LLMs', 'Autonomy', 'Robotics', 'Biotech',
  'Healthcare', 'Patents', 'Defense', 'Supply chain', 'GDP', 'Unemployment', 'Rates', 'Treasuries', 'Gold', 'Oil',
  'M&A', 'Venture', 'IPOs', 'E-commerce', 'Cloud', 'Edge', 'Privacy', 'Security', 'DevOps', 'ML Ops', 'Data Lake',
  'Vector DB', 'RAG', 'Embeddings', 'Agents', 'Sora', 'Gemini', 'Copilot', 'Llama', 'Claude', 'Diffusion',
  'Transformer', 'Attention', 'Scaling laws', 'Benchmarks', 'Regulation', 'Antitrust', 'DoD', 'EU AI Act', 'FDA',
  'NIST', 'FTC', 'SEC', 'IRS', 'Consumer', 'Enterprise', 'SMB', 'Churn', 'CAC', 'LTV', 'ARPU', 'ARR', 'Runway',
  'Unit Economics', 'Gross Margin', 'Cash Flow', 'Roadmap', 'Moat', 'Strategy', 'Hiring', 'Compensation', 'Equity',
  'Retention', 'Onboarding', 'OKRs', 'KPIs', 'Dashboards', 'Insights', 'Narrative', 'Brand', 'Distribution',
  'PLG', 'Sales-led', 'Partnerships', 'Pricing', 'Packaging', 'Trials', 'Conversion', 'Cohorts', 'Engagement', 'NPS'
]

export default function SynthesisHero() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const wordsRef = useRef<(HTMLDivElement | null)[]>([])
  const logoRef = useRef<HTMLDivElement | null>(null)
  const { width, height } = useContainerSize()
  const words = useMemo(() => {
    return CHAOS_WORDS.flatMap(text => [
      { id: text + '_1', text, size: 10 + Math.random() * 14 },
      { id: text + '_2', text, size: 10 + Math.random() * 14 },
    ])
  }, [])

  useEffect(() => {
    if (!containerRef.current || !width || !height) return

    document.body.style.overflow = 'hidden'

    const ctx = gsap.context(() => {
      wordsRef.current.forEach((el, i) => {
        if (!el) return

        const animateWord = () => {
          const safeZone = {
            x: width / 2 - 250,
            y: height / 2 - 150,
            width: 500,
            height: 300
          };

          let startX, startY;
          let fromBottomLeft;
          do {
            fromBottomLeft = Math.random() > 0.5;
            startX = fromBottomLeft ? gsap.utils.random(-0.2 * width, 0.6 * width) : gsap.utils.random(0.4 * width, 1.2 * width);
            startY = fromBottomLeft ? gsap.utils.random(0.4 * height, 1.2 * height) : gsap.utils.random(-0.2 * height, 0.6 * height);
          } while (
            startX > safeZone.x && startX < safeZone.x + safeZone.width &&
            startY > safeZone.y && startY < safeZone.y + safeZone.height
          );

          const endRadius = 100;
          const angle = Math.random() * Math.PI * 2;
          const endX = width / 2 + Math.cos(angle) * endRadius;
          const endY = height / 2 + Math.sin(angle) * endRadius;

          gsap.set(el, { x: startX, y: startY, opacity: 1, scale: 1, color: '#EAEAEA', textShadow: 'none', filter: 'blur(0px)' })

          const path = [
            { x: startX, y: startY },
            { 
              x: (startX + endX) / 2 + (fromBottomLeft ? -width * 0.35 : width * 0.35), 
              y: (startY + endY) / 2 + (fromBottomLeft ? height * 0.35 : -height * 0.35) 
            },
            { x: endX, y: endY }
          ]
          
          const tl = gsap.timeline({
            delay: fromBottomLeft ? gsap.utils.random(0, 5) : gsap.utils.random(0, 5),
            onComplete: animateWord
          })

          const duration = gsap.utils.random(4, 7)

          tl.to(el, {
            motionPath: {
              path,
              curviness: 1.25,
            },
            ease: 'power2.in',
            duration
          }, 0)
          
          tl.to(el, {
            color: '#FFFFFF',
            ease: 'power2.in',
            duration: duration / 2
          }, duration / 2)

          tl.to(el, {
            opacity: 0,
            filter: 'blur(12px)',
            ease: 'power1.in',
            duration: duration * 0.15
          }, duration * 0.85)
        }
        
        animateWord()
      })

      if (logoRef.current) {
        gsap.to(logoRef.current, {
          textShadow: '0 0 15px rgba(255,255,255,0.4), 0 0 5px rgba(255,255,255,0.2)',
          duration: 2.5,
          ease: 'power1.inOut',
          repeat: -1,
          yoyo: true
        })
      }
    }, containerRef)

    return () => {
      ctx.revert()
      document.body.style.overflow = ''
    }
  }, [width, height, words])

  return (
    <section ref={containerRef} className="relative h-[100svh] w-full overflow-hidden" style={{ backgroundColor: '#0B1A33' }}>
      <div className="absolute inset-0 pointer-events-none">
        {words.map((w, i) => (
          <div
            key={w.id}
            ref={(el) => {
              wordsRef.current[i] = el
            }}
            className="absolute select-none will-change-transform"
            style={{
              opacity: 0,
              color: '#EAEAEA',
              fontFamily: 'serif',
              fontSize: w.size,
              fontWeight: 400,
              letterSpacing: '0.02em'
            }}
          >
            {w.text}
          </div>
        ))}
      </div>
      <div 
        ref={logoRef}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          fontFamily: 'serif',
          fontSize: '128px',
          color: 'white',
          textShadow: '0 0 8px rgba(255,255,255,0.2)'
        }}
      >
        Rune
      </div>
    </section>
  )
}

function useContainerSize() {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return size
}


