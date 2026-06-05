import "dotenv/config";
import os from "os";
import path from "path";

async function main() {
  process.env["LEDGER_ENABLE_PAYMENTS"] = "true";
  process.env["LEDGER_DB_PATH"] ??= path.join(os.tmpdir(), `ledger-approval-threshold-${Date.now()}.db`);

  const { getRuntimeConfig } = await import("./config.js");
  const { initDb } = await import("./db.js");
  const { createAgentPolicy, evaluateAgentTransaction, revokePolicy } = await import("./agent.js");

  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    throw new Error("Refusing to run live approval threshold smoke while LEDGER_MOCK=true");
  }

  initDb();

  const agentId = "approval-agent";
  const recipient = config.suiOwnerAddress;
  const policy = await createAgentPolicy({
    ownerAddress: config.suiOwnerAddress,
    agentId,
    counterparty: recipient,
    category: null,
    maxAmountNgn: 2_000,
    approvalThresholdNgn: 500,
    expiresAtMs: Date.now() + 30 * 60 * 1000,
  });

  let result: Awaited<ReturnType<typeof evaluateAgentTransaction>> | undefined;
  try {
    result = await evaluateAgentTransaction({
      ownerAddress: config.suiOwnerAddress,
      agentId,
      rawText: `${agentId} pay 0.000001 SUI to ${recipient} for approval smoke`,
    });

    if (result.log.status !== "pending_approval") {
      throw new Error(`Expected pending_approval, got ${result.log.status}: ${result.log.reason}`);
    }
    if (!result.log.onChainActionId || !result.log.onChainTxDigest) {
      throw new Error("Expected pending approval to be logged on-chain");
    }
    if (result.record) {
      throw new Error("Pending approval must not create a LedgerRecord before execution");
    }
  } finally {
    await revokePolicy(agentId).catch(() => undefined);
  }

  console.log(JSON.stringify({
    ok: true,
    policy: {
      policyId: policy.policyId,
      onChainPolicyId: policy.onChainPolicyId,
      approvalThresholdNgn: policy.approvalThresholdNgn,
    },
    pendingApproval: {
      status: result.log.status,
      reason: result.log.reason,
      actionId: result.log.actionId,
      auditActionObjectId: result.log.onChainActionId,
      auditTxDigest: result.log.onChainTxDigest,
      paymentTxDigest: result.log.txDigest === result.log.onChainTxDigest ? null : result.log.txDigest,
    },
  }, null, 2));
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
