/**
 * Spike 663 (phase-api-versioning): API contract snapshot + breaking-change gate.
 *
 *   npm run api:contract                       # check, exit 0 when clean
 *   npm run api:contract -- --write            # regenerate docs/api/*.json
 *   npm run api:contract -- --base base.json   # CI: compare against the target branch
 *   npm run api:contract -- --json             # machine-readable report
 *
 * Exit codes: 0 ok, 1 breaking change without a version bump + changelog,
 * 2 committed snapshot is stale, 64 bad arguments.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { API_CHANGELOG, buildOpenApiDocument, checkContract, type OpenApiDocument } from "../lib/api-versioning"

const ROOT = path.resolve(__dirname, "..")
const OPENAPI_PATH = path.join(ROOT, "docs/api/openapi.json")
const CHANGELOG_PATH = path.join(ROOT, "docs/api/changelog.json")

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function readJson(file: string): OpenApiDocument | null {
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, "utf8")) as OpenApiDocument
}

function main(argv: string[]): number {
  const json = argv.includes("--json")
  const write = argv.includes("--write")
  const baseIdx = argv.indexOf("--base")
  const basePath = baseIdx >= 0 ? argv[baseIdx + 1] : undefined
  if (baseIdx >= 0 && (!basePath || basePath.startsWith("--"))) {
    console.error("--base needs a file path")
    return 64
  }

  const generated = buildOpenApiDocument()

  if (write) {
    mkdirSync(path.dirname(OPENAPI_PATH), { recursive: true })
    writeFileSync(OPENAPI_PATH, serialize(generated))
    writeFileSync(CHANGELOG_PATH, serialize(API_CHANGELOG))
    console.log(json ? JSON.stringify({ ok: true, wrote: ["docs/api/openapi.json", "docs/api/changelog.json"] }) : "wrote docs/api/openapi.json and docs/api/changelog.json")
    return 0
  }

  const committed = readJson(OPENAPI_PATH)
  // No base snapshot (first run on a branch without one) means nothing to break yet.
  const base = (basePath ? readJson(path.resolve(basePath)) : committed) ?? generated
  const result = checkContract({ base, committed, generated })

  const changelogStale = !existsSync(CHANGELOG_PATH) || readFileSync(CHANGELOG_PATH, "utf8") !== serialize(API_CHANGELOG)
  const stale = result.stale || changelogStale
  const ok = result.ok && !changelogStale
  const reason = result.reason ?? (changelogStale ? "snapshot_stale" : undefined)

  if (json) {
    console.log(JSON.stringify({ ok, reason, stale, breaking: result.breaking, version: generated.info.version }))
  } else if (ok) {
    console.log(`api contract ok (version ${generated.info.version}, ${Object.keys(generated.paths).length} paths)`)
  } else {
    for (const b of result.breaking) console.error(`breaking: ${b.kind} at ${b.where}`)
    if (reason === "breaking_without_version_bump") console.error("Add a new current version to API_VERSIONS in lib/api-versioning.ts.")
    if (reason === "breaking_without_changelog") console.error("Add an API_CHANGELOG entry with breaking: true for the new version.")
    if (stale) console.error("Snapshot is stale. Run: npm run api:contract -- --write")
  }

  if (reason === "breaking_without_version_bump" || reason === "breaking_without_changelog") return 1
  return stale ? 2 : 0
}

process.exitCode = main(process.argv.slice(2))
