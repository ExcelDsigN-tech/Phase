/**
 * Spike 661 (phase-161) live proof runner for the creator CLI.
 *
 *   npm run proof:661 -- --asset ./my-image.png [--collection ./collection.json] [--live]
 *
 * Without --live it only runs read-only and dry-run commands. With --live it
 * also pins the asset to Pinata and deploys phase-protocol to testnet, using
 * the env in .env.local (PINATA_JWT, ADMIN_SECRET_KEY, NEXT_PUBLIC_PHASER_TOKEN_ID,
 * NEXT_PUBLIC_CLASSIC_LIQ_ISSUER). FEATURE_PHASE_161=1 must be set for --live.
 *
 * Every step's --json output is written to .data/proofs/661-<timestamp>.json.
 * The CLI never prints secret values, so that file is safe to attach to a PR.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const live = process.argv.includes("--live")
const asset = arg("--asset")
const collection = arg("--collection")

type Step = { name: string; args: string[]; exitCode: number | null; output: unknown }
const steps: Step[] = []

function cli(name: string, args: string[]): Step {
  const res = spawnSync("npx", ["tsx", "scripts/phase-creator.cts", ...args, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  })
  const last = res.stdout.trim().split("\n").pop() ?? ""
  let output: unknown = last
  try {
    output = JSON.parse(last)
  } catch {
    /* keep raw line */
  }
  const step = { name, args, exitCode: res.status, output }
  steps.push(step)
  console.log(`${res.status === 0 ? "ok  " : `exit ${res.status}`}  ${name}`)
  return step
}

cli("env (pin, deploy)", ["env", "--needs", "pin,deploy"])
if (collection) cli("validate collection", ["validate", collection])
if (asset) cli("pin --dry-run", ["pin", asset, "--dry-run"])
cli("deploy --dry-run", ["deploy", "--dry-run"])
cli("rejects mainnet", ["validate", collection ?? "missing.json", "--network", "mainnet"])

if (live) {
  if (asset) cli("pin (live)", ["pin", asset])
  cli("deploy (live)", ["deploy"])
}

const dir = path.join(ROOT, ".data/proofs")
mkdirSync(dir, { recursive: true })
const file = path.join(dir, `661-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
writeFileSync(file, `${JSON.stringify({ spike: 661, live, recordedAt: new Date().toISOString(), steps }, null, 2)}\n`)
console.log(`\nproof written to ${path.relative(ROOT, file)}`)
