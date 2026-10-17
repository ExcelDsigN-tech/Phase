# Spike 659 — Animation Performance and Scroll-Jank Purge Findings (Issue #522)

## What the issue claimed

Global Lenis + ScrollTrigger + a gsap ticker rAF run on every route, the hero scrub does main-thread work on the LCP section, seven gsap sections register unbatched triggers, the H1 runs a per-character framer-motion flap plus a WebAudio click, CSS carries blanket `will-change` (including `box-shadow` and `filter`), infinite loops animate non-compositor properties, and `prefers-reduced-motion` is ignored by the ticker, skeletons, smooth scroll and the flap.

## What the code actually did at spike time

- `components/smooth-scroll.tsx` mounted Lenis on every route except `/forge` and `/chamber`, so `/explore`, `/docs` and the other static grids paid for a gsap ticker callback every frame.
- Teardown was broken: `gsap.ticker.add` received an anonymous arrow but `gsap.ticker.remove(lenis.raf)` was called with a different function, so the ticker entry was never removed. `lagSmoothing(0)` was never restored either.
- `hero-section.tsx` scrubbed the LCP content with a gsap ScrollTrigger (`scrub: 1`).
- `colophon`, `principles`, `signals` and `work` sections plus `highlight-text` created one tween-bound ScrollTrigger per element (principles: one per article; highlight: two per highlight, one of them a scrub).
- `split-flap-text.tsx` re-rendered every tile through React state on each scramble frame (`setInterval` per tile), wrapped each tile in two framer-motion nodes and clicked WebAudio on every other flip.
- `tactical-command.css` set `will-change: transform, opacity, box-shadow, filter` permanently on five classes. Eighteen infinite loops animated `box-shadow`, `border-color`, `filter`, `color` or `background-position`.
- The ticker shipped inline `will-change: transform` and ignored reduced motion. Skeletons (`animate-pulse`) ignored it too.

## Delivered (phase-159)

One switch: the root layout stamps `data-phase-motion="lean"` on `<html>` when `NEXT_PUBLIC_FEATURE_PHASE_159` is set. Every CSS override sits under that attribute selector and every JS branch reads the same value, so with the flag off the attribute is absent and the old code path runs untouched.

1. **Route-scoped smooth scroll** (`components/smooth-scroll.tsx`, `lib/motion-performance.ts:smoothScrollAllowed`): lean mode only mounts Lenis on `/` (the landing page with scroll-driven sections) and never under reduced motion. `/explore`, `/docs` and other static grids scroll natively with no ticker work.
2. **Teardown fix** (always on, it is a leak fix): the ticker callback is a named function that is actually removed, `lagSmoothing` returns to gsap's default, the Lenis scroll listener is detached, and lean mode refreshes ScrollTrigger so no trigger keeps stale positions.
3. **Hero on a CSS scroll timeline** (`hero-section.tsx`, `globals.css`): where `animation-timeline: scroll()` is supported the fade is a compositor animation (`transform` + `opacity`, range `0 → 100dvh`, same as the old `top top → bottom top`). Older engines fall back to the existing gsap tween. Reduced motion skips both.
4. **Batched reveals** (`lib/motion-reveal.ts:batchReveal`): sections use `ScrollTrigger.batch` inside their `gsap.context`, so one tween runs per batch instead of per element and `ctx.revert()` still kills everything on unmount. `will-change` is set in `onStart` and cleared in `onComplete`. The highlight scrub parallax is dropped in lean mode. The work card's one-shot trigger uses `once: true`. The signals cursor uses two `gsap.quickTo` setters instead of one new tween per `mousemove`.
5. **Lean flap** (`split-flap-text.tsx`): the H1 renders its final glyphs on the server, so the LCP text is there before hydration. The scramble writes `textContent` directly (no React render per frame), the settle flip is a single WAAPI `transform` with transient `will-change`, and the click plays once per tile on settle instead of every other frame. Reduced motion settles instantly with no audio.
6. **CSS** (`tactical-command.css`, `globals.css`, `system-ticker.tsx`): permanent `will-change` becomes `auto` (with a `transform, opacity` hint only on hover, focus or active). Infinite `box-shadow` / `border-color` / `filter` loops switch to an opacity-only `phase-lean-pulse`. `background-position` meshes stop. Reduced motion freezes the ticker, skeletons, pulses and hero fade.

## Files ruled out

| File | Why it is not changed |
|------|-----------------------|
| `components/draw-text.tsx` | No importer anywhere in `app/` or `components/`, so it never ships in a route bundle and costs nothing at runtime. Candidate for deletion in a cleanup PR, not a perf fix. |
| `components/scramble-text.tsx` | Same: `ScrambleText` and `ScrambleTextOnHover` have no importers. |
| `app/explore/page.tsx` | Its jank sources were the global Lenis ticker (now skipped on `/explore` in lean mode) and the `animate-pulse` skeletons (now frozen under reduced motion by the scoped CSS). Nothing in the page itself needs to change. |
| `package.json` | No dependency change. Lenis, gsap and framer-motion stay because the flag-off path still uses them, and removing them would break rollback. |

## Spike questions

The upstream issue text was not reachable from the session that built this, so these follow the summary it was given.

1. **Rollback?** Unset `NEXT_PUBLIC_FEATURE_PHASE_159`, rebuild and restart. The attribute disappears and every scoped rule goes inert. No data is written.
2. **WASM or contract migration?** Does not apply. This spike touches no contract, storage or API.
3. **Metrics?** None added. Animation timing is a client concern and the repo has no RUM pipeline; adding one is out of scope. Verification is by trace (below).
4. **Tests?** `lib/__tests__/motion-performance.test.ts` covers route scoping, the build flag, reduced-motion and scroll-timeline probes, the flap schedule (legacy timing parity), transient `will-change` cleanup on finish and cancel, and a CSS guard: every lean rule must be scoped to the attribute and lean keyframes / `will-change` may only use `transform` and `opacity`.
5. **Security or PII?** No new data flow. The flap audio still needs an explicit unmute.

## Still needs manual or device verification

- Chrome Performance traces on a low-end Android device, flag off vs on, for `/` and `/explore` (long tasks, dropped frames, LCP). None were captured here and none are claimed.
- Visual check that the opacity pulse reads well enough on `.tactical-btn-x402` and `.forge-cta-pulse` compared to the old glow.
- Safari, which lacks `animation-timeline`, should show the gsap fallback for the hero.
- Hydration: `NEXT_PUBLIC_FEATURE_PHASE_159` is inlined at build time, so the flag needs a rebuild, not just a restart, to flip the H1 render path. `FEATURE_PHASE_159` alone does nothing for this flag.
