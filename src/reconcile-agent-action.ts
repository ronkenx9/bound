import "dotenv/config";
import { getRuntimeConfig } from "./config.js";
import { initDb } from "./db.js";
import { reconcileAgentActionRecord } from "./agent.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const actionId = arg("action-id");
  if (!actionId) {
    throw new Error("Usage: npm run reconcile:agent-action -- --action-id=<action_id>");
  }

  initDb();
  const config = getRuntimeConfig();
  const { log, record } = await reconcileAgentActionRecord({
    ownerAddress: config.suiOwnerAddress,
    actionId,
  });

  console.log(JSON.stringify({
    ok: true,
    action: {
      actionId: log.actionId,
      status: log.status,
      paymentTxDigest: log.txDigest,
      reconciledRecordObjectId: log.reconciledRecordObjectId,
      reconciledAtMs: log.reconciledAtMs,
    },
    record: {
      objectId: record.objectId,
      verifyUrl: record.verifyUrl,
      walrusBlobId: record.blobId,
      contentHash: record.contentHash,
    },
  }, null, 2));
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
