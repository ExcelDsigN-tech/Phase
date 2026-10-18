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

## Delivered in this PR (phase-164)

One switch: the root layout stamps `data-phase-motion="lean"` on `<html>` when `NEXT_PUBLIC_FEATURE_PHASE_164` is set. Every CSS override sits under that attribute selector and every JS branch reads the same value, so with the flag off the attribute is absent and the old code path runs untouched.

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

`package.json` is changed only to add the `proof:659` script. There's no dependency change: Lenis, gsap and framer-motion stay because the flag-off path still uses them.

## Spike questions (from the issue)

The issue's five questions are the shared template for this batch, written around signing, CAS and failover. Here's how each one applies to an animation-only change.

1. **Minimal testnet loop, and which listed files can break it?** The loop's last step is "display". Motion code can't touch funding, settlement or indexing, but it can break display. `components/smooth-scroll.tsx` (a stuck ticker or Lenis fighting a nested scroller) and `components/split-flap-text.tsx` (the H1 on the landing page) can each break the display step on their own. `app/layout.tsx` stamps the attribute every CSS override depends on. While building this, a separate pre-existing crash surfaced: `lib/stellar-wallet-kit.ts` broke hydration on every page. It's fixed on `chore/fix-main-baseline`, which this branch includes.
2. **Replay and idempotency per write.** Not applicable: this spike adds no writes. The only state is the per-viewer flap audio mute toggle, which lives in React state and isn't persisted.
3. **Contract-ID drift, issuer rotation, gateway failover.** Not applicable. The ticker's live stats (Horizon, Soroban RPC, CoinGecko, timeapi) already fail soft to `—`. Note that the app's CSP blocks CoinGecko and timeapi, so those two values never load in the browser (pre-existing, recorded in the baseline notes).
4. **409/429/412 taxonomy and recovery without losing input.** Not applicable: no requests or forms are added.
5. **Migration and rollback.** No WASM, schema or data change. `NEXT_PUBLIC_FEATURE_PHASE_164` is inlined at build time, so rollback is unset, **rebuild**, redeploy. Without the attribute, every lean CSS rule is inert and the legacy JS paths run. The teardown fix stays on either way because it's a leak fix.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| End-to-end testnet proof with tx hashes | Not applicable to motion. The equivalent proof is the Lighthouse before/after below (placeholders). |
| Concurrency proof | Not applicable. |
| Abuse proof | Not applicable. |
| Resilience proof | Not applicable. Reduced motion is covered in the checklist. |
| i18n, `#13`, docs, flag row | No new UI strings, `#13` untouched, flag row in `PROJECT_ARCHITECTURE.md` §10 and `docs/TECHNICAL.md`. |
| No regression with flags off | tsc 0 errors, vitest green, and a CSS guard test proves every lean rule is attribute-scoped (inert with the flag off). |

## Verified in this session

Headless Chromium against `next dev` with `NEXT_PUBLIC_FEATURE_PHASE_164=1`:

| Check | Normal motion | `prefers-reduced-motion: reduce` |
|---|---|---|
| `<html data-phase-motion>` | `lean` | `lean` |
| Final H1 glyphs in the server HTML | yes | yes |
| Lenis on `/` | on | off |
| Hero on the CSS scroll timeline | yes | no (static) |
| Ticker animation / `will-change` | running / `auto` | `none` / `auto` |
| Page errors | none | none |

On `/explore`, Lenis is off. `npm run proof:659` was run once against the dev server to check the script works. Dev-mode numbers aren't representative, so none are reported here.

## Lab results (production builds, cloud container)

Two `next build && next start` builds of this branch: **A** without the flag, **B** with `NEXT_PUBLIC_FEATURE_PHASE_164=1`. Lighthouse 12.2.1, mobile form factor, simulated throttling, median of 5 runs per route, two full passes. The container's CPU isn't a real phone, and outbound requests to Stellar, CoinGecko and Google were blocked, so read these as relative, not absolute.

| Route | Metric | A (off) pass 1 / 2 | B (on) pass 1 / 2 | Change |
|---|---|---|---|---|
| `/` | Main-thread work (ms) | 6009 / 5782 | 4371 / 4261 | **−24% to −27%** |
| `/` | Speed Index (ms) | 2791 / 2839 | 2417 / 2141 | **−13% to −25%** |
| `/` | Total Blocking Time (ms) | 1434 / 1347 | 1385 / 1272 | −3% to −6% (within noise) |
| `/` | LCP (ms) | 5733 / 5729 | 5740 / 5725 | flat |
| `/` | CLS | 0.001 / 0.001 | 0 / 0 | flat |
| `/explore` | Main-thread work (ms) | 3352 / 3289 | 3242 / 3208 | −2% to −3% |
| `/explore` | LCP (ms) | 5446 / 6041 | 6041 / 5430 | noise (both builds flip between the same two values) |

Behavior check on the same builds (headless Chromium):

| Check | A (off), normal | A (off), reduced motion | B (on), normal | B (on), reduced motion |
|---|---|---|---|---|
| `<html data-phase-motion>` | absent | absent | `lean` | `lean` |
| Lenis on `/` | on | **on** | on | off |
| Lenis on `/explore` | **on** | | off | |
| Ticker animation | running | **running** | running | none |
| Ticker `will-change` | `transform` (permanent) | `transform` | `auto` | `auto` |
| Hero on CSS scroll timeline | no | no | yes | no |
| Page errors | none | none | none | none |

The flag-off columns are the legacy behavior the issue describes (reduced motion ignored, Lenis on static grids), which confirms flag off is unchanged and flag on fixes it. A real low-end Android trace is still needed (checklist step 4).

## Live proof checklist (run by the maintainer)

1. Make two production builds of this branch: **A** without `NEXT_PUBLIC_FEATURE_PHASE_164`, **B** with `NEXT_PUBLIC_FEATURE_PHASE_164=1` (Vercel previews or `next build && next start` on two ports).
2. `npm run proof:659 -- --base-url <A> --label off --runs 5`, then `npm run proof:659 -- --base-url <B> --label on --runs 5`. The script refuses a mislabeled build.
3. `npm run proof:659 -- --compare .data/proofs/659-off.json .data/proofs/659-on.json` and paste the table below.
4. Low-end Android trace: on a real device (or Chrome DevTools, Performance, CPU 6x slowdown), record 10 s of scrolling `/` on A and on B, then note long tasks over 50 ms and dropped frames.
5. Reduced motion: in DevTools, Rendering, set "Emulate CSS prefers-reduced-motion: reduce" on B and confirm the H1 shows `PHASE` with no scramble, the ticker is still, skeletons on `/explore` don't pulse, and scrolling `/` has no smoothing or hero fade.
6. Fill in:

| Item | Value |
|---|---|
| Build A URL (flag off) | `<<PASTE>>` |
| Build B URL (flag on) | `<<PASTE>>` |
| `proof:659 --compare` table | Lab run above. Paste your preview-URL run here if you redo it: `<<PASTE TABLE>>` |
| Device / CPU throttle used for the trace | `<<PASTE>>` |
| Long tasks > 50 ms while scrolling `/` (A vs B) | `<<PASTE>>` |
| Dropped frames while scrolling `/` (A vs B) | `<<PASTE>>` |
| Reduced-motion check passed (yes/no + screenshot) | `<<PASTE>>` |

## Follow-up / out of scope for this PR

- Delete `components/draw-text.tsx` and `components/scramble-text.tsx` (dead code).
- The ticker re-renders every entry once a second for the EST clock; isolating the clock would cut that work.
- Allow (or drop) CoinGecko and timeapi in the CSP so the ticker's price and time load.
- RUM for LCP/INP in production; there's no metrics pipeline today.
