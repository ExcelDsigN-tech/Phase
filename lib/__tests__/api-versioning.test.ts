import fs from "node:fs"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterEach, describe, expect, it } from "vitest"
import { API_OPERATIONS } from "@/lib/api-contract"
import {
  API_CHANGELOG,
  API_VARY_TOKENS,
  buildOpenApiDocument,
  checkContract,
  currentApiVersion,
  diffContracts,
  negotiateApiVersion,
  pathMatchesTemplate,
  versionResponseHeaders,
  type ApiVersion,
  type OpenApiDocument,
} from "@/lib/api-versioning"
import { middleware } from "@/middleware"

const h = (init: Record<string, string>) => new Headers(init)
const V: ApiVersion[] = [
  { id: "2026-01-01", released: "2026-01-01", status: "deprecated", deprecatedAt: "2026-06-01", sunsetAt: "2027-01-01" },
  { id: "2026-10-17", released: "2026-10-17", status: "current" },
]
const NOW = new Date("2026-10-17T12:00:00Z")

describe("phase-api-versioning negotiation", () => {
  it("defaults to the current version without headers", () => {
    expect(negotiateApiVersion(h({}), { versions: V, now: NOW })).toEqual({
      ok: true,
      version: "2026-10-17",
      source: "default",
    })
  })

  it("X-API-Version pins and wins over Accept-Version", () => {
    const r = negotiateApiVersion(h({ "X-API-Version": "2026-01-01", "Accept-Version": "2026-10-17" }), {
      versions: V,
      now: NOW,
    })
    expect(r).toEqual({ ok: true, version: "2026-01-01", source: "x-api-version" })
  })

  it("Accept-Version takes the first supported entry", () => {
    const r = negotiateApiVersion(h({ "Accept-Version": "1999-01-01, 2026-10-17" }), { versions: V, now: NOW })
    expect(r).toEqual({ ok: true, version: "2026-10-17", source: "accept-version" })
  })

  it("unknown or malformed versions get 406 with the supported list", () => {
    for (const bad of ["v2", "2030-01-01", "<script>"]) {
      const r = negotiateApiVersion(h({ "X-API-Version": bad }), { versions: V, now: NOW })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.status).toBe(406)
        expect(r.error).toBe("UNSUPPORTED_API_VERSION")
        expect(r.supported).toEqual(["2026-01-01", "2026-10-17"])
      }
    }
  })

  it("a version past its sunset gets 410", () => {
    const r = negotiateApiVersion(h({ "X-API-Version": "2026-01-01" }), {
      versions: V,
      now: new Date("2027-02-01T00:00:00Z"),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(410)
      expect(r.error).toBe("API_VERSION_SUNSET")
      expect(r.supported).toEqual(["2026-10-17"])
    }
  })

  it("the shipped registry has exactly one current version", () => {
    expect(currentApiVersion()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("phase-api-versioning response headers", () => {
  it("echoes the version and Vary on every response", () => {
    expect(versionResponseHeaders("GET", "/api/market", "2026-10-17", { versions: V, deprecations: [] })).toEqual({
      "X-API-Version": "2026-10-17",
      Vary: "Accept-Version, X-API-Version, Authorization, Accept-Language, X-Phase-Lang",
    })
  })

  it("adds RFC 9745 Deprecation and RFC 8594 Sunset for a deprecated version", () => {
    const out = versionResponseHeaders("GET", "/api/market", "2026-01-01", { versions: V, deprecations: [] })
    expect(out.Deprecation).toBe(`@${Date.parse("2026-06-01") / 1000}`)
    expect(out.Sunset).toBe("Fri, 01 Jan 2027 00:00:00 GMT")
    expect(out.Link).toContain('rel="deprecation"')
    expect(out.Link).toContain('rel="successor-version"')
  })

  it("route deprecations match path templates and override version dates", () => {
    const out = versionResponseHeaders("GET", "/api/metadata/42", "2026-10-17", {
      versions: V,
      deprecations: [
        {
          method: "GET",
          path: "/api/metadata/{id}",
          deprecatedAt: "2026-09-01",
          sunsetAt: "2027-03-01",
          successor: "/api/v2/metadata/{id}",
          link: "/docs#metadata",
        },
      ],
    })
    expect(out.Deprecation).toBe(`@${Date.parse("2026-09-01") / 1000}`)
    expect(out.Link).toBe('</docs#metadata>; rel="deprecation", </api/v2/metadata/{id}>; rel="successor-version"')
    expect(pathMatchesTemplate("/api/metadata/{id}", "/api/metadata/42/extra")).toBe(false)
  })
})

describe("phase-api-versioning Vary superset", () => {
  it("covers every Vary token an /api route sets, so the middleware cannot drop a cache key", () => {
    const root = path.resolve(__dirname, "../../app/api")
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(full)
      }
    }
    walk(root)
    const tokens = new Set<string>()
    for (const f of files) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/Vary["']?\s*:\s*["'`]([^"'`]+)["'`]/g)) {
        for (const t of m[1].split(",")) tokens.add(t.trim().toLowerCase())
      }
    }
    expect(tokens.size).toBeGreaterThan(0)
    const covered = new Set(API_VARY_TOKENS.map((t) => t.toLowerCase()))
    for (const t of tokens) expect(covered.has(t), `Vary token ${t}`).toBe(true)
  })
})

describe("phase-api-versioning contract", () => {
  const doc = buildOpenApiDocument()

  it("covers every operation once with deterministic status codes", () => {
    const ids = API_OPERATIONS.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const op of API_OPERATIONS) {
      const entry = doc.paths[op.path]?.[op.method.toLowerCase()]
      expect(entry, op.id).toBeDefined()
      for (const s of op.statuses) expect(Object.keys(entry.responses as object)).toContain(String(s))
    }
  })

  it("the committed snapshot and changelog match the source", () => {
    const root = path.resolve(__dirname, "../..")
    const committed = JSON.parse(fs.readFileSync(path.join(root, "docs/api/openapi.json"), "utf8"))
    const changelog = JSON.parse(fs.readFileSync(path.join(root, "docs/api/changelog.json"), "utf8"))
    expect(committed).toEqual(doc)
    expect(changelog).toEqual(API_CHANGELOG)
  })

  it("flags removals as breaking and additions as safe", () => {
    const next = structuredClone(doc) as OpenApiDocument
    delete next.paths["/api/market"].post
    next.paths["/api/faucet"].get.parameters = []
    const kinds = diffContracts(doc, next).map((b) => b.kind)
    expect(kinds).toContain("operation_removed")
    expect(kinds).toContain("parameter_removed")

    const added = structuredClone(doc) as OpenApiDocument
    added.paths["/api/new"] = { get: { responses: { "200": {} } } }
    expect(diffContracts(doc, added)).toEqual([])
  })

  it("a breaking change needs a version bump and a breaking changelog entry", () => {
    const broken = structuredClone(doc) as OpenApiDocument
    delete broken.paths["/api/signals"].post
    expect(checkContract({ base: doc, committed: broken, generated: broken }).reason).toBe(
      "breaking_without_version_bump",
    )

    broken.info.version = "2027-01-01"
    expect(checkContract({ base: doc, committed: broken, generated: broken }, []).reason).toBe(
      "breaking_without_changelog",
    )

    const log = [{ version: "2027-01-01", date: "2027-01-01", changes: [{ type: "removed" as const, breaking: true, note: "x" }] }]
    expect(checkContract({ base: doc, committed: broken, generated: broken }, log).ok).toBe(true)
  })

  it("a stale snapshot fails even when nothing breaks", () => {
    expect(checkContract({ base: doc, committed: null, generated: doc }).reason).toBe("snapshot_stale")
    expect(checkContract({ base: doc, committed: doc, generated: doc }).ok).toBe(true)
  })
})

describe("phase-api-versioning middleware", () => {
  afterEach(() => {
    delete process.env.FEATURE_PHASE_API_VERSIONING
  })

  const req = (url: string, headers: Record<string, string> = {}, method = "GET") =>
    new NextRequest(new URL(url, "http://localhost"), { headers, method })

  it("flag off: no negotiation, no version headers, bad versions pass through", () => {
    const res = middleware(req("/api/market", { "X-API-Version": "nope" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("X-API-Version")).toBeNull()
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy()
  })

  it("flag on: echoes the negotiated version and forwards it to the handler", () => {
    process.env.FEATURE_PHASE_API_VERSIONING = "1"
    const res = middleware(req("/api/market"))
    expect(res.headers.get("X-API-Version")).toBe(currentApiVersion())
    expect(res.headers.get("x-middleware-request-x-phase-api-version")).toBe(currentApiVersion())
    expect(res.headers.get("X-Frame-Options")).toBe("DENY")
  })

  it("flag on: rejects unsupported versions with a typed 406", async () => {
    process.env.FEATURE_PHASE_API_VERSIONING = "1"
    const res = middleware(req("/api/market", { "Accept-Version": "1999-01-01" }))
    expect(res.status).toBe(406)
    expect(await res.json()).toEqual({
      error: "UNSUPPORTED_API_VERSION",
      requested: "1999-01-01",
      supported: [currentApiVersion()],
    })
  })

  it("flag on: pages and CORS preflights are left alone", () => {
    process.env.FEATURE_PHASE_API_VERSIONING = "1"
    expect(middleware(req("/explore", { "X-API-Version": "nope" })).headers.get("X-API-Version")).toBeNull()
    expect(middleware(req("/api/metadata/1", { "X-API-Version": "nope" }, "OPTIONS")).status).toBe(200)
  })
})
