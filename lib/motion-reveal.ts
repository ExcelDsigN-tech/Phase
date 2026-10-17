"use client"

import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { REVEAL_BATCH_DEFAULTS } from "@/lib/motion-performance"

gsap.registerPlugin(ScrollTrigger)

type RevealFrom = { x?: number; y?: number }

/**
 * Spike 659 (phase-159): one `ScrollTrigger.batch` per element group instead of
 * one trigger per element. Call inside a `gsap.context` so `ctx.revert()` kills
 * the batch triggers and restores inline styles on unmount. Only transform and
 * opacity are tweened; `will-change` lives only for the duration of a tween.
 */
export function batchReveal(
  targets: ArrayLike<Element> | null | undefined,
  from: RevealFrom,
  opts: { start?: string; stagger?: number; duration?: number } = {},
): void {
  const els = targets ? Array.from(targets) : []
  if (els.length === 0) return

  const hidden = { x: from.x ?? 0, y: from.y ?? 0, opacity: 0 }
  gsap.set(els, hidden)

  ScrollTrigger.batch(els, {
    start: opts.start ?? REVEAL_BATCH_DEFAULTS.start,
    interval: REVEAL_BATCH_DEFAULTS.interval,
    batchMax: REVEAL_BATCH_DEFAULTS.batchMax,
    onEnter: (batch) =>
      gsap.to(batch, {
        x: 0,
        y: 0,
        opacity: 1,
        duration: opts.duration ?? REVEAL_BATCH_DEFAULTS.duration,
        stagger: opts.stagger ?? REVEAL_BATCH_DEFAULTS.stagger,
        ease: "power3.out",
        overwrite: true,
        onStart: () => {
          gsap.set(batch, { willChange: "transform, opacity" })
        },
        onComplete: () => {
          gsap.set(batch, { clearProps: "willChange" })
        },
      }),
    onLeaveBack: (batch) =>
      gsap.to(batch, { ...hidden, duration: 0.4, overwrite: true }),
  })
}
