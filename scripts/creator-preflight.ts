/**
 * Spike 661 (phase-165): thin-wrapper preflight shared by the legacy scripts.
 *
 * Each script calls `creatorPreflight()` right before its `main()`. The
 * script's own logic is untouched.
 *
 * - `--dry-run` (always honored): print what the script would do and exit 0
 *   before any network call, key generation or file write.
 * - FEATURE_PHASE_165=1: run `phase-creator env --json` first and stop with
 *   exit 3 if a required variable is missing or malformed. Values are never
 *   printed, only variable names and the kind of problem.
 * - Flag off and no `--dry-run`: returns immediately, so the script behaves
 *   exactly as before.
 *
 * The env check goes through the CLI in a child process because this
 * directory is "type": "module", and named imports from lib/ break under tsx
 * (see diagnose-env.ts).
 */

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPTS_DIR, "..")

type Preflight = {
  /** Script file name, for messages. */
  script: string
  /** One line per side effect, in order. */
  plan: string[]
  /** Capabilities the script needs from the env (see lib/env-validation.ts:diagnoseCreatorEnv). */
  needs?: ("pin" | "deploy")[]
}

function flagOn(): boolean {
  return ["NEXT_PUBLIC_FEATURE_PHASE_165", "FEATURE_PHASE_165"].some((k) =>
    ["1", "true", "yes", "on"].includes((process.env[k] ?? "").trim().toLowerCase()),
  )
}

type EnvCheck = { variable: string; ok: boolean; detail: string }

export function creatorPreflight({ script, plan, needs = [] }: Preflight): void {
  const dryRun = process.argv.includes("--dry-run")
  if (!dryRun && !flagOn()) return

  if (flagOn()) {
    const args = ["tsx", path.join(SCRIPTS_DIR, "phase-creator.cts"), "env", "--json"]
    if (needs.length) args.push("--needs", needs.join(","))
    const res = spawnSync("npx", args, { cwd: ROOT, encoding: "utf8", env: process.env })
    let report: { ok?: boolean; checks?: EnvCheck[] } = {}
    try {
      report = JSON.parse(res.stdout.trim().split("\n").pop() || "{}")
    } catch {
      console.error(`[phase-165] ${script}: env check did not return JSON (exit ${res.status ?? "?"})`)
      process.exit(3)
    }
    if (!report.ok) {
      console.error(`[phase-165] ${script}: env check failed`)
      for (const c of report.checks ?? []) if (!c.ok) console.error(`  ${c.variable}: ${c.detail}`)
      process.exit(3)
    }
  }

  if (dryRun) {
    console.log(`[dry-run] ${script} would:`)
    for (const step of plan) console.log(`  - ${step}`)
    process.exit(0)
  }
}
