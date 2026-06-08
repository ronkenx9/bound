import crypto from "crypto";
import type { ParsedRecord } from "./parsing/parser.js";
import {
  findAgentActionByIdempotencyKey,
  findActivePolicy,
  getAgentActionLog,
  insertAgentActionLog,
  insertAgentPolicy,
  revokeAgentPolicy,
  sumExecutedAgentSpend,
  updateAgentActionAfterApproval,
  updateAgentActionOnChainId,
  updateAgentActionReconciledRecord,
  type AgentActionLog,
  type AgentPolicy,
} from "./db.js";
import { parseMessage } from "./parsing/parser.js";
import { createRecord } from "./record/creator.js";
import { getMemory, formatRecordMemory, type MemoryHit } from "./memory/memwal.js";
import {
  createAgentPolicyOnChain,
  executeSuiPayment,
  logAgentActionOnChain,
  revokeAgentPolicyOnChain,
} from "./sui/client.js";
import { getRuntimeConfig } from "./config.js";

export interface AgentPolicyDraft {
  ownerAddress: string;
  agentId: string;
  counterparty: string | null;
  category: string | null;
  maxAmountNgn: number;
  approvalThresholdNgn: number | null;
  expiresAtMs: number | null;
}

function parsePolicyAmount(rawAmount: string, suffix?: string): number {
  let amount = Number.parseFloat(rawAmount.replace(/,/g, ""));
  if (/^(k|thousand)$/i.test(suffix ?? "")) amount *= 1000;
  return amount;
}

function suiToMistForPolicy(rawAmount: string): number {
  const [wholeRaw, fractionalRaw = ""] = rawAmount.replace(/,/g, "").split(".");
  const whole = BigInt(wholeRaw || "0") * 1_000_000_000n;
  const fractional = BigInt(`${fractionalRaw}000000000`.slice(0, 9) || "0");
  const mist = whole + fractional;
  if (mist > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("SUI policy amount is too large for safe JavaScript integer handling");
  }
  return Number(mist);
}

function policyAmount(parsed: ParsedRecord): number | null {
  return parsed.currency === "SUI" ? parsed.amountMist : parsed.amountNgn;
}

function formatAmount(parsed: ParsedRecord): string {
  if (parsed.currency === "SUI" && parsed.amountMist !== null) {
    return `${parsed.amountMist} MIST`;
  }
  if (parsed.amountNgn !== null) return `N${parsed.amountNgn.toLocaleString("en-NG")}`;
  return "unknown amount";
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizedActionText(rawText: string): string {
  return rawText.trim().toLowerCase().replace(/\s+/g, " ");
}

function actionIdempotencyKey(args: {
  ownerAddress: string;
  agentId: string;
  rawText: string;
  counterparty: string | null;
  recipientAddress: string | null;
  currency: ParsedRecord["currency"];
  amount: number | null;
}): string {
  const material = [
    args.ownerAddress.toLowerCase(),
    args.agentId.toLowerCase(),
    normalizedActionText(args.rawText),
    args.counterparty?.toLowerCase() ?? "",
    args.recipientAddress?.toLowerCase() ?? "",
    args.currency,
    args.amount ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(material).digest("hex");
}

export function parsePolicyCommand(raw: string, ownerAddress: string): AgentPolicyDraft | null {
  if (!/\b(agent|policy|handle|allow)\b/i.test(raw) || !/\b(max|up to|limit)\b/i.test(raw)) {
    return null;
  }

  const suiAmountMatch = raw.match(/(?:max|up to|limit(?:ed)? to)?\s*([\d,]+(?:\.\d+)?)\s*SUI\b/i);
  const amountMatch = raw.match(/(?:max|up to|limit(?:ed)? to)?\s*(?:N|₦|NGN)?\s*([\d,]+)\s*(k|thousand)?/i);
  if (!suiAmountMatch?.[1] && !amountMatch?.[1]) return null;

  let maxAmountNgn = suiAmountMatch?.[1]
    ? suiToMistForPolicy(suiAmountMatch[1])
    : parsePolicyAmount(amountMatch![1]!, amountMatch?.[2]);

  const suiThresholdMatch = raw.match(/\b(?:approval|approve|manual|operator|confirm)\w*(?:\s+\w+){0,3}\s+(?:over|above|after|from)\s+([\d,]+(?:\.\d+)?)\s*SUI\b/i);
  const thresholdMatch = raw.match(/\b(?:approval|approve|manual|operator|confirm)\w*(?:\s+\w+){0,3}\s+(?:over|above|after|from)\s+(?:N|₦|NGN)?\s*([\d,]+)\s*(k|thousand)?\b/i);
  const approvalThresholdNgn = suiThresholdMatch?.[1]
    ? suiToMistForPolicy(suiThresholdMatch[1])
    : thresholdMatch?.[1]
      ? parsePolicyAmount(thresholdMatch[1], thresholdMatch[2])
      : null;

  const agentMatch = raw.match(/\b([a-zA-Z][\w-]*\s+agent|agent\s+[a-zA-Z][\w-]*)\b/i);
  const agentId = agentMatch?.[1]?.toLowerCase().replace(/\s+/g, "-") ?? "ledger-agent";

  const counterpartyMatch = raw.match(/\b(?:pay|to|for)\s+(0x[a-fA-F0-9]{40,64}|[A-Z][a-zA-Z0-9_-]+)/);
  const counterparty = counterpartyMatch?.[1] ?? null;

  const category = /\bfuel|generator\b/i.test(raw) ? "fuel" : null;
  const expiresAtMs = /\b(?:until sunday|this week)\b/i.test(raw)
    ? Date.now() + 7 * 24 * 60 * 60 * 1000
    : null;

  return {
    ownerAddress,
    agentId,
    counterparty,
    category,
    maxAmountNgn,
    approvalThresholdNgn,
    expiresAtMs,
  };
}

export async function createAgentPolicy(draft: AgentPolicyDraft): Promise<AgentPolicy> {
  const onChain = await createAgentPolicyOnChain({
    ownerAddress: draft.ownerAddress,
    agentId: draft.agentId,
    counterparty: draft.counterparty,
    category: draft.category,
    maxAmountNgn: draft.maxAmountNgn,
    approvalThresholdNgn: draft.approvalThresholdNgn,
    expiresAtMs: draft.expiresAtMs,
  });

  const policy: AgentPolicy = {
    policyId: newId("policy"),
    onChainPolicyId: onChain.policyObjectId,
    ownerAddress: draft.ownerAddress,
    agentId: draft.agentId,
    counterparty: draft.counterparty,
    category: draft.category,
    maxAmountNgn: draft.maxAmountNgn,
    approvalThresholdNgn: draft.approvalThresholdNgn,
    expiresAtMs: draft.expiresAtMs,
    revokedAtMs: null,
    createdAtMs: Date.now(),
  };

  insertAgentPolicy(policy);
  return policy;
}

export async function revokePolicy(agentIdOrPolicyId: string): Promise<AgentPolicy | undefined> {
  const policy = findActivePolicy({ agentIdOrPolicyId });
  if (!policy) return undefined;
  if (!policy.onChainPolicyId) {
    throw new Error(`Policy ${policy.policyId} has no on-chain policy object to revoke`);
  }
  await revokeAgentPolicyOnChain(policy.onChainPolicyId);
  return revokeAgentPolicy(agentIdOrPolicyId);
}

export async function evaluateAgentTransaction(args: {
  ownerAddress: string;
  rawText: string;
  agentId?: string;
}): Promise<{ log: AgentActionLog; record?: Awaited<ReturnType<typeof createRecord>>; memoryContext?: MemoryHit[] }> {
  const parsed = await parseMessage(args.rawText);
  const config = getRuntimeConfig();
  const agentId = args.agentId ?? "ledger-agent";
  const category = parsed.purpose && /\bfuel|generator\b/i.test(parsed.purpose) ? "fuel" : null;
  const amountForPolicy = policyAmount(parsed);
  const idempotencyKey = actionIdempotencyKey({
    ownerAddress: args.ownerAddress,
    agentId,
    rawText: args.rawText,
    counterparty: parsed.counterparty,
    recipientAddress: parsed.recipientAddress,
    currency: parsed.currency,
    amount: amountForPolicy,
  });
  const previousAction = findAgentActionByIdempotencyKey(idempotencyKey);
  const policy = findActivePolicy({
    agentIdOrPolicyId: agentId,
    counterparty: parsed.counterparty,
    category,
  }) ?? findActivePolicy({
    counterparty: parsed.counterparty,
    category,
  });

  // Recall prior financial context from Walrus Memory so the agent decides with
  // history, not in isolation. Fails open: no memory configured -> no context.
  const memory = getMemory();
  let memoryContext: MemoryHit[] = [];
  if (memory.enabled) {
    const query = parsed.counterparty
      ? `prior payments to ${parsed.counterparty}${category ? ` for ${category}` : ""}`
      : args.rawText;
    try {
      memoryContext = await memory.recall(query, { limit: 5 });
    } catch {
      memoryContext = [];
    }
  }

  let status: AgentActionLog["status"] = "approved";
  let reason = "Policy matched; action approved for execution.";

  if (!policy) {
    status = "rejected";
    reason = "No active policy allows this agent transaction.";
  } else if (previousAction) {
    status = "rejected";
    reason = `Duplicate agent action rejected by idempotency key; first action ${previousAction.actionId} was ${previousAction.status}.`;
  } else if (amountForPolicy === null) {
    status = "rejected";
    reason = "No amount was detected, so the policy cap could not be checked.";
  } else if (amountForPolicy > policy.maxAmountNgn) {
    status = "rejected";
    reason = `Amount ${formatAmount(parsed)} exceeds policy cap ${policy.maxAmountNgn.toLocaleString("en-NG")} ${parsed.currency === "SUI" ? "MIST" : "NGN"}.`;
  } else if (policy.approvalThresholdNgn !== null && amountForPolicy > policy.approvalThresholdNgn) {
    status = "pending_approval";
    reason = `Policy matched, but amount ${formatAmount(parsed)} exceeds approval threshold ${policy.approvalThresholdNgn.toLocaleString("en-NG")} ${parsed.currency === "SUI" ? "MIST" : "NGN"}; operator approval required before execution.`;
  } else if (policy && config.paymentsEnabled && parsed.currency === "SUI") {
    const windowSpent = sumExecutedAgentSpend({
      policyId: policy.policyId,
      currency: parsed.currency,
      sinceMs: Date.now() - config.agentSpendWindowMs,
    });
    if (windowSpent + amountForPolicy > policy.maxAmountNgn) {
      status = "rejected";
      reason = `Rolling spend window would exceed policy cap: spent ${windowSpent.toLocaleString("en-NG")} MIST, requested ${amountForPolicy.toLocaleString("en-NG")} MIST, cap ${policy.maxAmountNgn.toLocaleString("en-NG")} MIST.`;
    }
  } else if (config.paymentsEnabled && parsed.currency === "SUI" && !parsed.recipientAddress) {
    status = "rejected";
    reason = "SUI payment execution requires a recipient address.";
  }

  let paymentTxDigest: string | null = null;
  let balanceBeforeMist: number | null = null;
  let balanceAfterMist: number | null = null;
  if (status === "approved" && policy && config.paymentsEnabled && parsed.currency === "SUI") {
    if (!parsed.recipientAddress || parsed.amountMist === null) {
      status = "rejected";
      reason = "SUI payment execution requires recipientAddress and amountMist.";
    } else {
      try {
        const payment = await executeSuiPayment({
          ownerAddress: args.ownerAddress,
          recipientAddress: parsed.recipientAddress,
          amountMist: parsed.amountMist,
          minBalanceMist: config.minSuiBalanceMist,
        });
        paymentTxDigest = payment.txDigest;
        balanceBeforeMist = payment.balanceBeforeMist;
        balanceAfterMist = payment.balanceAfterMist;
        status = "executed";
        reason = `Policy matched; executed SUI payment ${payment.txDigest}.`;
      } catch (err) {
        status = "failed";
        reason = `Payment execution failed before transaction finality: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  const log: AgentActionLog = {
    actionId: newId("action"),
    onChainActionId: null,
    policyId: policy?.policyId ?? null,
    agentId,
    counterparty: parsed.counterparty,
    recipientAddress: parsed.recipientAddress,
    category,
    amountNgn: parsed.amountNgn,
    amountMist: parsed.amountMist,
    currency: parsed.currency,
    proposedText: args.rawText,
    status,
    reason,
    idempotencyKey,
    txDigest: paymentTxDigest,
    onChainTxDigest: null,
    approvalOnChainActionId: null,
    approvalOnChainTxDigest: null,
    approvedBy: null,
    approvedAtMs: null,
    balanceBeforeMist,
    balanceAfterMist,
    reconciledRecordObjectId: null,
    reconciledAtMs: null,
    createdAtMs: Date.now(),
  };
  insertAgentActionLog(log);

  const onChainAction = await logAgentActionOnChain({
    ownerAddress: args.ownerAddress,
    agentId,
    policyId: policy?.onChainPolicyId ?? policy?.policyId ?? null,
    proposedText: args.rawText,
    amountNgn: amountForPolicy,
    counterparty: parsed.counterparty,
    category,
    status: status === "pending_approval" ? "approved" : status,
    reason,
    txDigest: paymentTxDigest,
  });
  log.onChainActionId = onChainAction.actionObjectId;
  log.onChainTxDigest = onChainAction.txDigest;
  if (!log.txDigest) log.txDigest = onChainAction.txDigest;
  updateAgentActionOnChainId(log.actionId, onChainAction.actionObjectId, onChainAction.txDigest);

  let record: Awaited<ReturnType<typeof createRecord>> | undefined;
  if ((status === "approved" || status === "executed") && policy) {
    const agentParsed: ParsedRecord = {
      ...parsed,
      recordType: "instruction",
      summary: `[Agent action approved] ${parsed.summary}`,
    };
    record = await createRecord({
      ownerAddress: args.ownerAddress,
      rawText: args.rawText,
      parsed: agentParsed,
      actorType: "agent",
      actorId: agentId,
      linkedPolicyId: policy.onChainPolicyId ?? policy.policyId,
      txDigest: paymentTxDigest ?? undefined,
      actionStatus: paymentTxDigest ? "executed" : "approved",
    });
  }

  // Remember this outcome so future decisions can recall it. Fail open.
  if (memory.enabled) {
    try {
      await memory.remember(formatRecordMemory({
        recordType: parsed.recordType,
        amount: formatAmount(parsed),
        counterparty: parsed.counterparty,
        purpose: parsed.purpose,
        actorType: "agent",
        actorId: agentId,
        status: status.toUpperCase(),
        policyId: policy?.policyId ?? null,
        objectId: record?.objectId ?? null,
      }));
    } catch {
      // memory write is best-effort; never block the decision
    }
  }

  return { log, record, memoryContext };
}

export async function approvePendingAgentAction(args: {
  ownerAddress: string;
  actionId: string;
  approvedBy: string;
}): Promise<{ log: AgentActionLog; record?: Awaited<ReturnType<typeof createRecord>> }> {
  const existing = getAgentActionLog(args.actionId);
  if (!existing) {
    throw new Error(`No agent action found for ${args.actionId}`);
  }
  if (existing.status !== "pending_approval") {
    throw new Error(`Agent action ${args.actionId} is ${existing.status}, not pending_approval`);
  }

  const config = getRuntimeConfig();
  const parsed = await parseMessage(existing.proposedText);
  const amountForPolicy = policyAmount(parsed);
  const policy = existing.policyId ? findActivePolicy({ agentIdOrPolicyId: existing.policyId }) : undefined;
  if (!policy) {
    throw new Error(`No active policy found for pending action ${args.actionId}`);
  }
  if (amountForPolicy === null) {
    throw new Error(`Pending action ${args.actionId} has no amount to execute`);
  }
  if (parsed.currency !== "SUI" || !parsed.recipientAddress || parsed.amountMist === null) {
    throw new Error(`Pending action ${args.actionId} is not an executable SUI payment`);
  }

  const windowSpent = sumExecutedAgentSpend({
    policyId: policy.policyId,
    currency: parsed.currency,
    sinceMs: Date.now() - config.agentSpendWindowMs,
  });
  if (windowSpent + amountForPolicy > policy.maxAmountNgn) {
    throw new Error(
      `Approval would exceed rolling spend window: spent ${windowSpent.toLocaleString("en-NG")} MIST, requested ${amountForPolicy.toLocaleString("en-NG")} MIST, cap ${policy.maxAmountNgn.toLocaleString("en-NG")} MIST.`
    );
  }

  let payment: Awaited<ReturnType<typeof executeSuiPayment>>;
  try {
    payment = await executeSuiPayment({
      ownerAddress: args.ownerAddress,
      recipientAddress: parsed.recipientAddress,
      amountMist: parsed.amountMist,
      minBalanceMist: config.minSuiBalanceMist,
    });
  } catch (err) {
    const reason = `Operator ${args.approvedBy} approved pending action, but payment execution failed before transaction finality: ${err instanceof Error ? err.message : String(err)}`;
    const failedAudit = await logAgentActionOnChain({
      ownerAddress: args.ownerAddress,
      agentId: existing.agentId,
      policyId: policy.onChainPolicyId ?? policy.policyId,
      proposedText: existing.proposedText,
      amountNgn: amountForPolicy,
      counterparty: parsed.counterparty,
      category: existing.category,
      status: "failed",
      reason,
      txDigest: null,
    });
    const failed = updateAgentActionAfterApproval({
      actionId: existing.actionId,
      status: "failed",
      reason,
      txDigest: null,
      approvalOnChainActionId: failedAudit.actionObjectId,
      approvalOnChainTxDigest: failedAudit.txDigest,
      approvedBy: args.approvedBy,
      approvedAtMs: Date.now(),
      balanceBeforeMist: null,
      balanceAfterMist: null,
    });
    if (!failed) throw new Error(`Failed to update failed action ${existing.actionId}`);
    return { log: failed };
  }

  const reason = `Operator ${args.approvedBy} approved pending action; executed SUI payment ${payment.txDigest}.`;

  const approvalAudit = await logAgentActionOnChain({
    ownerAddress: args.ownerAddress,
    agentId: existing.agentId,
    policyId: policy.onChainPolicyId ?? policy.policyId,
    proposedText: existing.proposedText,
    amountNgn: amountForPolicy,
    counterparty: parsed.counterparty,
    category: existing.category,
    status: "executed",
    reason,
    txDigest: payment.txDigest,
  });

  const updated = updateAgentActionAfterApproval({
    actionId: existing.actionId,
    status: "executed",
    reason,
    txDigest: payment.txDigest,
    approvalOnChainActionId: approvalAudit.actionObjectId,
    approvalOnChainTxDigest: approvalAudit.txDigest,
    approvedBy: args.approvedBy,
    approvedAtMs: Date.now(),
    balanceBeforeMist: payment.balanceBeforeMist,
    balanceAfterMist: payment.balanceAfterMist,
  });
  if (!updated) throw new Error(`Failed to update approved action ${existing.actionId}`);

  const agentParsed: ParsedRecord = {
    ...parsed,
    recordType: "instruction",
    summary: `[Agent action approved] ${parsed.summary}`,
  };
  const record = await createRecord({
    ownerAddress: args.ownerAddress,
    rawText: existing.proposedText,
    parsed: agentParsed,
    actorType: "agent",
    actorId: existing.agentId,
    linkedPolicyId: policy.onChainPolicyId ?? policy.policyId,
    txDigest: payment.txDigest,
    actionStatus: "executed",
  });

  return { log: updated, record };
}

export async function rejectPendingAgentAction(args: {
  ownerAddress: string;
  actionId: string;
  rejectedBy: string;
  reason?: string;
}): Promise<AgentActionLog> {
  const existing = getAgentActionLog(args.actionId);
  if (!existing) {
    throw new Error(`No agent action found for ${args.actionId}`);
  }
  if (existing.status !== "pending_approval") {
    throw new Error(`Agent action ${args.actionId} is ${existing.status}, not pending_approval`);
  }

  const reason = `Operator ${args.rejectedBy} rejected pending action.${args.reason ? ` ${args.reason}` : ""}`;
  const approvalAudit = await logAgentActionOnChain({
    ownerAddress: args.ownerAddress,
    agentId: existing.agentId,
    policyId: existing.policyId,
    proposedText: existing.proposedText,
    amountNgn: existing.currency === "SUI" ? existing.amountMist : existing.amountNgn,
    counterparty: existing.counterparty,
    category: existing.category,
    status: "rejected",
    reason,
    txDigest: null,
  });
  const updated = updateAgentActionAfterApproval({
    actionId: existing.actionId,
    status: "rejected",
    reason,
    txDigest: null,
    approvalOnChainActionId: approvalAudit.actionObjectId,
    approvalOnChainTxDigest: approvalAudit.txDigest,
    approvedBy: args.rejectedBy,
    approvedAtMs: Date.now(),
    balanceBeforeMist: null,
    balanceAfterMist: null,
  });
  if (!updated) throw new Error(`Failed to reject pending action ${existing.actionId}`);
  return updated;
}

export async function reconcileAgentActionRecord(args: {
  ownerAddress: string;
  actionId: string;
}): Promise<{ log: AgentActionLog; record: Awaited<ReturnType<typeof createRecord>> }> {
  const existing = getAgentActionLog(args.actionId);
  if (!existing) {
    throw new Error(`No agent action found for ${args.actionId}`);
  }
  if (existing.status !== "executed") {
    throw new Error(`Agent action ${args.actionId} is ${existing.status}, not executed`);
  }
  if (!existing.txDigest) {
    throw new Error(`Executed agent action ${args.actionId} has no payment transaction digest`);
  }
  if (existing.reconciledRecordObjectId) {
    throw new Error(`Agent action ${args.actionId} already reconciled to ${existing.reconciledRecordObjectId}`);
  }

  const parsed = await parseMessage(existing.proposedText);
  const agentParsed: ParsedRecord = {
    ...parsed,
    recordType: "instruction",
    summary: `[Agent action reconciled] ${parsed.summary}`,
  };
  const policy = existing.policyId ? findActivePolicy({ agentIdOrPolicyId: existing.policyId }) : undefined;
  const record = await createRecord({
    ownerAddress: args.ownerAddress,
    rawText: existing.proposedText,
    parsed: agentParsed,
    actorType: "agent",
    actorId: existing.agentId,
    linkedPolicyId: policy?.onChainPolicyId ?? existing.policyId ?? undefined,
    txDigest: existing.txDigest,
    actionStatus: "executed",
  });

  const updated = updateAgentActionReconciledRecord({
    actionId: existing.actionId,
    reconciledRecordObjectId: record.objectId,
  });
  if (!updated) throw new Error(`Failed to mark action ${existing.actionId} reconciled`);
  return { log: updated, record };
}
