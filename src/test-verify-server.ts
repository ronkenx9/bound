import { handleVerifyRequest } from "./verify/server.js";
import type { LedgerRecordOnChain } from "./sui/read.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeRecord(objectId: string): LedgerRecordOnChain {
  return {
    objectId,
    type: "0x2::ledger::record::LedgerRecord",
    owner: "0xowner",
    walrusBlobId: "walrus-blob-123",
    contentHash: "abc123",
    recordType: 1,
    createdAtMs: 123456,
    evidenceBlobIds: [],
    sealed: true,
    actorType: null,
    actorId: null,
    txDigest: null,
    linkedPolicyId: null,
    actionStatus: null,
  };
}

async function validJsonVerifyRequest() {
  const result = await handleVerifyRequest({
    method: "GET",
    url: "/verify/0xabc",
    verifyRecord: async objectId => ({
      ok: true,
      record: makeRecord(objectId),
      expectedContentHash: "abc123",
      actualContentHash: "abc123",
      byteLength: 512,
    }),
  });

  assert(result.statusCode === 200, `expected 200, got ${result.statusCode}`);
  assert(result.headers["content-type"] === "application/json; charset=utf-8", "expected JSON content type");
  const body = JSON.parse(result.body) as Record<string, unknown>;
  assert(body["ok"] === true, "expected ok true");
  assert(body["objectId"] === "0xabc", "expected object id");
  assert(body["walrusBlobId"] === "walrus-blob-123", "expected blob id");
  assert(body["actualContentHash"] === "abc123", "expected actual hash");
  assert(body["byteLength"] === 512, "expected byte length");
}

async function bearerAuthProtectsVerifyRoute() {
  const missing = await handleVerifyRequest({
    method: "GET",
    url: "/verify/0xabc",
    authToken: "secret-token",
    verifyRecord: async () => {
      throw new Error("should not verify unauthenticated request");
    },
  });
  assert(missing.statusCode === 401, `expected 401, got ${missing.statusCode}`);
  assert(missing.headers["www-authenticate"] === "Bearer", "expected bearer challenge");

  const allowed = await handleVerifyRequest({
    method: "GET",
    url: "/verify/0xabc",
    headers: { authorization: "Bearer secret-token" },
    authToken: "secret-token",
    verifyRecord: async objectId => ({
      ok: true,
      record: makeRecord(objectId),
      expectedContentHash: "abc123",
      actualContentHash: "abc123",
      byteLength: 512,
    }),
  });
  assert(allowed.statusCode === 200, `expected authorized 200, got ${allowed.statusCode}`);
}

async function rateLimitProtectsVerifyRoute() {
  const rateLimiter = { windowMs: 60_000, maxRequests: 1, nowMs: 1000 };
  const first = await handleVerifyRequest({
    method: "GET",
    url: "/verify/0xabc",
    remoteAddress: "203.0.113.10",
    rateLimiter,
    verifyRecord: async objectId => ({
      ok: true,
      record: makeRecord(objectId),
      expectedContentHash: "abc123",
      actualContentHash: "abc123",
      byteLength: 512,
    }),
  });
  assert(first.statusCode === 200, `expected first request 200, got ${first.statusCode}`);

  const second = await handleVerifyRequest({
    method: "GET",
    url: "/verify/0xabc",
    remoteAddress: "203.0.113.10",
    rateLimiter: { ...rateLimiter, nowMs: 2000 },
    verifyRecord: async () => {
      throw new Error("should not verify rate-limited request");
    },
  });
  assert(second.statusCode === 429, `expected second request 429, got ${second.statusCode}`);
  assert(second.headers["retry-after"] === "59", "expected retry-after seconds");
}

async function missingRouteReturns404() {
  const result = await handleVerifyRequest({
    method: "GET",
    url: "/nope",
    verifyRecord: async () => {
      throw new Error("should not verify unknown route");
    },
  });

  assert(result.statusCode === 404, `expected 404, got ${result.statusCode}`);
  const body = JSON.parse(result.body) as Record<string, unknown>;
  assert(body["ok"] === false, "expected ok false");
}

async function verifyFailureReturnsSafeError() {
  const result = await handleVerifyRequest({
    method: "GET",
    url: "/verify/0xmissing",
    verifyRecord: async () => {
      throw new Error("Sui object lookup failed: notExists");
    },
  });

  assert(result.statusCode === 502, `expected 502, got ${result.statusCode}`);
  const body = JSON.parse(result.body) as Record<string, unknown>;
  assert(body["ok"] === false, "expected ok false");
  assert(body["objectId"] === "0xmissing", "expected object id in error");
  assert(body["error"] === "verification_failed", "expected generic error code");
}

await validJsonVerifyRequest();
await bearerAuthProtectsVerifyRoute();
await rateLimitProtectsVerifyRoute();
await missingRouteReturns404();
await verifyFailureReturnsSafeError();

console.log("Verify server tests passed.");
