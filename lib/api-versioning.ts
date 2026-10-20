/**
 * Spike 663 (phase-api-versioning): API version negotiation, deprecation signalling and
 * the machine-readable contract.
 *
 * Pure module (no Next imports) so the edge middleware, route handlers, tests
 * and `scripts/api-contract.ts` all share one implementation.
 *
 * Negotiation, when the flag is on:
 * - `X-API-Version: <id>` pins an exact version and wins over Accept-Version.
 * - `Accept-Version: <id>[, <id>...]` picks the first supported entry.
 * - Neither header: the current version.
 * - Unknown or malformed id: 406 UNSUPPORTED_API_VERSION.
 * - Version past its sunset: 410 API_VERSION_SUNSET.
 * Every negotiated response echoes `X-API-Version` and `Vary`.
 */

import { API_OPERATIONS, type ApiOperation } from "./api-contract"

export const API_VERSION_HEADER = "X-API-Version"
export const ACCEPT_VERSION_HEADER = "Accept-Version"
/**
 * Middleware sets `Vary` on the same response a route may set it on, and the
 * route's value can be replaced. So this is a superset of every `Vary` token an
 * `/api` route uses today (gated metadata/IPFS/OG responses vary on
 * Authorization and language). Dropping one would let a shared cache serve one
 * viewer's gated response to another. A test scans app/api to keep it complete.
 */
export const API_VARY_TOKENS = [
  "Accept-Version",
  "X-API-Version",
  "Authorization",
  "Accept-Language",
  "X-Phase-Lang",
] as const

/** Set by middleware on the forwarded request; handlers read it, clients never send it. */
export const FORWARDED_API_VERSION_HEADER = "x-phase-api-version"

export type ApiVersionStatus = "current" | "supported" | "deprecated"

export type ApiVersion = {
  id: string
  released: string
  status: ApiVersionStatus
  /** ISO date the version was marked deprecated. */
  deprecatedAt?: string
  /** ISO date after which requests pinned to this version get 410. */
  sunsetAt?: string
}

export const API_VERSIONS: readonly ApiVersion[] = [
  { id: "2026-10-17", released: "2026-10-17", status: "current" },
]

export function isKnownApiVersion(id: string | null | undefined, versions: readonly ApiVersion[] = API_VERSIONS): boolean {
  return Boolean(id && versions.some((v) => v.id === id))
}

export function currentApiVersion(versions: readonly ApiVersion[] = API_VERSIONS): string {
  const current = versions.find((v) => v.status === "current")
  if (!current) throw new Error("API_VERSIONS has no current version")
  return current.id
}

export type RouteDeprecation = {
  method: ApiOperation["method"]
  path: string
  deprecatedAt: string
  sunsetAt?: string
  /** Path of the replacement operation, sent as a successor-version link. */
  successor?: string
  /** Human-readable migration notes. */
  link: string
}

/** Empty on purpose: no route is deprecated today. Add entries here, never inline in a handler. */
export const ROUTE_DEPRECATIONS: readonly RouteDeprecation[] = []

export type ChangeType = "added" | "changed" | "deprecated" | "removed"

export type ChangelogEntry = {
  version: string
  date: string
  changes: { type: ChangeType; breaking: boolean; operation?: string; note: string }[]
}

export const API_CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "2026-10-17",
    date: "2026-10-17",
    changes: [
      {
        type: "added",
        breaking: false,
        note: "First versioned contract. Baseline of the routes listed in lib/api-contract.ts as they behaved at spike 663.",
      },
    ],
  },
]

const VERSION_ID = /^\d{4}-\d{2}-\d{2}$/

type HeaderReader = { get(name: string): string | null }

export type VersionNegotiation =
  | { ok: true; version: string; source: "x-api-version" | "accept-version" | "default" }
  | {
      ok: false
      status: 406 | 410
      error: "UNSUPPORTED_API_VERSION" | "API_VERSION_SUNSET"
      requested: string
      supported: string[]
    }

function isSunset(v: ApiVersion, now: Date): boolean {
  return Boolean(v.sunsetAt && Date.parse(v.sunsetAt) <= now.getTime())
}

export function negotiateApiVersion(
  headers: HeaderReader,
  opts: { versions?: readonly ApiVersion[]; now?: Date } = {},
): VersionNegotiation {
  const versions = opts.versions ?? API_VERSIONS
  const now = opts.now ?? new Date()
  const supported = versions.filter((v) => !isSunset(v, now)).map((v) => v.id)

  const pinned = headers.get(API_VERSION_HEADER)?.trim()
  const accept = headers.get(ACCEPT_VERSION_HEADER)?.trim()

  const candidates = pinned
    ? [pinned]
    : accept
      ? accept
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []

  if (candidates.length === 0) {
    return { ok: true, version: currentApiVersion(versions), source: "default" }
  }

  for (const id of candidates) {
    if (!VERSION_ID.test(id)) continue
    const match = versions.find((v) => v.id === id)
    if (match && !isSunset(match, now)) {
      return { ok: true, version: match.id, source: pinned ? "x-api-version" : "accept-version" }
    }
  }

  const requested = candidates.join(", ").slice(0, 64)
  const sunsetHit = candidates.some((id) => {
    const v = versions.find((x) => x.id === id)
    return v ? isSunset(v, now) : false
  })
  return sunsetHit
    ? { ok: false, status: 410, error: "API_VERSION_SUNSET", requested, supported }
    : { ok: false, status: 406, error: "UNSUPPORTED_API_VERSION", requested, supported }
}

export function pathMatchesTemplate(template: string, pathname: string): boolean {
  const pattern = template
    .split("/")
    .map((seg) => (/^\{[^}]+\}$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/")
  return new RegExp(`^${pattern}/?$`).test(pathname)
}

/** RFC 9745 `Deprecation: @<unix seconds>`. */
function deprecationValue(iso: string): string {
  return `@${Math.floor(Date.parse(iso) / 1000)}`
}

/** RFC 8594 `Sunset: <HTTP-date>`. */
function sunsetValue(iso: string): string {
  return new Date(Date.parse(iso)).toUTCString()
}

/**
 * Headers every negotiated response carries: the version echo, `Vary`, and
 * Deprecation / Sunset / Link when the version or the route is deprecated.
 */
export function versionResponseHeaders(
  method: string,
  pathname: string,
  version: string,
  opts: { versions?: readonly ApiVersion[]; deprecations?: readonly RouteDeprecation[] } = {},
): Record<string, string> {
  const versions = opts.versions ?? API_VERSIONS
  const deprecations = opts.deprecations ?? ROUTE_DEPRECATIONS
  const out: Record<string, string> = {
    [API_VERSION_HEADER]: version,
    Vary: API_VARY_TOKENS.join(", "),
  }
  const links: string[] = []

  const v = versions.find((x) => x.id === version)
  if (v?.status === "deprecated" && v.deprecatedAt) {
    out.Deprecation = deprecationValue(v.deprecatedAt)
    if (v.sunsetAt) out.Sunset = sunsetValue(v.sunsetAt)
    links.push(`</docs#api-versioning>; rel="deprecation"`)
    links.push(`</api/versions>; rel="successor-version"`)
  }

  const route = deprecations.find((d) => d.method === method && pathMatchesTemplate(d.path, pathname))
  if (route) {
    // A route-level date is more specific than a version-level one.
    out.Deprecation = deprecationValue(route.deprecatedAt)
    if (route.sunsetAt) out.Sunset = sunsetValue(route.sunsetAt)
    links.push(`<${route.link}>; rel="deprecation"`)
    if (route.successor) links.push(`<${route.successor}>; rel="successor-version"`)
  }

  if (links.length) out.Link = links.join(", ")
  return out
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

type JsonObject = { [k: string]: unknown }

export type OpenApiDocument = {
  openapi: "3.1.0"
  info: { title: string; version: string; "x-api-versions": ApiVersion[] }
  paths: Record<string, Record<string, JsonObject>>
}

const BODY_CONTENT_TYPE: Record<NonNullable<ApiOperation["body"]>["kind"], string> = {
  json: "application/json",
  "json-rpc": "application/json",
  multipart: "multipart/form-data",
}

function versionHeaderParams(): JsonObject[] {
  return [
    { name: API_VERSION_HEADER, in: "header", required: false, schema: { type: "string", pattern: VERSION_ID.source } },
    { name: ACCEPT_VERSION_HEADER, in: "header", required: false, schema: { type: "string" } },
  ]
}

export function buildOpenApiDocument(
  operations: readonly ApiOperation[] = API_OPERATIONS,
  opts: { versions?: readonly ApiVersion[]; deprecations?: readonly RouteDeprecation[] } = {},
): OpenApiDocument {
  const versions = opts.versions ?? API_VERSIONS
  const deprecations = opts.deprecations ?? ROUTE_DEPRECATIONS
  const paths: OpenApiDocument["paths"] = {}

  for (const op of operations) {
    const parameters: JsonObject[] = [
      ...(op.pathParams ?? []).map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      ...(op.query ?? []).map((name) => ({ name, in: "query", required: false, schema: { type: "string" } })),
      ...(op.headers ?? []).map((name) => ({ name, in: "header", required: false, schema: { type: "string" } })),
      ...versionHeaderParams(),
    ]
    const responseHeaders: JsonObject = {
      [API_VERSION_HEADER]: { schema: { type: "string" }, description: "Negotiated version (phase-api-versioning)" },
    }
    for (const h of op.responseHeaders ?? []) responseHeaders[h] = { schema: { type: "string" } }

    const responses: JsonObject = {}
    for (const status of [...op.statuses].sort((a, b) => a - b)) {
      responses[String(status)] = { description: `HTTP ${status}`, headers: responseHeaders }
    }
    responses["406"] ??= { description: "Unsupported API version (phase-api-versioning)" }

    const operation: JsonObject = {
      operationId: op.id,
      summary: op.summary,
      tags: [op.tag],
      parameters,
      responses,
      "x-state-changing": op.stateChanging,
      "x-signing": op.signing,
    }
    if (op.body) {
      operation.requestBody = {
        required: true,
        content: {
          [BODY_CONTENT_TYPE[op.body.kind]]: {
            schema: {
              type: "object",
              properties: Object.fromEntries(op.body.fields.map((f) => [f, {}])),
            },
          },
        },
      }
    }
    if (deprecations.some((d) => d.method === op.method && d.path === op.path)) operation.deprecated = true

    paths[op.path] ??= {}
    paths[op.path][op.method.toLowerCase()] = operation
  }

  return {
    openapi: "3.1.0",
    info: { title: "PHASE API", version: currentApiVersion(versions), "x-api-versions": [...versions] },
    paths,
  }
}

// ── Breaking-change detection ────────────────────────────────────────────────

export type BreakingChange = {
  kind:
    | "operation_removed"
    | "parameter_removed"
    | "parameter_now_required"
    | "body_field_removed"
    | "success_status_removed"
    | "response_header_removed"
    | "version_removed_before_sunset"
  where: string
}

function params(op: JsonObject): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const p of (op.parameters as JsonObject[] | undefined) ?? []) {
    out.set(`${p.in}:${p.name}`, Boolean(p.required))
  }
  return out
}

function bodyFields(op: JsonObject): string[] {
  const content = ((op.requestBody as JsonObject | undefined)?.content ?? {}) as Record<string, JsonObject>
  return Object.values(content).flatMap((c) =>
    Object.keys(((c.schema as JsonObject | undefined)?.properties as JsonObject | undefined) ?? {}),
  )
}

function responseHeaderNames(op: JsonObject): Set<string> {
  const out = new Set<string>()
  for (const r of Object.values((op.responses as Record<string, JsonObject>) ?? {})) {
    for (const h of Object.keys((r.headers as JsonObject | undefined) ?? {})) out.add(h)
  }
  return out
}

export function diffContracts(prev: OpenApiDocument, next: OpenApiDocument, now = new Date()): BreakingChange[] {
  const out: BreakingChange[] = []

  for (const [path, methods] of Object.entries(prev.paths)) {
    for (const [method, prevOp] of Object.entries(methods)) {
      const where = `${method.toUpperCase()} ${path}`
      const nextOp = next.paths[path]?.[method]
      if (!nextOp) {
        out.push({ kind: "operation_removed", where })
        continue
      }
      const before = params(prevOp)
      const after = params(nextOp)
      for (const [key, wasRequired] of before) {
        if (!after.has(key)) out.push({ kind: "parameter_removed", where: `${where} ${key}` })
        else if (!wasRequired && after.get(key)) out.push({ kind: "parameter_now_required", where: `${where} ${key}` })
      }
      for (const [key, isRequired] of after) {
        if (!before.has(key) && isRequired) out.push({ kind: "parameter_now_required", where: `${where} ${key}` })
      }
      const nextFields = new Set(bodyFields(nextOp))
      for (const f of bodyFields(prevOp)) {
        if (!nextFields.has(f)) out.push({ kind: "body_field_removed", where: `${where} body.${f}` })
      }
      const nextStatuses = new Set(Object.keys((nextOp.responses as JsonObject) ?? {}))
      for (const s of Object.keys((prevOp.responses as JsonObject) ?? {})) {
        if (s.startsWith("2") && !nextStatuses.has(s)) out.push({ kind: "success_status_removed", where: `${where} ${s}` })
      }
      const nextHeaders = responseHeaderNames(nextOp)
      for (const h of responseHeaderNames(prevOp)) {
        if (!nextHeaders.has(h)) out.push({ kind: "response_header_removed", where: `${where} ${h}` })
      }
    }
  }

  const nextVersions = new Set(next.info["x-api-versions"].map((v) => v.id))
  for (const v of prev.info["x-api-versions"]) {
    if (nextVersions.has(v.id)) continue
    if (!v.sunsetAt || Date.parse(v.sunsetAt) > now.getTime()) {
      out.push({ kind: "version_removed_before_sunset", where: v.id })
    }
  }
  return out
}

export type ContractCheck = {
  ok: boolean
  breaking: BreakingChange[]
  /** Committed snapshot differs from the source (regenerate with --write). */
  stale: boolean
  reason?: "breaking_without_version_bump" | "breaking_without_changelog" | "snapshot_stale"
}

/**
 * `base` is the snapshot on the target branch (what deployed clients rely on),
 * `committed` is the snapshot in this change, `generated` is rendered from
 * source. Breaking changes are measured base → generated and pass only with a
 * new current version whose changelog entry is flagged `breaking: true`.
 * `committed` must equal `generated`, otherwise the snapshot is stale.
 */
export function checkContract(
  input: { base: OpenApiDocument; committed: OpenApiDocument | null; generated: OpenApiDocument },
  changelog: readonly ChangelogEntry[] = API_CHANGELOG,
  now = new Date(),
): ContractCheck {
  const { base, committed, generated } = input
  const breaking = diffContracts(base, generated, now)
  const stale = !committed || JSON.stringify(committed) !== JSON.stringify(generated)
  if (breaking.length > 0) {
    if (base.info.version === generated.info.version) {
      return { ok: false, breaking, stale, reason: "breaking_without_version_bump" }
    }
    const entry = changelog.find((e) => e.version === generated.info.version)
    if (!entry?.changes.some((c) => c.breaking)) {
      return { ok: false, breaking, stale, reason: "breaking_without_changelog" }
    }
  }
  if (stale) return { ok: false, breaking, stale, reason: "snapshot_stale" }
  return { ok: true, breaking, stale }
}
