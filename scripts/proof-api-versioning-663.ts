/**
 * Spike 663 (phase-163) live proof: API version negotiation and headers.
 *
 *   npm run proof:663 -- --base-url https://<preview-or-localhost>
 *
 * Read-only: only GET requests, so it is safe against any deployment. Run it
 * with FEATURE_PHASE_163=1 set on the server (it reports clearly when the flag
 * is off). Results go to .data/proofs/663-<timestamp>.json; exit 1 if any check fails.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const i = process.argv.indexOf("--base-url")
const BASE = (i >= 0 ? process.argv[i + 1] : process.env.PROOF_BASE_URL || "http://localhost:3000").replace(/\/+$/, "")

/** GET-only probes of the routes listed in issue #526. Status codes vary by env; headers must not. */
const ROUTES = [
  "/api/faucet",
  "/api/soroban-rpc",
  "/api/classic-liq",
  "/api/classic-liq/trustline",
  "/api/nft-listings",
  "/api/market",
  "/api/signals",
  "/api/x402",
  "/api/ipfs",
  "/api/metadata/1",
]

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`)
}

async function get(p: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${p}`, { headers, redirect: "manual" })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not json */
  }
  return { status: res.status, headers: res.headers, json }
}

async function main() {
  const versions = await get("/api/versions")
  if (versions.status === 404) {
    check("phase-163 enabled on server", false, "GET /api/versions returned 404; set FEATURE_PHASE_163=1 and restart")
    return finish()
  }
  const current = (versions.json as { current?: string } | null)?.current ?? ""
  check("GET /api/versions", versions.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(current), `status ${versions.status}, current ${current}`)

  const openapi = await get("/api/versions?format=openapi")
  const doc = openapi.json as { openapi?: string; paths?: Record<string, unknown> } | null
  check("OpenAPI document", doc?.openapi === "3.1.0", `openapi ${doc?.openapi}, ${Object.keys(doc?.paths ?? {}).length} paths`)

  for (const route of ROUTES) {
    const r = await get(route)
    const echoed = r.headers.get("x-api-version")
    const vary = r.headers.get("vary") ?? ""
    check(`echo on ${route}`, echoed === current && /accept-version/i.test(vary), `status ${r.status}, X-API-Version ${echoed}, Vary ${vary}`)
    const dep = r.headers.get("deprecation")
    if (dep) check(`deprecation on ${route}`, Boolean(r.headers.get("link")), `Deprecation ${dep}, Sunset ${r.headers.get("sunset")}`)
  }

  const pinned = await get("/api/market", { "X-API-Version": current })
  check("X-API-Version pin", pinned.headers.get("x-api-version") === current, `echo ${pinned.headers.get("x-api-version")}`)

  const list = await get("/api/market", { "Accept-Version": `1999-01-01, ${current}` })
  check("Accept-Version list picks first supported", list.headers.get("x-api-version") === current, `echo ${list.headers.get("x-api-version")}`)

  const bad = await get("/api/market", { "X-API-Version": "1999-01-01" })
  const body = bad.json as { error?: string; supported?: string[] } | null
  check("unknown version is a typed 406", bad.status === 406 && body?.error === "UNSUPPORTED_API_VERSION", `status ${bad.status}, error ${body?.error}, supported ${body?.supported?.join(",")}`)

  finish()
}

function finish() {
  const dir = path.join(ROOT, ".data/proofs")
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `663-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(file, `${JSON.stringify({ spike: 663, base: BASE, recordedAt: new Date().toISOString(), checks }, null, 2)}\n`)
  console.log(`\nproof written to ${path.relative(ROOT, file)}`)
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
