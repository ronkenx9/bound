import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { logger } from "../ops/logger.js";
import { secret } from "../secrets.js";
import { getRuntimeConfig } from "../config.js";
import {
  createAgentOps,
  isAgentConflict,
  serializeAction,
  serializeMemory,
  serializePolicy,
  type AgentOps,
} from "./operations.js";

/** The HTTP handler calls into this surface; defaults bind to the real engine, tests inject fakes. */
export type AgentApiDeps = AgentOps;

export interface AgentRateLimiter {
  windowMs: number;
  maxRequests: number;
  nowMs?: number;
}

export interface AgentHttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  remoteAddress?: string | null;
  body?: string;
  authToken?: string | null;
  rateLimiter?: AgentRateLimiter | null;
  deps?: AgentApiDeps;
}

export interface AgentHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const rateLimitBuckets = new Map<string, { count: number; resetAtMs: number }>();

function json(statusCode: number, body: Record<string, unknown>, headers: Record<string, string> = {}): AgentHttpResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body, null, 2),
  };
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function headerValue(headers: AgentHttpRequest["headers"], name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Auth is mandatory for the agent API: it moves money. */
function authorize(request: AgentHttpRequest): { ok: true } | { ok: false; response: AgentHttpResponse } {
  const authToken = request.authToken ?? secret("LEDGER_AGENT_AUTH_TOKEN") ?? null;
  if (!authToken) {
    // Fail closed: never serve payment endpoints without a configured token.
    return { ok: false, response: json(503, { ok: false, error: "auth_not_configured" }) };
  }
  const authorization = headerValue(request.headers, "authorization");
  if (authorization !== `Bearer ${authToken}`) {
    return { ok: false, response: json(401, { ok: false, error: "unauthorized" }, { "www-authenticate": "Bearer" }) };
  }
  return { ok: true };
}

function defaultRateLimiter(): AgentRateLimiter | null {
  const maxRaw = env("LEDGER_AGENT_RATE_LIMIT_MAX");
  if (!maxRaw) return null;
  const maxRequests = Number.parseInt(maxRaw, 10);
  const windowMs = Number.parseInt(env("LEDGER_AGENT_RATE_LIMIT_WINDOW_MS") ?? "60000", 10);
  if (!Number.isSafeInteger(maxRequests) || maxRequests <= 0) return null;
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) return null;
  return { maxRequests, windowMs };
}

function rateLimitKey(request: AgentHttpRequest): string {
  return request.remoteAddress ?? headerValue(request.headers, "x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function pruneExpiredBuckets(nowMs: number): void {
  // Bound memory: evict expired buckets when the map grows large, so a flood of
  // unique client keys (or spoofed X-Forwarded-For) cannot grow it unboundedly.
  if (rateLimitBuckets.size < 10_000) return;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAtMs <= nowMs) rateLimitBuckets.delete(key);
  }
}

function checkRateLimit(request: AgentHttpRequest): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const limiter = request.rateLimiter === undefined ? defaultRateLimiter() : request.rateLimiter;
  if (!limiter) return { allowed: true };
  const nowMs = limiter.nowMs ?? Date.now();
  const key = rateLimitKey(request);
  const existing = rateLimitBuckets.get(key);
  if (!existing || existing.resetAtMs <= nowMs) {
    pruneExpiredBuckets(nowMs);
    rateLimitBuckets.set(key, { count: 1, resetAtMs: nowMs + limiter.windowMs });
    return { allowed: true };
  }
  if (existing.count >= limiter.maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)) };
  }
  existing.count += 1;
  return { allowed: true };
}

function defaultDeps(): AgentApiDeps {
  return createAgentOps(getRuntimeConfig().suiOwnerAddress);
}

function parseBody(request: AgentHttpRequest): Record<string, unknown> | null {
  if (!request.body || request.body.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(request.body);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type Route = { method: string; pattern: RegExp };

const ROUTES = {
  createPolicy: { method: "POST", pattern: /^\/agent\/policy\/?$/ },
  transaction: { method: "POST", pattern: /^\/agent\/transaction\/?$/ },
  approve: { method: "POST", pattern: /^\/agent\/actions\/([^/]+)\/approve\/?$/ },
  reject: { method: "POST", pattern: /^\/agent\/actions\/([^/]+)\/reject\/?$/ },
  getAction: { method: "GET", pattern: /^\/agent\/actions\/([^/]+)\/?$/ },
  revoke: { method: "POST", pattern: /^\/agent\/policies\/([^/]+)\/revoke\/?$/ },
  recall: { method: "POST", pattern: /^\/agent\/recall\/?$/ },
} satisfies Record<string, Route>;

function match(route: Route, method: string, pathname: string): RegExpExecArray | null {
  if (method !== route.method) return null;
  return route.pattern.exec(pathname);
}

export async function handleAgentRequest(request: AgentHttpRequest): Promise<AgentHttpResponse> {
  const auth = authorize(request);
  if (!auth.ok) return auth.response;

  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    return json(429, { ok: false, error: "rate_limited" }, { "retry-after": String(rateLimit.retryAfterSeconds) });
  }

  const pathname = new URL(request.url, "http://ledger.local").pathname;
  const method = request.method.toUpperCase();
  const deps = request.deps ?? defaultDeps();

  try {
    // POST /agent/policy
    if (match(ROUTES.createPolicy, method, pathname)) {
      const body = parseBody(request);
      if (!body) return json(400, { ok: false, error: "invalid_json" });
      const agentId = str(body["agentId"]);
      const maxAmount = num(body["maxAmount"]);
      if (!agentId) return json(400, { ok: false, error: "missing_field", field: "agentId" });
      if (maxAmount === null || maxAmount <= 0) return json(400, { ok: false, error: "invalid_field", field: "maxAmount" });
      const policy = await deps.createPolicy({
        agentId,
        counterparty: str(body["counterparty"]),
        category: str(body["category"]),
        maxAmount,
        approvalThreshold: num(body["approvalThreshold"]),
        expiresAtMs: num(body["expiresAtMs"]),
      });
      return json(201, { ok: true, policy: serializePolicy(policy) });
    }

    // POST /agent/transaction
    if (match(ROUTES.transaction, method, pathname)) {
      const body = parseBody(request);
      if (!body) return json(400, { ok: false, error: "invalid_json" });
      const intent = str(body["intent"]);
      if (!intent) return json(400, { ok: false, error: "missing_field", field: "intent" });
      const { log, record, memoryContext } = await deps.evaluateTransaction({ intent, agentId: str(body["agentId"]) ?? undefined });
      // 200 for a resolved decision (approved/executed/rejected/pending); the
      // status field carries the policy outcome. memory = context recalled before deciding.
      return json(200, {
        ok: log.status !== "failed",
        action: serializeAction(log, record),
        memory: serializeMemory(memoryContext ?? []),
      });
    }

    // POST /agent/actions/:id/approve
    const approveMatch = match(ROUTES.approve, method, pathname);
    if (approveMatch) {
      const body = parseBody(request);
      if (!body) return json(400, { ok: false, error: "invalid_json" });
      const { log, record } = await deps.approveAction({
        actionId: decodeURIComponent(approveMatch[1]!),
        approvedBy: str(body["approvedBy"]) ?? "api",
      });
      return json(200, { ok: log.status === "executed", action: serializeAction(log, record) });
    }

    // POST /agent/actions/:id/reject
    const rejectMatch = match(ROUTES.reject, method, pathname);
    if (rejectMatch) {
      const body = parseBody(request);
      if (!body) return json(400, { ok: false, error: "invalid_json" });
      const log = await deps.rejectAction({
        actionId: decodeURIComponent(rejectMatch[1]!),
        rejectedBy: str(body["rejectedBy"]) ?? "api",
        reason: str(body["reason"]) ?? undefined,
      });
      return json(200, { ok: true, action: serializeAction(log) });
    }

    // GET /agent/actions/:id
    const getMatch = match(ROUTES.getAction, method, pathname);
    if (getMatch) {
      const log = deps.getAction(decodeURIComponent(getMatch[1]!));
      if (!log) return json(404, { ok: false, error: "action_not_found" });
      return json(200, { ok: true, action: serializeAction(log) });
    }

    // POST /agent/policies/:id/revoke
    const revokeMatch = match(ROUTES.revoke, method, pathname);
    if (revokeMatch) {
      const policy = await deps.revoke({ id: decodeURIComponent(revokeMatch[1]!) });
      if (!policy) return json(404, { ok: false, error: "policy_not_found" });
      return json(200, { ok: true, policy: serializePolicy(policy) });
    }

    // POST /agent/recall
    if (match(ROUTES.recall, method, pathname)) {
      const body = parseBody(request);
      if (!body) return json(400, { ok: false, error: "invalid_json" });
      const query = str(body["query"]);
      if (!query) return json(400, { ok: false, error: "missing_field", field: "query" });
      const hits = await deps.recall({ query, limit: num(body["limit"]) ?? undefined });
      return json(200, { ok: true, memoryEnabled: deps.memoryEnabled(), memory: serializeMemory(hits) });
    }

    return json(404, { ok: false, error: "not_found" });
  } catch (err) {
    // Client errors from the agent engine (e.g. wrong state, missing action)
    // are surfaced as 409 with the reason; unexpected failures stay generic.
    if (isAgentConflict(err)) {
      return json(409, { ok: false, error: "conflict", detail: err instanceof Error ? err.message : String(err) });
    }
    throw err;
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX = 64 * 1024;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk as Buffer);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendResponse(response: ServerResponse, result: AgentHttpResponse) {
  response.writeHead(result.statusCode, result.headers);
  response.end(result.body);
}

export function createAgentServer() {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    readBody(request)
      .then(body =>
        handleAgentRequest({
          method: request.method ?? "GET",
          url: request.url ?? "/",
          headers: request.headers as Record<string, string | string[] | undefined>,
          remoteAddress: request.socket.remoteAddress,
          body,
        }),
      )
      .then(
        result => sendResponse(response, result),
        err => {
          logger.error("agent_server_internal_error", { method: request.method, url: request.url }, err);
          sendResponse(response, json(500, { ok: false, error: "internal_error" }));
        },
      );
  });
}

export async function startAgentServer(port: number): Promise<void> {
  if (!secret("LEDGER_AGENT_AUTH_TOKEN")) {
    throw new Error("LEDGER_AGENT_AUTH_TOKEN must be set to run the agent API (it executes payments)");
  }
  const server = createAgentServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
  logger.info("agent_server_started", { port });
}
