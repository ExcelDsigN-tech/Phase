import { spawnSync } from "node:child_process"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(__dirname, "../..")

// Only a read-only script and dry runs are spawned here, so nothing can reach testnet.
function run(script: string, args: string[], env: Record<string, string> = {}) {
  const res = spawnSync("npx", ["tsx", path.join("scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    timeout: 60_000,
  })
  return { code: res.status, out: `${res.stdout}${res.stderr}` }
}

describe("phase-161 thin-wrapper preflight", () => {
  it("--dry-run prints the plan and exits 0 before any side effect", () => {
    const r = run("check-secret-rotation.ts", ["--dry-run"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("[dry-run] check-secret-rotation.ts would:")
  }, 60_000)

  it("with the flag on, a missing env stops the script with exit 3 and names only variables", () => {
    const secretish = "SDUMMYVALUETHATMUSTNOTAPPEARINOUTPUT"
    const r = run("deploy-phase-sep50.ts", ["--dry-run"], { FEATURE_PHASE_161: "1", PINATA_JWT: secretish })
    expect(r.code).toBe(3)
    expect(r.out).toContain("ADMIN_SECRET_KEY: missing")
    expect(r.out).not.toContain(secretish)
  }, 60_000)
})
