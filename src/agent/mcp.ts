import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  isAgentConflict,
  serializeAction,
  serializePolicy,
  type AgentOps,
} from "./operations.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...payload }, null, 2) }] };
}

function fail(error: string, detail?: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error, ...(detail ? { detail } : {}) }, null, 2) }],
    isError: true,
  };
}

/** Runs an engine call, mapping known state-conflicts to a clean error result. */
async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (err) {
    if (isAgentConflict(err)) return fail("conflict", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Builds the Ledger MCP server over the given agent engine. Exposes the same
 * policy-enforced, on-chain-audited operations as the HTTP API as MCP tools,
 * so LLM agents get Ledger as a native tool and cannot move money outside the
 * owner's policies.
 */
export function createLedgerMcpServer(ops: AgentOps): McpServer {
  const server = new McpServer({ name: "ledger", version: "0.1.0" });

  server.registerTool(
    "create_agent_policy",
    {
      title: "Create agent policy",
      description:
        "Create a scoped spending policy for an agent. The agent may only transact within this policy. " +
        "maxAmount and approvalThreshold are in the policy's unit (NGN for naira policies, MIST for SUI; 1 SUI = 1e9 MIST).",
      inputSchema: {
        agentId: z.string().min(1).describe("Identifier for the agent this policy governs, e.g. 'fuel-agent'"),
        maxAmount: z.number().positive().describe("Spending cap per transaction"),
        counterparty: z.string().nullish().describe("Restrict payments to this counterparty (name or 0x address)"),
        category: z.string().nullish().describe("Restrict to this spending category, e.g. 'fuel'"),
        approvalThreshold: z.number().positive().nullish().describe("Amounts above this require human approval before execution"),
        expiresAtMs: z.number().positive().nullish().describe("Policy expiry as epoch milliseconds"),
      },
    },
    async args =>
      guard(async () => {
        const policy = await ops.createPolicy({
          agentId: args.agentId,
          maxAmount: args.maxAmount,
          counterparty: args.counterparty ?? null,
          category: args.category ?? null,
          approvalThreshold: args.approvalThreshold ?? null,
          expiresAtMs: args.expiresAtMs ?? null,
        });
        return ok({ policy: serializePolicy(policy) });
      }),
  );

  server.registerTool(
    "propose_agent_transaction",
    {
      title: "Propose agent transaction",
      description:
        "Propose a payment intent for policy evaluation. Returns the decision: approved, executed, rejected, " +
        "or pending_approval. The agent cannot move money outside an active policy — over-cap or out-of-policy " +
        "intents are rejected and logged on-chain.",
      inputSchema: {
        intent: z.string().min(1).describe("Natural-language payment intent, e.g. 'pay Emeka 0.5 SUI to 0x.. for fuel'"),
        agentId: z.string().nullish().describe("Identifier of the proposing agent; matched against active policies"),
      },
    },
    async args =>
      guard(async () => {
        const { log, record } = await ops.evaluateTransaction({ intent: args.intent, agentId: args.agentId ?? undefined });
        return ok({ action: serializeAction(log, record) });
      }),
  );

  server.registerTool(
    "approve_agent_action",
    {
      title: "Approve pending agent action",
      description: "Approve a pending_approval action, executing the payment and recording it on-chain.",
      inputSchema: {
        actionId: z.string().min(1).describe("The action id to approve"),
        approvedBy: z.string().nullish().describe("Who approved it (audit field); defaults to 'mcp'"),
      },
    },
    async args =>
      guard(async () => {
        const { log, record } = await ops.approveAction({ actionId: args.actionId, approvedBy: args.approvedBy ?? "mcp" });
        return ok({ action: serializeAction(log, record) });
      }),
  );

  server.registerTool(
    "reject_agent_action",
    {
      title: "Reject pending agent action",
      description: "Reject a pending_approval action; no payment is made and the rejection is logged on-chain.",
      inputSchema: {
        actionId: z.string().min(1).describe("The action id to reject"),
        rejectedBy: z.string().nullish().describe("Who rejected it (audit field); defaults to 'mcp'"),
        reason: z.string().nullish().describe("Optional rejection reason"),
      },
    },
    async args =>
      guard(async () => {
        const log = await ops.rejectAction({
          actionId: args.actionId,
          rejectedBy: args.rejectedBy ?? "mcp",
          reason: args.reason ?? undefined,
        });
        return ok({ action: serializeAction(log) });
      }),
  );

  server.registerTool(
    "get_agent_action",
    {
      title: "Get agent action",
      description: "Read the current status and audit fields of an agent action by id.",
      inputSchema: { actionId: z.string().min(1).describe("The action id to look up") },
    },
    async args =>
      guard(async () => {
        const log = ops.getAction(args.actionId);
        if (!log) return fail("action_not_found");
        return ok({ action: serializeAction(log) });
      }),
  );

  server.registerTool(
    "revoke_agent_policy",
    {
      title: "Revoke agent policy",
      description: "Revoke an active policy by policy id or agent id. Subsequent agent transactions under it are rejected.",
      inputSchema: { id: z.string().min(1).describe("Policy id or agent id to revoke") },
    },
    async args =>
      guard(async () => {
        const policy = await ops.revoke({ id: args.id });
        if (!policy) return fail("policy_not_found");
        return ok({ policy: serializePolicy(policy) });
      }),
  );

  return server;
}
