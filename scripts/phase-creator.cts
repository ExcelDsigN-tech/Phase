#!/usr/bin/env -S npx tsx
/**
 * Spike 661 (phase-creator-cli): `phase-creator` entry point. All logic lives in
 * lib/creator-cli.ts; this file only wires real fs, env and child processes.
 * `.cts` because scripts/package.json is "type": "module", which breaks named
 * imports from lib/ under tsx (see scripts/diagnose-env.ts).
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { runCreatorCli } from "../lib/creator-cli"

const ROOT = path.resolve(__dirname, "..")
const envFile = path.join(ROOT, ".env.local")
if (existsSync(envFile)) process.loadEnvFile(envFile)

runCreatorCli(process.argv.slice(2), {
  env: process.env,
  root: ROOT,
  readFile: async (p) => new Uint8Array(await readFile(path.resolve(p))),
  writeFile: async (p, data) => {
    await mkdir(path.dirname(path.resolve(p)), { recursive: true })
    await writeFile(path.resolve(p), data, { flag: "wx" })
  },
  exists: (p) => existsSync(path.resolve(p)),
  runScript: (script, args) =>
    new Promise((resolve) => {
      const child = spawn("npx", ["tsx", script, ...args], { cwd: path.join(ROOT, "scripts"), stdio: "inherit", env: process.env })
      child.on("close", (code) => resolve(code ?? 1))
      child.on("error", () => resolve(1))
    }),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}).then((code) => {
  process.exitCode = code
})
