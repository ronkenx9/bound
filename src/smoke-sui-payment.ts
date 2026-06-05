import "dotenv/config";
import os from "os";
import path from "path";

async function main() {
  process.env["LEDGER_ENABLE_PAYMENTS"] = "true";
  process.env["LEDGER_DB_PATH"] ??= path.join(os.tmpdir(), `ledger-sui-payment-${Date.now()}.db`);

  const { getRuntimeConfig } = await import("./config.js");
  const { initDb } = await import("./db.js");
  const { createAgentPolicy, evaluateAgentTransaction, revokePolicy } = await import("./agent.js");
  const { getLedgerRecordObject } = await import("./sui/read.js");
  const { fetchBlob, hashBytes } = await import("./walrus/client.js");

  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    throw new Error("Refusing to run live SUI payment smoke while LEDGER_MOCK=true");
  }

  initDb();

  const agentId = "payment-agent";
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
      rawText: `${agentId} pay 0.000001 SUI to ${recipient} for smoke`,
    });

    if (result.log.status !== "executed") {
      throw new Error(`Expected executed action, got ${result.log.status}: ${result.log.reason}`);
    }
    if (!result.log.txDigest) {
      throw new Error("Expected executed action to keep the payment transaction digest");
    }
    if (!result.log.onChainActionId || !result.log.onChainTxDigest) {
      throw new Error("Expected executed action to have an on-chain audit log");
    }
    if (!result.record?.objectId) {
      throw new Error("Expected executed action to create a LedgerRecord");
    }

    const onChainRecord = await getLedgerRecordObject(result.record.objectId);
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
    },
    payment: {
      status: result.log.status,
      paymentTxDigest: result.log.txDigest,
      auditActionObjectId: result.log.onChainActionId,
      auditTxDigest: result.log.onChainTxDigest,
      recordObjectId: result.record?.objectId,
      recordVerifyUrl: result.record?.verifyUrl,
      walrusBlobId: result.record?.blobId,
      contentHash: result.record?.contentHash,
    },
  }, null, 2));
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
