import fs from "node:fs"
import path from "node:path"
import postcss, { type AtRule, type Rule } from "postcss"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildFlapSchedule,
  COMPOSITOR_PROPERTIES,
  flapAudioAllowed,
  isLeanMotion,
  leanMotionFlag,
  LEAN_MOTION_ATTR,
  prefersReducedMotion,
  smoothScrollAllowed,
  supportsScrollTimeline,
  withTransientWillChange,
} from "@/lib/motion-performance"

const root = (attr: string | null) => ({ getAttribute: (n: string) => (n === LEAN_MOTION_ATTR ? attr : null) })

describe("phase-164 smooth scroll scoping", () => {
  it("legacy mode keeps the old behaviour: everything except the cockpits", () => {
    expect(smoothScrollAllowed("/", false)).toBe(true)
    expect(smoothScrollAllowed("/explore", false)).toBe(true)
    expect(smoothScrollAllowed("/forge", false)).toBe(false)
    expect(smoothScrollAllowed("/chamber", false)).toBe(false)
    expect(smoothScrollAllowed(null, false)).toBe(true)
  })

  it("lean mode only runs Lenis on routes with scroll-driven sections", () => {
    expect(smoothScrollAllowed("/", true)).toBe(true)
    expect(smoothScrollAllowed("/explore", true)).toBe(false)
    expect(smoothScrollAllowed("/docs", true)).toBe(false)
    expect(smoothScrollAllowed("/forge", true)).toBe(false)
    expect(smoothScrollAllowed(null, true)).toBe(false)
  })
})

describe("phase-164 environment probes", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FEATURE_PHASE_164
  })

  it("reads lean mode from the root attribute only", () => {
    expect(isLeanMotion(root("lean"))).toBe(true)
    expect(isLeanMotion(root(null))).toBe(false)
    expect(isLeanMotion(root("full"))).toBe(false)
  })

  it("build flag is off by default and only reads the public key", () => {
    expect(leanMotionFlag()).toBe(false)
    process.env.FEATURE_PHASE_164 = "1"
    expect(leanMotionFlag()).toBe(false)
    delete process.env.FEATURE_PHASE_164
    process.env.NEXT_PUBLIC_FEATURE_PHASE_164 = "true"
    expect(leanMotionFlag()).toBe(true)
  })

  it("reduced motion and scroll-timeline support degrade to false without a DOM", () => {
    expect(prefersReducedMotion()).toBe(false)
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true)
    expect(supportsScrollTimeline()).toBe(false)
    expect(supportsScrollTimeline({ supports: () => true })).toBe(true)
    expect(
      supportsScrollTimeline({
        supports: () => {
          throw new Error("old engine")
        },
      }),
    ).toBe(false)
  })
})

describe("phase-164 flap schedule", () => {
  it("matches the legacy timing", () => {
    const s = buildFlapSchedule("P H", { replay: false, reducedMotion: false })
    expect(s).toEqual([
      { index: 0, char: "P", startDelayMs: 0, flips: 8 },
      { index: 1, char: " ", startDelayMs: 0, flips: 0 },
      { index: 2, char: "H", startDelayMs: 240, flips: 14 },
    ])
    expect(buildFlapSchedule("PH", { replay: true, reducedMotion: false })[1].startDelayMs).toBe(60)
  })

  it("reduced motion settles every tile immediately", () => {
    for (const step of buildFlapSchedule("P H A S E", { replay: false, reducedMotion: true })) {
      expect(step.flips).toBe(0)
      expect(step.startDelayMs).toBe(0)
    }
  })

  it("audio needs an unmuted provider and no reduced-motion preference", () => {
    expect(flapAudioAllowed(false, false)).toBe(true)
    expect(flapAudioAllowed(true, false)).toBe(false)
    expect(flapAudioAllowed(false, true)).toBe(false)
  })
})

describe("phase-164 transient will-change", () => {
  it("sets the hint while the animation runs and clears it after", async () => {
    let finish!: () => void
    const finished = new Promise<void>((r) => {
      finish = r
    })
    const el = { style: { willChange: "" } }
    withTransientWillChange(el, ["transform"], () => ({ finished }))
    expect(el.style.willChange).toBe("transform")
    finish()
    await finished
    await Promise.resolve()
    expect(el.style.willChange).toBe("")
  })

  it("clears the hint when the animation is cancelled", async () => {
    const el = { style: { willChange: "" } }
    const finished = Promise.reject(new Error("AbortError"))
    withTransientWillChange(el, ["opacity"], () => ({ finished }))
    await finished.catch(() => {})
    await Promise.resolve()
    expect(el.style.willChange).toBe("")
  })
})

describe("phase-164 CSS overrides", () => {
  const LEAN = 'html[data-phase-motion="lean"]'
  const files = ["app/globals.css", "app/tactical-command.css", "components/system-ticker.tsx"]

  function leanSection(file: string): string {
    const src = fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8")
    const css = file.endsWith(".tsx") ? (src.match(/const TICKER_CSS = `([\s\S]*?)`/)?.[1] ?? "") : src
    const marker = css.indexOf("phase-164")
    return marker === -1 ? "" : css.slice(css.lastIndexOf("/*", marker))
  }

  it("every lean rule is scoped to the attribute, so the flag off is inert", () => {
    for (const file of files) {
      const css = leanSection(file)
      expect(css.length, file).toBeGreaterThan(0)
      postcss.parse(css).walkRules((rule: Rule) => {
        if (rule.parent?.type === "atrule" && (rule.parent as AtRule).name === "keyframes") return
        for (const sel of rule.selectors) expect(sel.trim().startsWith(LEAN), `${file}: ${sel}`).toBe(true)
      })
    }
  })

  it("lean keyframes and will-change hints only touch compositor properties", () => {
    const allowed = new Set<string>(COMPOSITOR_PROPERTIES)
    for (const file of files) {
      const parsed = postcss.parse(leanSection(file))
      parsed.walkAtRules("keyframes", (at) => {
        at.walkDecls((d) => expect(allowed.has(d.prop), `${file} @keyframes ${at.params}: ${d.prop}`).toBe(true))
      })
      parsed.walkDecls("will-change", (d) => {
        for (const p of d.value.split(",").map((v) => v.trim())) {
          expect(p === "auto" || allowed.has(p), `${file}: will-change ${p}`).toBe(true)
        }
      })
    }
  })
})
