import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { API_VERSION_HEADER, FORWARDED_API_VERSION_HEADER, isKnownApiVersion } from "@/lib/api-versioning"

type ApiLogLevel = "info" | "warn" | "error"
type ApiMetadata = Record<string, unknown>

type ApiJsonInit = ResponseInit & {
  event?: string
  metadata?: ApiMetadata
}

const CORRELATION_HEADER = "x-correlation-id"
const REQUEST_ID_HEADER = "x-request-id"

function getIncomingCorrelationId(request: NextRequest): string {
  const headerValue =
    request.headers.get(CORRELATION_HEADER) ?? request.headers.get(REQUEST_ID_HEADER)
  const trimmed = headerValue?.trim()

  return trimmed ? trimmed.slice(0, 128) : randomUUID()
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}

export function createApiRequestContext(request: NextRequest, route: string) {
  const startedAt = Date.now()
  const correlationId = getIncomingCorrelationId(request)
  // phase-api-versioning: only a version the middleware negotiated is logged, so the label set stays closed.
  const forwardedVersion = request.headers.get(FORWARDED_API_VERSION_HEADER)
  const apiVersion = isKnownApiVersion(forwardedVersion) ? forwardedVersion : undefined

  function log(level: ApiLogLevel, event: string, metadata: ApiMetadata = {}) {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      event,
      route,
      method: request.method,
      correlationId,
      ...(apiVersion ? { apiVersion } : {}),
      ...metadata,
    }
    const line = JSON.stringify(payload)

    if (level === "error") console.error(line)
    else if (level === "warn") console.warn(line)
    else console.info(line)
  }

  function json<T>(body: T, init: ApiJsonInit = {}) {
    const { event = "request_completed", metadata = {}, headers, ...responseInit } = init
    const status = responseInit.status ?? 200
    const response = NextResponse.json(body, { ...responseInit, status, headers })
    response.headers.set(CORRELATION_HEADER, correlationId)
    response.headers.set(REQUEST_ID_HEADER, correlationId)
    if (apiVersion) response.headers.set(API_VERSION_HEADER, apiVersion)
    log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", event, {
      status,
      durationMs: Date.now() - startedAt,
      ...metadata,
    })
    return response
  }

  function errorJson(error: unknown, status = 500, event = "request_failed") {
    const message = getErrorMessage(error)
    log("error", event, { status, durationMs: Date.now() - startedAt, error: message })
    return json({ error: "Internal server error" }, { status, event })
  }

  return { correlationId, apiVersion, log, json, errorJson }
}

// ── Spikes 672-675: closed event names for new flows (no PII in events) ──
export const SPIKE_OBSERVABILITY_EVENTS = [
  "edition.minted",
  "edition.supply_exhausted",
  "collab.split_recorded",
  "drop.ticket_issued",
  "drop.claim_rejected",
  "dutch.price_computed",
  "dutch.quote_stale_rejected",
] as const;
export type SpikeObservabilityEvent = (typeof SPIKE_OBSERVABILITY_EVENTS)[number];