import { handleAgentRequest, type AgentApiDeps } from "./agent/server.js";
import type { AgentActionLog, AgentPolicy } from "./db.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TOKEN = "agent-secret-token";

function makePolicy(over: Partial<AgentPolicy> = {}): AgentPolicy {
  return {
    policyId: "policy_abc",
    onChainPolicyId: "0xpolicy",
    ownerAddress: "0xowner",
    agentId: "fuel-agent",
    counterparty: "emeka",
    category: "fuel",
    maxAmountNgn: 70000,
    approvalThresholdNgn: null,
    expiresAtMs: null,
    revokedAtMs: null,
    createdAtMs: 1000,
    ...over,
  };
}

function makeAction(over: Partial<AgentActionLog> = {}): AgentActionLog {
  return {
    actionId: "action_123",
    onChainActionId: "0xaction",
    policyId: "policy_abc",
    agentId: "fuel-agent",
    counterparty: "emeka",
    recipientAddress: "0xrecipient",
    category: "fuel",
    amountNgn: null,
    amountMist: 500_000_000,
    currency: "SUI",
    proposedText: "pay 0.5 SUI to 0xrecipient for fuel",
    status: "executed",
    reason: "Policy matched; executed.",
    idempotencyKey: "key",
    txDigest: "0xpaytx",
    onChainTxDigest: "0xaudittx",
    approvalOnChainActionId: null,
    approvalOnChainTxDigest: null,
    approvedBy: null,
    approvedAtMs: null,
    balanceBeforeMist: 1_000_000_000,
    balanceAfterMist: 499_000_000,
    reconciledRecordObjectId: null,
    reconciledAtMs: null,
    createdAtMs: 2000,
    ...over,
  };
}

function stubDeps(over: Partial<AgentApiDeps> = {}): AgentApiDeps {
  return {
    ownerAddress: "0xowner",
    createPolicy: async () => makePolicy(),
    evaluateTransaction: async () => ({ log: makeAction(), record: { objectId: "0xrec", txDigest: "0xrectx", verifyUrl: "https://l/verify/0xrec" } as any }),
    approveAction: async () => ({ log: makeAction({ status: "executed" }) }),
    rejectAction: async () => makeAction({ status: "rejected", reason: "operator rejected" }),
    revoke: async () => makePolicy({ revokedAtMs: 3000 }),
    getAction: () => makeAction(),
    ...over,
  };
}

function authed(extra: Record<string, unknown>) {
  return { headers: { authorization: `Bearer ${TOKEN}` }, authToken: TOKEN, rateLimiter: null, ...extra } as any;
}

async function authIsRequired() {
  // No token configured at all -> fail closed with 503.
  const noConfig = await handleAgentRequest({ method: "POST", url: "/agent/transaction", authToken: null, rateLimiter: null, deps: stubDeps() });
  assert(noConfig.statusCode === 503, `expected 503 when auth not configured, got ${noConfig.statusCode}`);

  // Token configured but missing/invalid in request -> 401.
  const unauth = await handleAgentRequest({ method: "POST", url: "/agent/transaction", authToken: TOKEN, rateLimiter: null, deps: stubDeps() });
  assert(unauth.statusCode === 401, `expected 401, got ${unauth.statusCode}`);
  assert(unauth.headers["www-authenticate"] === "Bearer", "expected bearer challenge");
}

async function createsPolicy() {
  const res = await handleAgentRequest(authed({
    method: "POST",
    url: "/agent/policy",
    body: JSON.stringify({ agentId: "fuel-agent", maxAmount: 70000, counterparty: "emeka", category: "fuel" }),
    deps: stubDeps(),
  }));
  assert(res.statusCode === 201, `expected 201, got ${res.statusCode}`);
  const body = JSON.parse(res.body);
  assert(body.ok === true, "expected ok");
  assert(body.policy.agentId === "fuel-agent", "expected agentId echoed");
  assert(body.policy.maxAmount === 70000, "expected maxAmount");
}

async function policyValidation() {
  const missing = await handleAgentRequest(authed({ method: "POST", url: "/agent/policy", body: JSON.stringify({ maxAmount: 100 }), deps: stubDeps() }));
  assert(missing.statusCode === 400 && JSON.parse(missing.body).field === "agentId", "expected missing agentId 400");

  const badAmount = await handleAgentRequest(authed({ method: "POST", url: "/agent/policy", body: JSON.stringify({ agentId: "a", maxAmount: -5 }), deps: stubDeps() }));
  assert(badAmount.statusCode === 400 && JSON.parse(badAmount.body).field === "maxAmount", "expected invalid maxAmount 400");

  const badJson = await handleAgentRequest(authed({ method: "POST", url: "/agent/policy", body: "{not json", deps: stubDeps() }));
  assert(badJson.statusCode === 400 && JSON.parse(badJson.body).error === "invalid_json", "expected invalid_json 400");
}

async function evaluatesTransaction() {
  const res = await handleAgentRequest(authed({
    method: "POST",
    url: "/agent/transaction",
    body: JSON.stringify({ intent: "pay 0.5 SUI to 0xrecipient for fuel", agentId: "fuel-agent" }),
    deps: stubDeps(),
  }));
  assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
  const body = JSON.parse(res.body);
  assert(body.action.status === "executed", "expected executed status");
  assert(body.action.paymentTxDigest === "0xpaytx", "expected payment digest");
  assert(body.action.verifyUrl === "https://l/verify/0xrec", "expected verify url");
}

async function rejectionStatusIsReported() {
  const res = await handleAgentRequest(authed({
    method: "POST",
    url: "/agent/transaction",
    body: JSON.stringify({ intent: "pay 999 SUI to 0xx" }),
    deps: stubDeps({ evaluateTransaction: async () => ({ log: makeAction({ status: "rejected", reason: "over cap", txDigest: null }) }) }),
  }));
  assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
  const body = JSON.parse(res.body);
  assert(body.action.status === "rejected", "expected rejected");
  assert(body.action.paymentTxDigest === null, "expected no payment digest");
}

async function approveRejectGetAndRevoke() {
  const approve = await handleAgentRequest(authed({ method: "POST", url: "/agent/actions/action_123/approve", body: JSON.stringify({ approvedBy: "ops" }), deps: stubDeps() }));
  assert(approve.statusCode === 200 && JSON.parse(approve.body).action.status === "executed", "expected approve executed");

  const reject = await handleAgentRequest(authed({ method: "POST", url: "/agent/actions/action_123/reject", body: JSON.stringify({ reason: "no" }), deps: stubDeps() }));
  assert(reject.statusCode === 200 && JSON.parse(reject.body).action.status === "rejected", "expected reject status");

  const get = await handleAgentRequest(authed({ method: "GET", url: "/agent/actions/action_123", deps: stubDeps() }));
  assert(get.statusCode === 200 && JSON.parse(get.body).action.actionId === "action_123", "expected action fetched");

  const getMissing = await handleAgentRequest(authed({ method: "GET", url: "/agent/actions/nope", deps: stubDeps({ getAction: () => undefined }) }));
  assert(getMissing.statusCode === 404, "expected 404 for missing action");

  const revoke = await handleAgentRequest(authed({ method: "POST", url: "/agent/policies/policy_abc/revoke", deps: stubDeps() }));
  assert(revoke.statusCode === 200 && JSON.parse(revoke.body).policy.revokedAtMs === 3000, "expected revoked policy");

  const revokeMissing = await handleAgentRequest(authed({ method: "POST", url: "/agent/policies/nope/revoke", deps: stubDeps({ revoke: async () => undefined }) }));
  assert(revokeMissing.statusCode === 404, "expected 404 for missing policy");
}

async function engineConflictsBecome409() {
  const res = await handleAgentRequest(authed({
    method: "POST",
    url: "/agent/actions/action_123/approve",
    body: JSON.stringify({}),
    deps: stubDeps({ approveAction: async () => { throw new Error("Agent action action_123 is executed, not pending_approval"); } }),
  }));
  assert(res.statusCode === 409, `expected 409, got ${res.statusCode}`);
  assert(JSON.parse(res.body).error === "conflict", "expected conflict error");

  // Business-rule rejections from approve must also be 409, not 500.
  const messages = [
    "Approval would exceed rolling spend window: spent 100 MIST, requested 200 MIST, cap 250 MIST.",
    "Pending action action_123 has no amount to execute",
  ];
  for (const message of messages) {
    const r = await handleAgentRequest(authed({
      method: "POST",
      url: "/agent/actions/action_123/approve",
      body: JSON.stringify({}),
      deps: stubDeps({ approveAction: async () => { throw new Error(message); } }),
    }));
    assert(r.statusCode === 409, `expected 409 for "${message.slice(0, 30)}...", got ${r.statusCode}`);
  }
}

async function rateLimitEnforced() {
  const limiter = { windowMs: 60_000, maxRequests: 1, nowMs: 1000 };
  const first = await handleAgentRequest({ method: "GET", url: "/agent/actions/action_123", headers: { authorization: `Bearer ${TOKEN}` }, authToken: TOKEN, remoteAddress: "203.0.113.5", rateLimiter: limiter, deps: stubDeps() });
  assert(first.statusCode === 200, `expected first 200, got ${first.statusCode}`);
  const second = await handleAgentRequest({ method: "GET", url: "/agent/actions/action_123", headers: { authorization: `Bearer ${TOKEN}` }, authToken: TOKEN, remoteAddress: "203.0.113.5", rateLimiter: { ...limiter, nowMs: 2000 }, deps: stubDeps() });
  assert(second.statusCode === 429, `expected 429, got ${second.statusCode}`);
  assert(second.headers["retry-after"] === "59", "expected retry-after");
}

async function unknownRouteIs404() {
  const res = await handleAgentRequest(authed({ method: "GET", url: "/agent/nope", deps: stubDeps() }));
  assert(res.statusCode === 404 && JSON.parse(res.body).error === "not_found", "expected 404 not_found");
}

await authIsRequired();
await createsPolicy();
await policyValidation();
await evaluatesTransaction();
await rejectionStatusIsReported();
await approveRejectGetAndRevoke();
await engineConflictsBecome409();
await rateLimitEnforced();
await unknownRouteIs404();

console.log("Agent server tests passed.");
