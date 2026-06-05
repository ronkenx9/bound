import "dotenv/config";
import { getRuntimeConfig } from "./config.js";
import { initDb } from "./db.js";
import { createAgentPolicy, evaluateAgentTransaction, revokePolicy } from "./agent.js";

async function main() {
  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    throw new Error("Refusing to run live agent policy smoke while LEDGER_MOCK=true");
  }

  initDb();

  const policy = await createAgentPolicy({
    ownerAddress: config.suiOwnerAddress,
    agentId: "fuel-agent",
    counterparty: "Emeka",
    category: "fuel",
    maxAmountNgn: 70000,
    approvalThresholdNgn: null,
    expiresAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  const approved = await evaluateAgentTransaction({
    ownerAddress: config.suiOwnerAddress,
    agentId: "fuel-agent",
    rawText: "fuel agent invoice from Emeka for N62,000 fuel",
  });

  const rejected = await evaluateAgentTransaction({
    ownerAddress: config.suiOwnerAddress,
    agentId: "fuel-agent",
    rawText: "fuel agent invoice from Emeka for N120,000 fuel",
  });

  const revoked = await revokePolicy("fuel-agent");
  if (!revoked) throw new Error("Expected fuel-agent policy to revoke");

  const afterRevocation = await evaluateAgentTransaction({
    ownerAddress: config.suiOwnerAddress,
    agentId: "fuel-agent",
    rawText: "fuel agent invoice from Emeka for N40,000 fuel",
  });

  console.log(JSON.stringify({
    ok: true,
    policy: {
      policyId: policy.policyId,
      onChainPolicyId: policy.onChainPolicyId,
    },
    approved: {
      status: approved.log.status,
      onChainActionId: approved.log.onChainActionId,
      txDigest: approved.log.txDigest,
      recordObjectId: approved.record?.objectId,
      recordVerifyUrl: approved.record?.verifyUrl,
    },
    rejected: {
      status: rejected.log.status,
      reason: rejected.log.reason,
      onChainActionId: rejected.log.onChainActionId,
      txDigest: rejected.log.txDigest,
    },
    revoked: {
      policyId: revoked.policyId,
      onChainPolicyId: revoked.onChainPolicyId,
      revokedAtMs: revoked.revokedAtMs,
    },
    afterRevocation: {
      status: afterRevocation.log.status,
      reason: afterRevocation.log.reason,
      onChainActionId: afterRevocation.log.onChainActionId,
      txDigest: afterRevocation.log.txDigest,
    },
  }, null, 2));
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
