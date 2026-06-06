import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { verifyLedgerRecord, type VerifyRecordResult } from "./service.js";
import { logger } from "../ops/logger.js";
import { secret } from "../secrets.js";

export interface VerifyHttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  remoteAddress?: string | null;
  authToken?: string | null;
  rateLimiter?: VerifyRateLimiter | null;
  verifyRecord?: (objectId: string) => Promise<VerifyRecordResult>;
}

export interface VerifyRateLimiter {
  windowMs: number;
  maxRequests: number;
  nowMs?: number;
}

export interface VerifyHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const rateLimitBuckets = new Map<string, { count: number; resetAtMs: number }>();

function json(
  statusCode: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): VerifyHttpResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body, null, 2),
  };
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function headerValue(headers: VerifyHttpRequest["headers"], name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function isAuthorized(request: VerifyHttpRequest): boolean {
  const authToken = request.authToken ?? secret("LEDGER_VERIFY_AUTH_TOKEN") ?? null;
  if (!authToken) return true;

  const authorization = headerValue(request.headers, "authorization");
  return authorization === `Bearer ${authToken}`;
}

function defaultRateLimiter(): VerifyRateLimiter | null {
  const maxRaw = env("LEDGER_VERIFY_RATE_LIMIT_MAX");
  if (!maxRaw) return null;

  const maxRequests = Number.parseInt(maxRaw, 10);
  const windowMs = Number.parseInt(env("LEDGER_VERIFY_RATE_LIMIT_WINDOW_MS") ?? "60000", 10);
  if (!Number.isSafeInteger(maxRequests) || maxRequests <= 0) return null;
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) return null;
  return { maxRequests, windowMs };
}

function rateLimitKey(request: VerifyHttpRequest): string {
  return request.remoteAddress ?? headerValue(request.headers, "x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function checkRateLimit(request: VerifyHttpRequest): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const limiter = request.rateLimiter === undefined ? defaultRateLimiter() : request.rateLimiter;
  if (!limiter) return { allowed: true };

  const nowMs = limiter.nowMs ?? Date.now();
  const key = rateLimitKey(request);
  const existing = rateLimitBuckets.get(key);
  if (!existing || existing.resetAtMs <= nowMs) {
    // Bound memory: evict expired buckets when the map grows large.
    if (rateLimitBuckets.size >= 10_000) {
      for (const [k, b] of rateLimitBuckets) {
        if (b.resetAtMs <= nowMs) rateLimitBuckets.delete(k);
      }
    }
    rateLimitBuckets.set(key, { count: 1, resetAtMs: nowMs + limiter.windowMs });
    return { allowed: true };
  }

  if (existing.count >= limiter.maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true };
}

function extractVerifyObjectId(url: string): string | null {
  const parsed = new URL(url, "http://ledger.local");
  const match = /^\/verify\/([^/]+)$/.exec(parsed.pathname);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]);
}

function serializeResult(result: VerifyRecordResult): Record<string, unknown> {
  const { record } = result;
  return {
    ok: result.ok,
    objectId: record.objectId,
    type: record.type,
    owner: record.owner,
    walrusBlobId: record.walrusBlobId,
    expectedContentHash: result.expectedContentHash,
    actualContentHash: result.actualContentHash,
    byteLength: result.byteLength,
    recordType: record.recordType,
    createdAtMs: record.createdAtMs,
    sealed: record.sealed,
    evidenceBlobIds: record.evidenceBlobIds,
    actorType: record.actorType,
    actorId: record.actorId,
    txDigest: record.txDigest,
    linkedPolicyId: record.linkedPolicyId,
    actionStatus: record.actionStatus,
  };
}

export async function handleVerifyRequest(request: VerifyHttpRequest): Promise<VerifyHttpResponse> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const objectId = extractVerifyObjectId(request.url);
  if (!objectId) {
    return json(404, { ok: false, error: "not_found" });
  }

  if (!isAuthorized(request)) {
    return json(401, { ok: false, error: "unauthorized" }, { "www-authenticate": "Bearer" });
  }

  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    return json(
      429,
      { ok: false, error: "rate_limited" },
      { "retry-after": String(rateLimit.retryAfterSeconds) },
    );
  }

  try {
    const verifyRecord = request.verifyRecord ?? verifyLedgerRecord;
    const result = await verifyRecord(objectId);
    return json(result.ok ? 200 : 409, serializeResult(result));
  } catch {
    return json(502, {
      ok: false,
      objectId,
      error: "verification_failed",
    });
  }
}

function sendResponse(response: ServerResponse, result: VerifyHttpResponse, method: string) {
  response.writeHead(result.statusCode, result.headers);
  response.end(method === "HEAD" ? undefined : result.body);
}

export function createVerifyServer() {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    handleVerifyRequest({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers as Record<string, string | string[] | undefined>,
      remoteAddress: request.socket.remoteAddress,
    }).then(
      result => sendResponse(response, result, request.method ?? "GET"),
      err => {
        logger.error("verify_server_internal_error", {
          method: request.method,
          url: request.url,
          remoteAddress: request.socket.remoteAddress,
        }, err);
        sendResponse(response, json(500, { ok: false, error: "internal_error" }), request.method ?? "GET");
      },
    );
  });
}

export async function startVerifyServer(port: number): Promise<void> {
  const server = createVerifyServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  logger.info("verify_server_started", { port });
}
