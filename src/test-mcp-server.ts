import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLedgerMcpServer, type McpServerOptions } from "./agent/mcp.js";
import type { AgentOps } from "./agent/operations.js";
import type { AgentActionLog, AgentPolicy } from "./db.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
    amountNgn: 50000,
    amountMist: null,
    currency: "NGN",
    proposedText: "pay Emeka N50,000 for fuel",
    status: "approved",
    reason: "Policy matched; approved.",
    idempotencyKey: "key",
    txDigest: null,
    onChainTxDigest: "0xaudittx",
    approvalOnChainActionId: null,
    approvalOnChainTxDigest: null,
    approvedBy: null,
    approvedAtMs: null,
    balanceBeforeMist: null,
    balanceAfterMist: null,
    reconciledRecordObjectId: null,
    reconciledAtMs: null,
    createdAtMs: 2000,
    ...over,
  };
}

function stubOps(over: Partial<AgentOps> = {}): AgentOps {
  return {
    ownerAddress: "0xowner",
    createPolicy: async () => makePolicy(),
    evaluateTransaction: async () => ({
      log: makeAction(),
      record: { objectId: "0xrec", txDigest: "0xrectx", verifyUrl: "https://l/verify/0xrec" } as any,
      memoryContext: [{ text: "payment_out N50,000 to Emeka for fuel", score: 0.92 }],
    }),
    approveAction: async () => ({ log: makeAction({ status: "executed", txDigest: "0xpay" }) }),
    rejectAction: async () => makeAction({ status: "rejected", reason: "operator rejected" }),
    revoke: async () => makePolicy({ revokedAtMs: 3000 }),
    getAction: () => makeAction(),
    recall: async () => [{ text: "payment_out N50,000 to Emeka for fuel", score: 0.92 }],
    memoryEnabled: () => true,
    ...over,
  };
}

async function connect(ops: AgentOps, options: McpServerOptions = { mode: "owner" }): Promise<Client> {
  const server = createLedgerMcpServer(ops, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function parse(result: any): any {
  const text = result.content?.[0]?.text;
  return JSON.parse(text);
}

async function ownerModeExposesAllTools() {
  const client = await connect(stubOps(), { mode: "owner" });
  const { tools } = await client.listTools();
  const names = tools.map(t => t.name).sort();
  const expected = [
    "approve_agent_action",
    "create_agent_policy",
    "get_agent_action",
    "propose_agent_transaction",
    "recall_financial_context",
    "reject_agent_action",
    "revoke_agent_policy",
  ];
  assert(JSON.stringify(names) === JSON.stringify(expected), `unexpected owner tools: ${names.join(",")}`);
  const propose = tools.find(t => t.name === "propose_agent_transaction");
  assert(propose?.inputSchema?.properties?.intent, "expected intent in propose schema");
  await client.close();
}

async function agentModeExposesOnlyProposeAndRead() {
  const client = await connect(stubOps(), { mode: "agent" });
  const { tools } = await client.listTools();
  const names = tools.map(t => t.name).sort();
  assert(JSON.stringify(names) === JSON.stringify(["get_agent_action", "propose_agent_transaction", "recall_financial_context"]), `agent mode leaked tools: ${names.join(",")}`);
  await client.close();
}

async function agentModeBlocksAdminTools() {
  // create_agent_policy must be unavailable in agent mode, so an agent cannot
  // self-grant spending authority. Calling it should be an error (unknown tool).
  const client = await connect(stubOps({ createPolicy: async () => { throw new Error("agent must not reach createPolicy"); } }), { mode: "agent" });
  const res: any = await client.callTool({ name: "create_agent_policy", arguments: { agentId: "x", maxAmount: 999999 } });
  assert(res.isError === true, "expected error calling admin tool in agent mode");
  await client.close();
}

async function agentModePinsAgentId() {
  let seenAgentId: string | undefined = "UNSET";
  const client = await connect(
    stubOps({ evaluateTransaction: async ({ agentId }) => { seenAgentId = agentId; return { log: makeAction() }; } }),
    { mode: "agent", agentId: "pinned-agent" },
  );
  // Even if the caller tries to pass a different agentId, it is ignored: the
  // schema omits agentId in pinned mode and the server forces the pinned value.
  await client.callTool({ name: "propose_agent_transaction", arguments: { intent: "pay 1 SUI to 0xabc", agentId: "attacker-agent" } as any });
  assert(seenAgentId === "pinned-agent", `expected pinned agentId, got ${seenAgentId}`);
  await client.close();
}

async function proposalRateLimitEnforced() {
  let calls = 0;
  const client = await connect(
    stubOps({ evaluateTransaction: async () => { calls += 1; return { log: makeAction() }; } }),
    { mode: "agent", minProposalIntervalMs: 60_000 },
  );
  const first = parse(await client.callTool({ name: "propose_agent_transaction", arguments: { intent: "pay 1 SUI to 0xabc" } }));
  assert(first.ok === true, "first proposal should pass");
  const second: any = await client.callTool({ name: "propose_agent_transaction", arguments: { intent: "pay 1 SUI to 0xabc" } });
  const secondBody = parse(second);
  assert(secondBody.ok === false && secondBody.error === "rate_limited", "second proposal should be rate limited");
  assert(calls === 1, "engine should only be hit once");
  await client.close();
}

async function createPolicyTool() {
  const client = await connect(stubOps());
  const res = await client.callTool({ name: "create_agent_policy", arguments: { agentId: "fuel-agent", maxAmount: 70000, counterparty: "emeka", category: "fuel" } });
  const body = parse(res);
  assert(body.ok === true, "expected ok");
  assert(body.policy.agentId === "fuel-agent", "expected agentId");
  assert(body.policy.maxAmount === 70000, "expected maxAmount");
  await client.close();
}

async function proposeTransactionTool() {
  const client = await connect(stubOps());
  const res = await client.callTool({ name: "propose_agent_transaction", arguments: { intent: "pay Emeka N50,000 for fuel", agentId: "fuel-agent" } });
  const body = parse(res);
  assert(body.action.status === "approved", "expected approved");
  assert(body.action.verifyUrl === "https://l/verify/0xrec", "expected verify url");
  assert(body.memory[0].text.includes("Emeka"), "expected memory in proposal response");
  await client.close();
}

async function recallFinancialContextTool() {
  let seenQuery = "";
  let seenLimit: number | undefined;
  const client = await connect(stubOps({
    recall: async input => {
      seenQuery = input.query;
      seenLimit = input.limit;
      return [{ text: "payment_out N50,000 to Emeka for fuel", score: 0.92 }];
    },
  }), { mode: "agent" });
  const res = await client.callTool({ name: "recall_financial_context", arguments: { query: "have I paid Emeka?", limit: 1 } });
  const body = parse(res);
  assert(body.ok === true, "expected ok");
  assert(body.memoryEnabled === true, "expected memory enabled flag");
  assert(body.memory[0].score === 0.92, "expected serialized score");
  assert(seenQuery === "have I paid Emeka?", `unexpected query ${seenQuery}`);
  assert(seenLimit === 1, `unexpected limit ${seenLimit}`);
  await client.close();
}

async function rejectedTransactionIsReported() {
  const client = await connect(stubOps({ evaluateTransaction: async () => ({ log: makeAction({ status: "rejected", reason: "over cap" }) }) }));
  const res = await client.callTool({ name: "propose_agent_transaction", arguments: { intent: "pay 999" } });
  const body = parse(res);
  assert(body.action.status === "rejected", "expected rejected");
  assert(body.ok === true, "tool call itself succeeds even when policy rejects");
  await client.close();
}

async function approveRejectGetRevoke() {
  const client = await connect(stubOps());

  const approve = parse(await client.callTool({ name: "approve_agent_action", arguments: { actionId: "action_123", approvedBy: "ops" } }));
  assert(approve.action.status === "executed" && approve.action.paymentTxDigest === "0xpay", "expected executed with payment");

  const reject = parse(await client.callTool({ name: "reject_agent_action", arguments: { actionId: "action_123", reason: "no" } }));
  assert(reject.action.status === "rejected", "expected rejected");

  const get = parse(await client.callTool({ name: "get_agent_action", arguments: { actionId: "action_123" } }));
  assert(get.action.actionId === "action_123", "expected action fetched");

  const revoke = parse(await client.callTool({ name: "revoke_agent_policy", arguments: { id: "policy_abc" } }));
  assert(revoke.policy.revokedAtMs === 3000, "expected revoked policy");

  await client.close();
}

async function missingResolvesCleanly() {
  const client = await connect(stubOps({ getAction: () => undefined }));
  const res = await client.callTool({ name: "get_agent_action", arguments: { actionId: "nope" } });
  const body = parse(res);
  assert(body.ok === false && body.error === "action_not_found", "expected action_not_found");
  assert(res.isError === true, "expected isError flag");
  await client.close();
}

async function engineConflictBecomesToolError() {
  const client = await connect(stubOps({ approveAction: async () => { throw new Error("Agent action action_123 is executed, not pending_approval"); } }));
  const res = await client.callTool({ name: "approve_agent_action", arguments: { actionId: "action_123" } });
  const body = parse(res);
  assert(body.ok === false && body.error === "conflict", "expected conflict error");
  assert(res.isError === true, "expected isError flag");
  await client.close();
}

async function invalidArgsRejected() {
  const client = await connect(stubOps({ createPolicy: async () => { throw new Error("should not reach engine on invalid args"); } }));
  // maxAmount must be positive and agentId is required; the server validates
  // against the tool's input schema before the engine is ever called.
  const res: any = await client.callTool({ name: "create_agent_policy", arguments: { maxAmount: -5 } });
  assert(res.isError === true, "expected schema validation error result");
  assert(/validation|Invalid/i.test(res.content?.[0]?.text ?? ""), "expected validation error text");
  await client.close();
}

await ownerModeExposesAllTools();
await agentModeExposesOnlyProposeAndRead();
await agentModeBlocksAdminTools();
await agentModePinsAgentId();
await proposalRateLimitEnforced();
await createPolicyTool();
await proposeTransactionTool();
await recallFinancialContextTool();
await rejectedTransactionIsReported();
await approveRejectGetRevoke();
await missingResolvesCleanly();
await engineConflictBecomesToolError();
await invalidArgsRejected();

console.log("MCP server tests passed.");
