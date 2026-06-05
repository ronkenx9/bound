import "dotenv/config";
import os from "os";
import path from "path";

async function main() {
  process.env["LEDGER_ENABLE_PAYMENTS"] = "true";
  process.env["LEDGER_MIN_SUI_BALANCE_MIST"] = "2000000000";
  process.env["LEDGER_DB_PATH"] ??= path.join(os.tmpdir(), `ledger-payment-failure-${Date.now()}.db`);

  const { getRuntimeConfig } = await import("./config.js");
  const { initDb } = await import("./db.js");
  const { createAgentPolicy, evaluateAgentTransaction, revokePolicy } = await import("./agent.js");

  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    throw new Error("Refusing to run live payment failure smoke while LEDGER_MOCK=true");
  }

  initDb();

  const agentId = "failure-agent";
  const recipient = config.suiOwnerAddress;
  const policy = await createAgentPolicy({
    ownerAddress: config.suiOwnerAddress,
    agentId,
    counterparty: recipient,
    category: null,
    maxAmountNgn: 2_000,
    approvalThresholdNgn: null,
    expiresAtMs: Date.now() + 30 * 60 * 1000,
  });

  let result: Awaited<ReturnType<typeof evaluateAgentTransaction>> | undefined;
  try {
    result = await evaluateAgentTransaction({
      ownerAddress: config.suiOwnerAddress,
      agentId,
      rawText: `${agentId} pay 0.000001 SUI to ${recipient} for failure smoke`,
    });

    if (result.log.status !== "failed") {
      throw new Error(`Expected failed action, got ${result.log.status}: ${result.log.reason}`);
    }
    if (!/Insufficient SUI balance for guarded payment/.test(result.log.reason)) {
      throw new Error(`Unexpected failure reason: ${result.log.reason}`);
    }
    if (!result.log.onChainActionId || !result.log.onChainTxDigest) {
      throw new Error("Expected failed action to have an on-chain audit log");
    }
    if (result.record) {
      throw new Error("Failed payment must not create a LedgerRecord");
    }
  } finally {
    await revokePolicy(agentId).catch(() => undefined);
  }

  console.log(JSON.stringify({
    ok: true,
    policy: {
      policyId: policy.policyId,
      onChainPolicyId: policy.onChainPolicyId,
    },
    failed: {
      status: result.log.status,
      reason: result.log.reason,
      actionId: result.log.actionId,
      auditActionObjectId: result.log.onChainActionId,
      auditTxDigest: result.log.onChainTxDigest,
      paymentTxDigest: result.log.txDigest === result.log.onChainTxDigest ? null : result.log.txDigest,
      recordObjectId: null,
    },
  }, null, 2));
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
