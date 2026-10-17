/**
 * Spike 662 (phase-162) live proof: the docs console's request builder and
 * response classifier, run against a real deployment.
 *
 *   npm run proof:662 -- --base-url https://<preview-host> [--burst 70]
 *
 * Uses the same lib/api-playground.ts code as the /docs console, so a PASS
 * here means the console classifies that server's real responses correctly.
 * Read-only except for JSON-RPC calls to the Soroban proxy (no ledger writes).
 * --burst N sends N getHealth calls to provoke the proxy's 429 + Retry-After.
 * Wallet signing can only be proven in a browser; see the spike doc checklist.
 * Results go to .data/proofs/662-<timestamp>.json; exit 1 if a check fails.
 */

import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { findOperation } from "../lib/api-contract"
import { buildPlaygroundRequest, interpretPlaygroundResponse, type PlaygroundInput } from "../lib/api-playground"
import { pickCopy } from "../lib/phase-copy"

const ROOT = path.resolve(__dirname, "..")
const argAt = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const BASE = (argAt("--base-url") ?? process.env.PROOF_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "")
const BURST = Number(argAt("--burst") ?? 0)
const copy = { lines: pickCopy("en").chamber.phaseHostContractErrors, unknownTpl: pickCopy("en").chamber.phaseHostContractUnknown }

type Check = { name: string; ok: boolean; detail: string; correlationSent?: string; correlationEchoed?: string | null }
const checks: Check[] = []
const record = (c: Check) => {
  checks.push(c)
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  ${c.detail}`)
}

async function call(method: "GET" | "POST", p: string, input: Partial<PlaygroundInput> = {}) {
  const op = findOperation(method, p)
  if (!op) throw new Error(`no contract entry for ${method} ${p}`)
  const correlationId = randomUUID()
  const built = buildPlaygroundRequest(op, { pathParams: {}, query: {}, body: "", ...input }, { correlationId })
  if (!built.ok) throw new Error(`builder rejected ${method} ${p}: ${built.error}`)
  const res = await fetch(`${BASE}${built.url}`, built.init)
  const interpreted = interpretPlaygroundResponse({ status: res.status, headers: res.headers, bodyText: await res.text() }, copy)
  return { correlationId, interpreted }
}

async function main() {
  const docs = await fetch(`${BASE}/docs`)
  const html = await docs.text()
  record({ name: "console section on /docs", ok: html.includes('id="playground"'), detail: `status ${docs.status}; needs NEXT_PUBLIC_FEATURE_PHASE_162 at build time` })

  const rpcErr = await call("POST", "/api/soroban-rpc", { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "phaseProofUnknownMethod" }) })
  record({
    name: "JSON-RPC error inside HTTP 200 is classified as an error",
    ok: rpcErr.interpreted.status === 200 && rpcErr.interpreted.kind === "jsonrpc_error",
    detail: `status ${rpcErr.interpreted.status}, kind ${rpcErr.interpreted.kind}, rpc ${JSON.stringify(rpcErr.interpreted.rpcError)}`,
    correlationSent: rpcErr.correlationId,
    correlationEchoed: rpcErr.interpreted.correlationId,
  })

  const x402 = await call("GET", "/api/x402")
  record({
    name: "x402 shim 503 recognised (or shim on)",
    ok: x402.interpreted.kind === "x402_shim_disabled" || x402.interpreted.status === 402 || x402.interpreted.kind === "ok",
    detail: `status ${x402.interpreted.status}, kind ${x402.interpreted.kind}`,
  })

  const supported = await call("GET", "/api/x402/supported")
  record({
    name: "plain read with correlation id",
    ok: supported.interpreted.kind === "ok",
    detail: `status ${supported.interpreted.status}, echoed ${supported.interpreted.correlationId ?? "none (route does not echo)"}`,
    correlationSent: supported.correlationId,
    correlationEchoed: supported.interpreted.correlationId,
  })

  if (BURST > 0) {
    // The proxy answers 429 + Retry-After when more than 12 calls are in flight,
    // so the burst is sent concurrently rather than one by one.
    const results = await Promise.all(
      Array.from({ length: BURST }, (_, n) =>
        call("POST", "/api/soroban-rpc", { body: JSON.stringify({ jsonrpc: "2.0", id: n, method: "getHealth" }) }),
      ),
    )
    const limited = results.find((r) => r.interpreted.kind === "rate_limited")
    record({
      name: "429 carries a usable Retry-After",
      ok: Boolean(limited && limited.interpreted.retryAfterSec != null),
      detail: limited
        ? `Retry-After ${limited.interpreted.retryAfterSec}s (${results.filter((r) => r.interpreted.kind === "rate_limited").length}/${BURST} limited)`
        : `no 429 in ${BURST} concurrent calls`,
    })
  }

  finish()
}

function finish() {
  const dir = path.join(ROOT, ".data/proofs")
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `662-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(file, `${JSON.stringify({ spike: 662, base: BASE, recordedAt: new Date().toISOString(), checks }, null, 2)}\n`)
  console.log(`\nproof written to ${path.relative(ROOT, file)}`)
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
