import "dotenv/config";
import os from "os";
import path from "path";

async function main() {
  process.env["LEDGER_ENABLE_PAYMENTS"] = "true";
  process.env["LEDGER_DB_PATH"] ??= path.join(os.tmpdir(), `ledger-approval-execution-${Date.now()}.db`);

  const { getRuntimeConfig } = await import("./config.js");
  const { initDb } = await import("./db.js");
  const { approvePendingAgentAction, createAgentPolicy, evaluateAgentTransaction, revokePolicy } = await import("./agent.js");
  const { getLedgerRecordObject } = await import("./sui/read.js");
  const { fetchBlob, hashBytes } = await import("./walrus/client.js");

  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    throw new Error("Refusing to run live approval execution smoke while LEDGER_MOCK=true");
  }

  initDb();

  const agentId = "approval-exec-agent";
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

  let pending: Awaited<ReturnType<typeof evaluateAgentTransaction>> | undefined;
  let approved: Awaited<ReturnType<typeof approvePendingAgentAction>> | undefined;
  try {
    pending = await evaluateAgentTransaction({
      ownerAddress: config.suiOwnerAddress,
      agentId,
      rawText: `${agentId} pay 0.000001 SUI to ${recipient} for approval execution smoke`,
    });
    if (pending.log.status !== "pending_approval") {
      throw new Error(`Expected pending_approval before approval, got ${pending.log.status}: ${pending.log.reason}`);
    }
    if (pending.record) {
      throw new Error("Pending action must not create a LedgerRecord before approval");
    }

    approved = await approvePendingAgentAction({
      ownerAddress: config.suiOwnerAddress,
      actionId: pending.log.actionId,
      approvedBy: "smoke-operator",
    });
    if (approved.log.status !== "executed") {
      throw new Error(`Expected executed after approval, got ${approved.log.status}: ${approved.log.reason}`);
    }
    if (!approved.log.txDigest || !approved.log.approvalOnChainActionId || !approved.log.approvalOnChainTxDigest) {
      throw new Error("Approved action is missing payment or execution audit digests");
    }
    if (approved.log.balanceBeforeMist === null || approved.log.balanceAfterMist === null) {
      throw new Error("Approved action is missing before/after balances");
    }
    if (!approved.record?.objectId) {
      throw new Error("Approved action did not create a LedgerRecord");
    }

    const onChainRecord = await getLedgerRecordObject(approved.record.objectId);
    const blobBytes = await fetchBlob(onChainRecord.walrusBlobId);
    const actualHash = hashBytes(blobBytes);
    if (actualHash !== onChainRecord.contentHash) {
      throw new Error(`LedgerRecord content hash mismatch: ${actualHash} != ${onChainRecord.contentHash}`);
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
    pending: {
      actionId: pending.log.actionId,
      auditActionObjectId: pending.log.onChainActionId,
      auditTxDigest: pending.log.onChainTxDigest,
    },
    approved: {
      status: approved.log.status,
      paymentTxDigest: approved.log.txDigest,
      executionAuditActionObjectId: approved.log.approvalOnChainActionId,
      executionAuditTxDigest: approved.log.approvalOnChainTxDigest,
      balanceBeforeMist: approved.log.balanceBeforeMist,
      balanceAfterMist: approved.log.balanceAfterMist,
      recordObjectId: approved.record?.objectId,
      recordVerifyUrl: approved.record?.verifyUrl,
      walrusBlobId: approved.record?.blobId,
      contentHash: approved.record?.contentHash,
    },
  }, null, 2));
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
