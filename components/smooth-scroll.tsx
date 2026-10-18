"use client"

import type React from "react"

import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"
import Lenis from "lenis"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

import { isLeanMotion, prefersReducedMotion, smoothScrollAllowed } from "@/lib/motion-performance"

gsap.registerPlugin(ScrollTrigger)

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const lenisRef = useRef<Lenis | null>(null)
  // phase-164: lean mode runs Lenis only on routes with scroll-driven sections
  // and never under prefers-reduced-motion. Legacy mode skips only the cockpits.
  const lean = isLeanMotion()
  const allowed = smoothScrollAllowed(pathname, lean) && !(lean && prefersReducedMotion())

  useEffect(() => {
    if (!allowed) return

    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: "vertical",
      smoothWheel: true,
    })

    lenisRef.current = lenis

    lenis.on("scroll", ScrollTrigger.update)

    // Keep a named reference: removing `lenis.raf` never matched the anonymous
    // callback, so every route change used to leave a dead ticker entry behind.
    const tick = (time: number) => {
      lenis.raf(time * 1000)
    }
    gsap.ticker.add(tick)

    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
      lenis.off("scroll", ScrollTrigger.update)
      lenis.destroy()
      lenisRef.current = null
      if (lean) ScrollTrigger.refresh()
    }
  }, [allowed, lean])

  return <>{children}</>
}
