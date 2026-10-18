/**
 * Spike 659 (phase-164): animation performance and reduced-motion policy.
 *
 * The root layout reads the server flag and stamps `data-phase-motion="lean"`
 * on <html>. Client components read that attribute instead of the env var, so
 * the CSS overrides (scoped to the same attribute) and the JS paths can never
 * disagree. With the flag off the attribute is absent and every helper here
 * reports legacy behavior.
 *
 * Rollback: unset NEXT_PUBLIC_FEATURE_PHASE_164 / FEATURE_PHASE_164 and restart.
 */

/**
 * Build-time switch. A literal `process.env.NEXT_PUBLIC_*` read is inlined by
 * Next into server and client bundles alike, so render-time branches agree
 * during hydration. FEATURE_PHASE_164 alone is server-only and is not enough.
 */
export function leanMotionFlag(): boolean {
  const v = (process.env.NEXT_PUBLIC_FEATURE_PHASE_164 ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

export const LEAN_MOTION_ATTR = "data-phase-motion"
export const LEAN_MOTION_VALUE = "lean"

/** Routes whose layout depends on Lenis-driven ScrollTrigger sections. */
export const LEAN_SMOOTH_SCROLL_ROUTES: readonly string[] = ["/"]

/** Cockpit pages scroll inside `main` / fixed panels, not the document. Lenis fights nested overflow. */
const LEGACY_SMOOTH_SCROLL_SKIP: readonly string[] = ["/forge", "/chamber"]

export function smoothScrollAllowed(pathname: string | null, lean: boolean): boolean {
  if (!pathname) return !lean
  if (lean) return LEAN_SMOOTH_SCROLL_ROUTES.includes(pathname)
  return !LEGACY_SMOOTH_SCROLL_SKIP.includes(pathname)
}

type RootLike = { getAttribute(name: string): string | null } | null | undefined

export function isLeanMotion(root?: RootLike): boolean {
  const el =
    root ?? (typeof document !== "undefined" ? document.documentElement : null)
  return el?.getAttribute(LEAN_MOTION_ATTR) === LEAN_MOTION_VALUE
}

type MatchMediaLike = ((query: string) => { matches: boolean }) | undefined

export function prefersReducedMotion(matchMedia?: MatchMediaLike): boolean {
  const mm =
    matchMedia ??
    (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia.bind(window)
      : undefined)
  return mm ? mm("(prefers-reduced-motion: reduce)").matches : false
}

type CssSupportsLike = { supports(condition: string): boolean } | undefined

export function supportsScrollTimeline(css?: CssSupportsLike): boolean {
  const c = css ?? (typeof CSS !== "undefined" ? CSS : undefined)
  try {
    return c ? c.supports("animation-timeline: scroll()") : false
  } catch {
    return false
  }
}

/** Only compositor-friendly properties are allowed in lean-mode keyframes and will-change hints. */
export const COMPOSITOR_PROPERTIES = ["transform", "opacity"] as const
export type CompositorProperty = (typeof COMPOSITOR_PROPERTIES)[number]

type StyleTarget = { style: { willChange: string } }

/**
 * Set `will-change` for the lifetime of one animation and clear it afterwards,
 * instead of leaving a permanent layer promotion in CSS.
 */
export function withTransientWillChange<T extends { finished: Promise<unknown> }>(
  el: StyleTarget,
  props: readonly CompositorProperty[],
  start: () => T,
): T {
  el.style.willChange = props.join(", ")
  const anim = start()
  const clear = () => {
    el.style.willChange = ""
  }
  anim.finished.then(clear, clear)
  return anim
}

export type FlapStep = {
  index: number
  char: string
  /** ms before the first scramble frame */
  startDelayMs: number
  /** scramble frames before settling on `char` */
  flips: number
}

/**
 * Deterministic flap schedule for the hero title. Mirrors the legacy timing
 * (8 base flips + 3 per tile, 0.15s tile stagger) so the lean path reads the
 * same. Reduced motion settles every tile immediately.
 */
export function buildFlapSchedule(
  text: string,
  opts: { replay: boolean; reducedMotion: boolean },
): FlapStep[] {
  return text.split("").map((raw, index) => {
    const char = raw.toUpperCase()
    const tileDelay = 0.15 * index
    if (opts.reducedMotion || char === " ") {
      return { index, char, startDelayMs: 0, flips: 0 }
    }
    return {
      index,
      char,
      startDelayMs: Math.round(opts.replay ? tileDelay * 400 : tileDelay * 800),
      flips: 8 + index * 3,
    }
  })
}

/** Audio feedback only when the user unmuted it and did not ask for reduced motion. */
export function flapAudioAllowed(muted: boolean, reducedMotion: boolean): boolean {
  return !muted && !reducedMotion
}

export const REVEAL_BATCH_DEFAULTS = {
  start: "top 88%",
  interval: 0.1,
  batchMax: 6,
  duration: 0.8,
  stagger: 0.1,
} as const
