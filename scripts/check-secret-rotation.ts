import { creatorPreflight } from "./creator-preflight.js"

creatorPreflight({
  script: "check-secret-rotation.ts",
  plan: [
    "read secret rotation metadata from env and report fresh / due / overdue (read-only)",
  ],
})

type RotationStatus = "missing_metadata" | "fresh" | "due" | "overdue"

type RotationReport = {
  secret: string
  status: RotationStatus
  rotatedAt?: string
  ageDays?: number
  maxAgeDays: number
  graceDays: number
  requiredMetadataEnv: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function readList(name: string, fallback: string[]): string[] {
  return (process.env[name] ?? fallback.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function getAgeDays(rotatedAt: string): number | null {
  const timestamp = Date.parse(rotatedAt)
  if (!Number.isFinite(timestamp)) return null
  return Math.floor((Date.now() - timestamp) / DAY_MS)
}

const secrets = readList("SECRET_ROTATION_KEYS", [
  "CLASSIC_LIQ_ISSUER_SECRET",
  "FAUCET_DISTRIBUTOR_SECRET_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
])
const maxAgeDays = readNumber("SECRET_ROTATION_MAX_AGE_DAYS", 90)
const graceDays = readNumber("SECRET_ROTATION_GRACE_DAYS", 14)
const reports: RotationReport[] = secrets.map((secret) => {
  const requiredMetadataEnv = `${secret}_ROTATED_AT`
  const rotatedAt = process.env[requiredMetadataEnv]?.trim()

  if (!rotatedAt) {
    return { secret, status: "missing_metadata", maxAgeDays, graceDays, requiredMetadataEnv }
  }

  const ageDays = getAgeDays(rotatedAt)
  if (ageDays === null) {
    return { secret, status: "missing_metadata", rotatedAt, maxAgeDays, graceDays, requiredMetadataEnv }
  }

  const status: RotationStatus =
    ageDays > maxAgeDays + graceDays ? "overdue" : ageDays > maxAgeDays ? "due" : "fresh"
  return { secret, status, rotatedAt, ageDays, maxAgeDays, graceDays, requiredMetadataEnv }
})

for (const report of reports) {
  const level = report.status === "fresh" ? "info" : report.status === "due" ? "warn" : "error"
  console[level](JSON.stringify({ event: "secret_rotation_status", ...report }))
}

if (reports.some((report) => report.status === "overdue" || report.status === "missing_metadata")) {
  process.exitCode = 1
}