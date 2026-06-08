import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  isAgentConflict,
  serializeAction,
  serializeMemory,
  serializePolicy,
  type AgentOps,
} from "./operations.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * Trust tiers. Over stdio the trust boundary is "whoever launched the process",
 * and the server signs with the owner's key — so the surface must match who is
 * on the other end:
 *  - "agent": for an (untrusted) agent. Exposes only propose + read. The agent
 *    cannot create/approve/revoke policies, so it can never widen its own
 *    spending authority — it lives strictly within owner-defined policies.
 *  - "owner": the owner's admin console. Exposes every tool. Run only by the owner.
 */
export type McpMode = "agent" | "owner";

export interface McpServerOptions {
  mode?: McpMode;
  /** In agent mode, pins the agentId so a caller cannot impersonate another agent's policy. */
  agentId?: string | null;
  /** Min milliseconds between gas-costing proposals (each writes an on-chain audit log). */
  minProposalIntervalMs?: number;
}

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
 * Builds the Ledger MCP server over the given agent engine. Tool exposure is
 * gated by mode (see McpMode): "agent" (default) exposes only propose + read so
 * an agent can never widen its own authority; "owner" exposes the full admin
 * surface. The agent can never move money outside owner-defined policies.
 */
export function createLedgerMcpServer(ops: AgentOps, options: McpServerOptions = {}): McpServer {
  const mode: McpMode = options.mode ?? "agent";
  const pinnedAgentId = options.agentId ?? null;
  const minProposalIntervalMs = options.minProposalIntervalMs ?? 0;
  const server = new McpServer({ name: "ledger", version: "0.1.0" });

  // Per-process throttle on the only gas-costing agent tool: every proposal
  // writes an on-chain audit log even when rejected, so an unbounded loop could
  // otherwise drain the owner's gas wallet.
  let lastProposalMs = 0;

  // ---- Agent-facing tools (available in every mode) ----

  server.registerTool(
    "propose_agent_transaction",
    {
      title: "Propose agent transaction",
      description:
        "Propose a payment intent for policy evaluation. Returns the decision: approved, executed, rejected, " +
        "or pending_approval. The agent cannot move money outside an active policy — over-cap or out-of-policy " +
        "intents are rejected and logged on-chain.",
      inputSchema: {
        intent: z.string().min(1).max(2000).describe("Natural-language payment intent, e.g. 'pay Emeka 0.5 SUI to 0x.. for fuel'"),
        ...(pinnedAgentId
          ? {}
          : { agentId: z.string().min(1).nullish().describe("Identifier of the proposing agent; matched against active policies") }),
      },
    },
    async (args: { intent: string; agentId?: string | null }) =>
      guard(async () => {
        if (minProposalIntervalMs > 0) {
          const now = Date.now();
          if (now - lastProposalMs < minProposalIntervalMs) {
            return fail("rate_limited", `Wait ${Math.ceil((minProposalIntervalMs - (now - lastProposalMs)) / 1000)}s before the next proposal`);
          }
          lastProposalMs = now;
        }
        const agentId = pinnedAgentId ?? args.agentId ?? undefined;
        const { log, record, memoryContext } = await ops.evaluateTransaction({ intent: args.intent, agentId });
        return ok({ action: serializeAction(log, record), memory: serializeMemory(memoryContext ?? []) });
      }),
  );

  server.registerTool(
    "recall_financial_context",
    {
      title: "Recall financial context",
      description:
        "Read-only semantic recall over Bound's Walrus Memory. Use before proposing a transaction to check prior payments, duplicates, vendor history, or spend context.",
      inputSchema: {
        query: z.string().min(1).max(2000).describe("Natural-language memory query, e.g. 'have I paid Emeka for fuel this week?'"),
        limit: z.number().int().positive().max(20).nullish().describe("Maximum number of memories to return"),
      },
    },
    async (args: { query: string; limit?: number | null }) =>
      guard(async () => {
        const hits = await ops.recall({ query: args.query, limit: args.limit ?? undefined });
        return ok({ memoryEnabled: ops.memoryEnabled(), memory: serializeMemory(hits) });
      }),
  );

  server.registerTool(
    "get_agent_action",
    {
      title: "Get agent action",
      description: "Read the current status and audit fields of an agent action by id.",
      inputSchema: { actionId: z.string().min(1).describe("The action id to look up") },
    },
    async (args: { actionId: string }) =>
      guard(async () => {
        const log = ops.getAction(args.actionId);
        if (!log) return fail("action_not_found");
        return ok({ action: serializeAction(log) });
      }),
  );

  // Agent mode stops here: no policy creation, approval, or revocation.
  if (mode === "agent") return server;

  // ---- Owner-only admin tools ----

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
