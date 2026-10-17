"use client"

import { useRef, useEffect, type ReactNode } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { isLeanMotion, prefersReducedMotion } from "@/lib/motion-performance"

gsap.registerPlugin(ScrollTrigger)

interface HighlightTextProps {
  children: ReactNode
  className?: string
  parallaxSpeed?: number
}

export function HighlightText({ children, className = "", parallaxSpeed = 0.3 }: HighlightTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const highlightRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!containerRef.current || !highlightRef.current || !textRef.current) return

    const lean = isLeanMotion()
    const ctx = gsap.context(() => {
      // phase-159: reduced motion shows the settled highlight with no triggers.
      if (lean && prefersReducedMotion()) {
        gsap.set(highlightRef.current, { scaleX: 1, transformOrigin: "left center" })
        gsap.set(textRef.current, { color: "#000000" })
        return
      }

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top 80%",
          end: "top -20%",
          toggleActions: "play reverse play reverse",
        },
      })

      // Animate highlight in from scaleX 0 to 1
      tl.fromTo(
        highlightRef.current,
        {
          scaleX: 0,
          transformOrigin: "left center",
        },
        {
          scaleX: 1,
          duration: 1.2,
          ease: "power3.out",
        },
      )

      tl.fromTo(
        textRef.current,
        {
          color: "rgb(250, 250, 250)", // foreground color
        },
        {
          color: "#000000",
          duration: 0.6,
          ease: "power2.out",
        },
        0.5,
      )

      // Parallax effect. phase-159 drops it: a scrub per highlight ran on every scroll frame.
      if (lean) return
      gsap.to(highlightRef.current, {
        yPercent: -20 * parallaxSpeed,
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
        },
      })
    }, containerRef)

    return () => ctx.revert()
  }, [parallaxSpeed])

  return (
    <span ref={containerRef} className={`relative inline-block ${className}`}>
      <span
        ref={highlightRef}
        className="absolute inset-0 bg-accent"
        style={{
          left: "-0.1em",
          right: "-0.1em",
          top: "0.15em",
          bottom: "0.1em",
          transform: "scaleX(0)",
          transformOrigin: "left center",
        }}
      />
      <span ref={textRef} className="relative z-10">
        {children}
      </span>
    </span>
  )
}
