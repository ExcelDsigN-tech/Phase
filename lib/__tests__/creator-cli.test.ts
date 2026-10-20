import { Keypair, StrKey } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"
import { DEPLOY_WASM, EXIT, parseCliArgs, runCreatorCli, type CliDeps } from "@/lib/creator-cli"
import { diagnoseCreatorEnv } from "@/lib/env-validation"
import { resolvePinataJwt, scrubSecret } from "@/lib/ipfs-upload-retry"

const JWT = "eyJhbGciOiJIUzI1NiJ9.test-only-not-a-real-token.sig"
// Throwaway keys generated per run; nothing here is a real account.
const ADMIN = Keypair.random().secret()
const TOKEN_ID = StrKey.encodeContract(Buffer.alloc(32, 1))
const TREASURY = Keypair.random().publicKey()

function makeDeps(over: Partial<CliDeps> & { files?: Record<string, string> } = {}) {
  const files = new Map(Object.entries(over.files ?? {}))
  const out: string[] = []
  const err: string[] = []
  const ran: { script: string; args: string[] }[] = []
  const deps: CliDeps = {
    env: {},
    root: "/repo",
    readFile: async (p) => {
      const v = files.get(p)
      if (v == null) throw new Error("ENOENT")
      return new TextEncoder().encode(v)
    },
    writeFile: async (p, d) => {
      files.set(p, d)
    },
    exists: (p) => files.has(p),
    runScript: async (script, args) => {
      ran.push({ script, args })
      return 0
    },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...over,
  }
  return { deps, out, err, ran, files }
}

const json = (lines: string[]) => JSON.parse(lines[lines.length - 1])

describe("phase-creator-cli argument parsing", () => {
  it("parses globals and passthrough args", () => {
    expect(parseCliArgs(["run", "interact", "--json", "--dry-run", "--", "--foo"])).toMatchObject({
      command: "run",
      positionals: ["interact"],
      json: true,
      dryRun: true,
      passthrough: ["--foo"],
    })
  })

  it("rejects unknown commands, options and bad --needs", () => {
    expect(parseCliArgs(["nope"])).toEqual({ error: "unknown command nope" })
    expect(parseCliArgs(["env", "--verbose"])).toEqual({ error: "unknown option --verbose" })
    expect(parseCliArgs(["env", "--needs", "mint"])).toEqual({ error: "--needs takes pin and/or deploy" })
    expect(parseCliArgs(["env", "--network"])).toEqual({ error: "--network needs a value" })
  })
})

describe("phase-creator-cli exit codes", () => {
  it("usage errors exit 2, non-testnet networks exit 2", async () => {
    expect(await runCreatorCli(["bogus"], makeDeps().deps)).toBe(EXIT.usage)
    const { deps, out } = makeDeps()
    expect(await runCreatorCli(["validate", "x.json", "--network", "mainnet", "--json"], deps)).toBe(EXIT.usage)
    expect(json(out)).toEqual({ ok: false, error: "network_not_supported", network: "mainnet" })
  })

  it("side effects need phase-creator-cli; dry runs and read-only commands do not", async () => {
    const files = { "a.png": "png" }
    expect(await runCreatorCli(["pin", "a.png"], makeDeps({ files }).deps)).toBe(EXIT.disabled)
    expect(await runCreatorCli(["deploy"], makeDeps().deps)).toBe(EXIT.disabled)
    expect(await runCreatorCli(["run", "interact"], makeDeps().deps)).toBe(EXIT.disabled)
    expect(await runCreatorCli(["scaffold", "c"], makeDeps().deps)).toBe(EXIT.disabled)
    expect(await runCreatorCli(["pin", "a.png", "--dry-run"], makeDeps({ files }).deps)).toBe(EXIT.ok)
    expect(await runCreatorCli(["env"], makeDeps().deps)).toBe(EXIT.ok)
  })
})

describe("phase-creator-cli commands", () => {
  const on = { FEATURE_PHASE_CREATOR_CLI: "1" }

  it("scaffold writes a template that validate accepts once named, and never overwrites", async () => {
    const { deps, files } = makeDeps({ env: on })
    expect(await runCreatorCli(["scaffold", "drop/"], deps)).toBe(EXIT.ok)
    const written = JSON.parse(files.get("drop/collection.json")!)
    expect(written).toHaveProperty("price_stroops")
    expect(await runCreatorCli(["scaffold", "drop"], deps)).toBe(EXIT.usage)
    files.set("drop/collection.json", JSON.stringify({ ...written, name: "Drop" }))
    expect(await runCreatorCli(["validate", "drop/collection.json"], deps)).toBe(EXIT.ok)
  })

  it("validate exits 1 with PhaseError codes in --json", async () => {
    const { deps, out } = makeDeps({ files: { "c.json": JSON.stringify({ name: "a\\\\b", price_stroops: "5", image_uri: "" }) } })
    expect(await runCreatorCli(["validate", "c.json", "--json"], deps)).toBe(EXIT.invalid)
    expect(json(out).issues[0]).toMatchObject({ code: "name_backslash", phaseError: 10 })
  })

  it("env exits 3 when a required capability is missing and never prints secret values", async () => {
    const { deps, out } = makeDeps({ env: { ADMIN_SECRET_KEY: ADMIN, PINATA_JWT: JWT } })
    expect(await runCreatorCli(["env", "--needs", "pin,deploy", "--json"], deps)).toBe(EXIT.env)
    const text = out.join("\n")
    expect(text).not.toContain(ADMIN)
    expect(text).not.toContain(JWT)
    expect(json(out).checks.find((c: { variable: string }) => c.variable === "NEXT_PUBLIC_PHASER_TOKEN_ID").detail).toBe("missing")
  })

  it("pin succeeds headlessly and the JWT never reaches the output", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ IpfsHash: "bafybeigdyrztexample" }), { status: 200 })) as unknown as typeof fetch
    const { deps, out } = makeDeps({ env: { ...on, PINATA_JWT: JWT }, files: { "a.png": "png-bytes" }, fetchImpl })
    expect(await runCreatorCli(["pin", "a.png", "--json"], deps)).toBe(EXIT.ok)
    expect(json(out)).toMatchObject({ ok: true, uri: "ipfs://bafybeigdyrztexample" })
    expect(out.join("\n")).not.toContain(JWT)
  })

  it("pin failures exit 4 with the JWT scrubbed even if the upstream echoes it", async () => {
    const fetchImpl = (async () => new Response(`bad token ${JWT}`, { status: 401 })) as unknown as typeof fetch
    const { deps, out, err } = makeDeps({ env: { ...on, PINATA_JWT: JWT }, files: { "a.png": "x" }, fetchImpl })
    expect(await runCreatorCli(["pin", "a.png", "--json"], deps)).toBe(EXIT.remote)
    expect([...out, ...err].join("\n")).not.toContain(JWT)
  })

  it("pin without a JWT exits 3", async () => {
    expect(await runCreatorCli(["pin", "a.png"], makeDeps({ env: on, files: { "a.png": "x" } }).deps)).toBe(EXIT.env)
  })

  it("deploy checks env and the WASM before delegating to the existing script", async () => {
    const env = {
      ...on,
      ADMIN_SECRET_KEY: ADMIN,
      NEXT_PUBLIC_PHASER_TOKEN_ID: TOKEN_ID,
      NEXT_PUBLIC_CLASSIC_LIQ_ISSUER: TREASURY,
    }
    expect(await runCreatorCli(["deploy"], makeDeps({ env: on }).deps)).toBe(EXIT.env)
    expect(await runCreatorCli(["deploy"], makeDeps({ env }).deps)).toBe(EXIT.invalid)

    const wasm = { [`/repo/${DEPLOY_WASM}`]: "wasm" }
    const dry = makeDeps({ env, files: wasm })
    expect(await runCreatorCli(["deploy", "--dry-run"], dry.deps)).toBe(EXIT.ok)
    expect(dry.ran).toEqual([])

    const real = makeDeps({ env, files: wasm })
    expect(await runCreatorCli(["deploy"], real.deps)).toBe(EXIT.ok)
    expect(real.ran).toEqual([{ script: "deploy-phase-sep50.ts", args: [] }])
    expect(real.out.join("\n")).not.toContain(ADMIN)
  })

  it("run only reaches allowlisted scripts and maps their exit code", async () => {
    const { deps, ran } = makeDeps({ env: on, runScript: async () => 7 })
    expect(await runCreatorCli(["run", "../../etc/passwd"], deps)).toBe(EXIT.usage)
    expect(await runCreatorCli(["run", "interact", "--", "status"], deps)).toBe(EXIT.remote)
    expect(ran).toEqual([])
    const ok = makeDeps({ env: on })
    expect(await runCreatorCli(["run", "reset-phase", "--", "--yes"], ok.deps)).toBe(EXIT.ok)
    expect(ok.ran).toEqual([{ script: "reset-phase.ts", args: ["--yes"] }])
  })
})

describe("phase-creator-cli shared helpers", () => {
  it("one JWT lookup order for the route and the CLI", () => {
    expect(resolvePinataJwt({ PINATA_JWT: " a ", PINATA_API_JWT: "b" })).toBe("a")
    expect(resolvePinataJwt({ PINATA_API_JWT: "b" })).toBe("b")
    expect(resolvePinataJwt({})).toBeUndefined()
    expect(scrubSecret(`x ${JWT} y`, JWT)).toBe("x [REDACTED] y")
  })

  it("flags a secret seed sitting in a public var", () => {
    const r = diagnoseCreatorEnv({ NEXT_PUBLIC_OOPS: ADMIN }, [])
    expect(r.ok).toBe(false)
    expect(r.checks.at(-1)).toMatchObject({ variable: "NEXT_PUBLIC_OOPS", detail: "secret_in_public_var" })
  })
})
