/**
 * Spike 659 (phase-159) performance proof: Lighthouse before/after.
 *
 *   # build A without the flag, build B with NEXT_PUBLIC_FEATURE_PHASE_159=1 (it is build-time)
 *   npm run proof:659 -- --base-url https://<build-A> --label off
 *   npm run proof:659 -- --base-url https://<build-B> --label on
 *   npm run proof:659 -- --compare .data/proofs/659-off.json .data/proofs/659-on.json
 *
 * Runs `npx lighthouse` (mobile, simulated throttling, performance only) for
 * each route, `--runs` times (default 3), and keeps the median. Set CHROME_PATH
 * if Chrome is not on the default path. It also checks that the build really
 * has (or lacks) data-phase-motion="lean", so a mislabeled run is caught.
 * Reduced motion has to be checked by hand; see the spike doc checklist.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(ROOT, ".data/proofs")
const LIGHTHOUSE = "lighthouse@12.2.1"
const ROUTES = ["/", "/explore"]
const METRICS = {
  lcpMs: "largest-contentful-paint",
  tbtMs: "total-blocking-time",
  cls: "cumulative-layout-shift",
  speedIndexMs: "speed-index",
  mainThreadMs: "mainthread-work-breakdown",
} as const
type Metric = keyof typeof METRICS
type RouteResult = Record<Metric, number>

const argv = process.argv.slice(2)
const arg = (name: string) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function lighthouse(url: string): RouteResult {
  const tmp = path.join(OUT, `lh-${Date.now()}.json`)
  const res = spawnSync(
    "npx",
    [
      "--yes",
      LIGHTHOUSE,
      url,
      "--quiet",
      "--only-categories=performance",
      "--form-factor=mobile",
      "--throttling-method=simulate",
      "--output=json",
      `--output-path=${tmp}`,
      "--chrome-flags=--headless=new --no-sandbox",
    ],
    { cwd: ROOT, encoding: "utf8", env: process.env },
  )
  if (res.status !== 0) throw new Error(`lighthouse failed for ${url}: ${(res.stderr ?? "").slice(-400)}`)
  const report = JSON.parse(readFileSync(tmp, "utf8")) as { audits: Record<string, { numericValue?: number }> }
  rmSync(tmp)
  const out = {} as RouteResult
  for (const [k, id] of Object.entries(METRICS) as [Metric, string][]) {
    out[k] = Math.round((report.audits[id]?.numericValue ?? NaN) * 1000) / 1000
  }
  return out
}

async function record() {
  const base = (arg("--base-url") ?? "http://localhost:3000").replace(/\/+$/, "")
  const label = arg("--label")
  const runs = Number(arg("--runs") ?? 3)
  if (label !== "off" && label !== "on") throw new Error("--label must be off or on")

  const html = await (await fetch(`${base}/`)).text()
  const lean = html.includes('data-phase-motion="lean"')
  if (lean !== (label === "on")) {
    throw new Error(`build at ${base} has lean=${lean} but --label ${label}; rebuild with the right NEXT_PUBLIC_FEATURE_PHASE_159`)
  }

  mkdirSync(OUT, { recursive: true })
  const routes: Record<string, RouteResult> = {}
  for (const route of ROUTES) {
    const samples = Array.from({ length: runs }, (_, i) => {
      console.log(`lighthouse ${label} ${route} run ${i + 1}/${runs}`)
      return lighthouse(`${base}${route}`)
    })
    routes[route] = Object.fromEntries(
      (Object.keys(METRICS) as Metric[]).map((m) => [m, median(samples.map((s) => s[m]))]),
    ) as RouteResult
  }
  const file = path.join(OUT, `659-${label}.json`)
  const payload = { spike: 659, label, base, runs, lighthouse: LIGHTHOUSE, recordedAt: new Date().toISOString(), routes }
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`wrote ${path.relative(ROOT, file)}`)
}

function compare(a: string, b: string) {
  const off = JSON.parse(readFileSync(a, "utf8")) as { routes: Record<string, RouteResult> }
  const on = JSON.parse(readFileSync(b, "utf8")) as { routes: Record<string, RouteResult> }
  console.log("| Route | Metric | Flag off | Flag on | Delta |")
  console.log("|---|---|---|---|---|")
  for (const route of Object.keys(off.routes)) {
    for (const m of Object.keys(METRICS) as Metric[]) {
      const x = off.routes[route][m]
      const y = on.routes[route]?.[m]
      const delta = y == null ? "" : String(Math.round((y - x) * 1000) / 1000)
      console.log(`| \`${route}\` | ${m} | ${x} | ${y} | ${delta} |`)
    }
  }
}

const cmp = argv.indexOf("--compare")
if (cmp >= 0) compare(argv[cmp + 1], argv[cmp + 2])
else
  record().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
