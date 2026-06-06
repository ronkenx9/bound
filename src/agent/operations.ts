import {
  approvePendingAgentAction,
  createAgentPolicy,
  evaluateAgentTransaction,
  rejectPendingAgentAction,
  revokePolicy,
} from "../agent.js";
import { getAgentActionLog, type AgentActionLog, type AgentPolicy } from "../db.js";
import { createRecord } from "../record/creator.js";

export type CreatedRecord = Awaited<ReturnType<typeof createRecord>>;

/**
 * The agent engine, bound to a single owner address, exposed as a small facade.
 * Both the HTTP API and the MCP server call through this so there is exactly
 * one definition of "what an agent can do" and how results are shaped.
 */
export interface AgentOps {
  ownerAddress: string;
  createPolicy(input: {
    agentId: string;
    counterparty: string | null;
    category: string | null;
    maxAmount: number;
    approvalThreshold: number | null;
    expiresAtMs: number | null;
  }): Promise<AgentPolicy>;
  evaluateTransaction(input: { intent: string; agentId?: string }): Promise<{ log: AgentActionLog; record?: CreatedRecord }>;
  approveAction(input: { actionId: string; approvedBy: string }): Promise<{ log: AgentActionLog; record?: CreatedRecord }>;
  rejectAction(input: { actionId: string; rejectedBy: string; reason?: string }): Promise<AgentActionLog>;
  revoke(input: { id: string }): Promise<AgentPolicy | undefined>;
  getAction(actionId: string): AgentActionLog | undefined;
}

export function createAgentOps(ownerAddress: string): AgentOps {
  return {
    ownerAddress,
    createPolicy: input =>
      createAgentPolicy({
        ownerAddress,
        agentId: input.agentId,
        counterparty: input.counterparty,
        category: input.category,
        maxAmountNgn: input.maxAmount,
        approvalThresholdNgn: input.approvalThreshold,
        expiresAtMs: input.expiresAtMs,
      }),
    evaluateTransaction: input => evaluateAgentTransaction({ ownerAddress, rawText: input.intent, agentId: input.agentId }),
    approveAction: input => approvePendingAgentAction({ ownerAddress, actionId: input.actionId, approvedBy: input.approvedBy }),
    rejectAction: input => rejectPendingAgentAction({ ownerAddress, actionId: input.actionId, rejectedBy: input.rejectedBy, reason: input.reason }),
    revoke: input => revokePolicy(input.id),
    getAction: actionId => getAgentActionLog(actionId),
  };
}

export function serializeAction(log: AgentActionLog, record?: CreatedRecord): Record<string, unknown> {
  return {
    actionId: log.actionId,
    status: log.status,
    reason: log.reason,
    policyId: log.policyId,
    agentId: log.agentId,
    currency: log.currency,
    amountNgn: log.amountNgn,
    amountMist: log.amountMist,
    counterparty: log.counterparty,
    recipientAddress: log.recipientAddress,
    paymentTxDigest: log.txDigest,
    onChainActionId: log.onChainActionId,
    onChainTxDigest: log.onChainTxDigest,
    approvedBy: log.approvedBy,
    balanceBeforeMist: log.balanceBeforeMist,
    balanceAfterMist: log.balanceAfterMist,
    recordObjectId: record?.objectId ?? log.reconciledRecordObjectId ?? null,
    verifyUrl: record?.verifyUrl ?? null,
    createdAtMs: log.createdAtMs,
  };
}

export function serializePolicy(policy: AgentPolicy): Record<string, unknown> {
  return {
    policyId: policy.policyId,
    onChainPolicyId: policy.onChainPolicyId,
    agentId: policy.agentId,
    counterparty: policy.counterparty,
    category: policy.category,
    maxAmount: policy.maxAmountNgn,
    approvalThreshold: policy.approvalThresholdNgn,
    expiresAtMs: policy.expiresAtMs,
    revokedAtMs: policy.revokedAtMs,
    createdAtMs: policy.createdAtMs,
  };
}

/**
 * Shared classifier: is this engine error a client-side conflict / business-rule
 * rejection (-> 409 / tool conflict) vs. an unexpected internal failure (-> 500)?
 * Kept in sync with the throw sites in agent.ts that represent caller/state errors.
 */
export function isAgentConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not pending_approval|No agent action found|No active policy|requires|not an executable|has no amount to execute|exceed rolling spend window|not executed|has no payment transaction digest|already reconciled|has no on-chain policy object/i.test(message);
}
