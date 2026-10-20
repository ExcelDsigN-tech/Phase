/**
 * Spike 661 (phase-creator-cli): `phase-creator` command tree.
 *
 *   phase-creator scaffold <dir>       write <dir>/collection.json
 *   phase-creator validate <file>      offline check against the on-chain rules
 *   phase-creator env [--needs pin,deploy]
 *   phase-creator pin <file>           headless Pinata pin (JWT from env, never printed)
 *   phase-creator deploy               build plan + scripts/deploy-phase-sep50.ts
 *   phase-creator run <script> [...]   existing scripts behind one entry point
 *
 * Global: --json, --dry-run, --network testnet. Commands with side effects
 * (pin, deploy, run, scaffold without --dry-run) need FEATURE_PHASE_CREATOR_CLI=1;
 * validate and env are read-only and always available.
 *
 * Everything with I/O comes in through `CliDeps`, so the whole tree is tested
 * without a network or a filesystem.
 */

import { diagnoseCreatorEnv, type CreatorCapability } from "./env-validation"
import { featureFlagEnvKeys } from "./feature-flags"
import { computeSha256Hex, IpfsUploadRetryError, pinFileToIpfsWithRetry, resolvePinataJwt, scrubSecret } from "./ipfs-upload-retry"
import { COLLECTION_TEMPLATE, validateCollectionDraft } from "./creator-metadata-rules"
import { redactHostErrorMessage } from "./phase-host-error"

/** CI-friendly exit codes. */
export const EXIT = {
  ok: 0,
  invalid: 1,
  usage: 2,
  env: 3,
  remote: 4,
  disabled: 5,
} as const

export type CliDeps = {
  env: Record<string, string | undefined>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: string): Promise<void>
  exists(path: string): boolean
  /** Runs `scripts/<script>` with tsx and resolves to its exit code. */
  runScript(script: string, args: string[]): Promise<number>
  fetchImpl?: typeof fetch
  out(line: string): void
  err(line: string): void
  /** Repo root, for resolving the deploy WASM. */
  root: string
}

export const DEPLOY_WASM = "contracts/phase-protocol/target/wasm32-unknown-unknown/release/phase_protocol.optimized.wasm"

/** Existing scripts reachable through `run`. Each stays the source of truth for its own flow. */
export const RUNNABLE_SCRIPTS: Record<string, string> = {
  "deploy-phase": "deploy-phase.ts",
  "deploy-token": "deploy-token.ts",
  "setup-token": "setup_token.ts",
  "setup-phase-v2": "setup-phase-v2.ts",
  interact: "interact.ts",
  "issue-sac-token": "issue-sac-token.ts",
  "seed-phaser-prueba": "seed-phaser-prueba.ts",
  "reset-phase": "reset-phase.ts",
  "check-secret-rotation": "check-secret-rotation.ts",
}

const COMMANDS = ["help", "scaffold", "validate", "env", "pin", "deploy", "run"] as const
type Command = (typeof COMMANDS)[number]

export type ParsedArgs = {
  command: Command
  positionals: string[]
  json: boolean
  dryRun: boolean
  network: string
  needs: CreatorCapability[]
  passthrough: string[]
}

export function parseCliArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  const positionals: string[] = []
  let json = false
  let dryRun = false
  let network = "testnet"
  let needs: CreatorCapability[] = []
  let passthrough: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--") {
      passthrough = argv.slice(i + 1)
      break
    }
    if (a === "--json") json = true
    else if (a === "--dry-run") dryRun = true
    else if (a === "--network" || a === "--needs") {
      const v = argv[i + 1]
      if (!v || v.startsWith("--")) return { error: `${a} needs a value` }
      i++
      if (a === "--network") network = v
      else {
        const parts = v.split(",").map((s) => s.trim())
        if (parts.some((p) => p !== "pin" && p !== "deploy")) return { error: "--needs takes pin and/or deploy" }
        needs = parts as CreatorCapability[]
      }
    } else if (a === "-h" || a === "--help") positionals.unshift("help")
    else if (a.startsWith("--")) return { error: `unknown option ${a}` }
    else positionals.push(a)
  }

  const [first = "help", ...rest] = positionals
  if (!(COMMANDS as readonly string[]).includes(first)) return { error: `unknown command ${first}` }
  return { command: first as Command, positionals: rest, json, dryRun, network, needs, passthrough }
}

function flagEnabled(env: CliDeps["env"]): boolean {
  return featureFlagEnvKeys("phase-creator-cli").some((k) => ["1", "true", "yes", "on"].includes((env[k] ?? "").trim().toLowerCase()))
}

const HELP = `phase-creator <command> [--json] [--dry-run] [--network testnet]

  scaffold <dir>        write <dir>/collection.json
  validate <file>       check a collection file against the on-chain rules (offline)
  env [--needs pin,deploy]
                        report which creator env vars are set (never their values)
  pin <file>            pin a file to IPFS via Pinata (PINATA_JWT)
  deploy                deploy phase-protocol to testnet (scripts/deploy-phase-sep50.ts)
  run <script> [-- args]
                        run an existing script: ${Object.keys(RUNNABLE_SCRIPTS).join(", ")}

Exit codes: 0 ok, 1 invalid input, 2 usage, 3 env missing, 4 remote failure, 5 phase-creator-cli disabled.`

export async function runCreatorCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const parsed = parseCliArgs(argv)
  const json = !("error" in parsed) && parsed.json

  const emit = (payload: Record<string, unknown>, text: string[]) => {
    if (json) deps.out(JSON.stringify(payload))
    else for (const line of text) deps.out(line)
  }
  const fail = (code: number, error: string, extra: Record<string, unknown> = {}, text?: string) => {
    if (json) deps.out(JSON.stringify({ ok: false, error, ...extra }))
    else deps.err(text ?? error)
    return code
  }

  if ("error" in parsed) {
    deps.err(parsed.error)
    deps.err(HELP)
    return EXIT.usage
  }
  if (parsed.network !== "testnet") {
    return fail(EXIT.usage, "network_not_supported", { network: parsed.network }, `only --network testnet is supported, got ${parsed.network}`)
  }

  const { command, positionals, dryRun } = parsed
  const sideEffects = command === "pin" || command === "deploy" || command === "run" || (command === "scaffold" && !dryRun)
  if (sideEffects && !dryRun && !flagEnabled(deps.env)) {
    return fail(EXIT.disabled, "phase_161_disabled", {}, "phase-creator-cli is off. Set FEATURE_PHASE_CREATOR_CLI=1 (or use --dry-run).")
  }

  switch (command) {
    case "help":
      deps.out(HELP)
      return EXIT.ok

    case "scaffold": {
      const dir = positionals[0]
      if (!dir) return fail(EXIT.usage, "missing_dir", {}, "scaffold needs a directory")
      const target = `${dir.replace(/\/+$/, "")}/collection.json`
      if (deps.exists(target)) return fail(EXIT.usage, "exists", { path: target }, `${target} already exists`)
      if (!dryRun) await deps.writeFile(target, `${JSON.stringify(COLLECTION_TEMPLATE, null, 2)}\n`)
      emit({ ok: true, command, path: target, dryRun }, [`${dryRun ? "would write" : "wrote"} ${target}`])
      return EXIT.ok
    }

    case "validate": {
      const file = positionals[0]
      if (!file) return fail(EXIT.usage, "missing_file", {}, "validate needs a file")
      let data: unknown
      try {
        data = JSON.parse(new TextDecoder().decode(await deps.readFile(file)))
      } catch {
        return fail(EXIT.invalid, "invalid_json", { file }, `${file} is not readable JSON`)
      }
      const result = validateCollectionDraft(data)
      emit(
        { ok: result.valid, command, file, issues: result.issues },
        [
          result.valid ? `${file}: valid` : `${file}: invalid`,
          ...result.issues.map((i) => `  [${i.level}] ${i.field}: ${i.message}${i.phaseError ? ` (PhaseError #${i.phaseError})` : ""}`),
        ],
      )
      return result.valid ? EXIT.ok : EXIT.invalid
    }

    case "env": {
      const report = diagnoseCreatorEnv(deps.env, parsed.needs)
      emit(
        { ok: report.ok, command, needs: parsed.needs, checks: report.checks },
        report.checks.map((c) => `  ${!c.ok ? "FAIL" : c.detail === "missing" ? "skip" : "ok  "} ${c.variable}: ${c.detail}${c.required ? " (required)" : ""}`),
      )
      return report.ok ? EXIT.ok : EXIT.env
    }

    case "pin": {
      const file = positionals[0]
      if (!file) return fail(EXIT.usage, "missing_file", {}, "pin needs a file")
      let bytes: Uint8Array
      try {
        bytes = await deps.readFile(file)
      } catch {
        return fail(EXIT.invalid, "unreadable_file", { file }, `cannot read ${file}`)
      }
      const checksum = computeSha256Hex(bytes)
      if (dryRun) {
        emit({ ok: true, command, dryRun, file, bytes: bytes.length, checksum }, [`would pin ${file} (${bytes.length} bytes, sha256 ${checksum})`])
        return EXIT.ok
      }
      const jwt = resolvePinataJwt(deps.env)
      if (!jwt) return fail(EXIT.env, "pinata_jwt_missing", {}, "PINATA_JWT is not set")
      try {
        const name = file.split("/").pop() || "phase-asset.bin"
        const blob = new Blob([new Uint8Array(bytes)])
        const result = await pinFileToIpfsWithRetry(blob, jwt, { fileName: name, expectedChecksum: checksum, fetchImpl: deps.fetchImpl })
        emit(
          { ok: true, command, uri: result.uri, checksum: result.checksum.hex, attempts: result.attempts },
          [`pinned ${file}`, `  uri ${result.uri}`, `  sha256 ${result.checksum.hex}`],
        )
        return EXIT.ok
      } catch (e) {
        const code = e instanceof IpfsUploadRetryError ? e.code : "UPLOAD_FAILED"
        const message = scrubSecret(redactHostErrorMessage(e instanceof Error ? e.message : String(e)), jwt)
        return fail(EXIT.remote, "pin_failed", { code, message }, `pin failed (${code}): ${message}`)
      }
    }

    case "deploy": {
      const report = diagnoseCreatorEnv(deps.env, ["deploy"])
      const wasmPresent = deps.exists(`${deps.root}/${DEPLOY_WASM}`)
      const plan = {
        network: "testnet",
        wasm: DEPLOY_WASM,
        wasmPresent,
        script: "deploy-phase-sep50.ts",
        steps: ["stellar contract deploy", "invoke initialize", "write lib/phase-contract-defaults.ts + .env.local"],
      }
      if (!report.ok) {
        return fail(EXIT.env, "env_incomplete", { checks: report.checks.filter((c) => !c.ok), plan }, "deploy env is incomplete; run `phase-creator env --needs deploy`")
      }
      if (!wasmPresent) return fail(EXIT.invalid, "wasm_missing", { plan }, `missing ${DEPLOY_WASM}; build and optimize first`)
      if (dryRun) {
        emit({ ok: true, command, dryRun, plan }, ["deploy plan:", ...plan.steps.map((s) => `  - ${s}`)])
        return EXIT.ok
      }
      const code = await deps.runScript(plan.script, parsed.passthrough)
      if (json) deps.out(JSON.stringify({ ok: code === 0, command, exitCode: code }))
      return code === 0 ? EXIT.ok : EXIT.remote
    }

    case "run": {
      const name = positionals[0]
      const script = name ? RUNNABLE_SCRIPTS[name] : undefined
      if (!script) return fail(EXIT.usage, "unknown_script", { known: Object.keys(RUNNABLE_SCRIPTS) }, `run needs one of: ${Object.keys(RUNNABLE_SCRIPTS).join(", ")}`)
      if (dryRun) {
        emit({ ok: true, command, dryRun, script, args: parsed.passthrough }, [`would run scripts/${script} ${parsed.passthrough.join(" ")}`.trim()])
        return EXIT.ok
      }
      const code = await deps.runScript(script, parsed.passthrough)
      if (json) deps.out(JSON.stringify({ ok: code === 0, command, script, exitCode: code }))
      return code === 0 ? EXIT.ok : EXIT.remote
    }
  }
}
