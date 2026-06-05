import "dotenv/config";
import { getRuntimeConfig } from "./config.js";
import { parseMessage } from "./parsing/parser.js";
import { createRecord } from "./record/creator.js";

async function main() {
  const config = getRuntimeConfig();

  if (config.ledgerMock) {
    throw new Error("Refusing to run testnet smoke while LEDGER_MOCK=true");
  }

  if (config.suiNetwork !== "testnet") {
    throw new Error(`Smoke test must run on Sui testnet; current SUI_NETWORK=${config.suiNetwork}`);
  }

  const rawText = `Ledger smoke test payment N1 to TestVendor for integration check ${new Date().toISOString()}`;
  const parsed = await parseMessage(rawText);
  const record = await createRecord({
    ownerAddress: config.suiOwnerAddress,
    rawText,
    parsed,
  });

  console.log(JSON.stringify({
    ok: true,
    objectId: record.objectId,
    txDigest: record.txDigest,
    blobId: record.blobId,
    contentHash: record.contentHash,
    verifyUrl: record.verifyUrl,
  }, null, 2));
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
