import "dotenv/config";
import { decrypt, resolveDataKeyring, type EncryptedPayload } from "./encryption.js";
import { getRuntimeConfig } from "./config.js";
import { fetchBlob } from "./walrus/client.js";
import { verifyLedgerRecord } from "./verify/service.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const objectId = arg("object-id");
  const shouldDecrypt = process.argv.includes("--decrypt");

  if (!objectId) {
    throw new Error("Usage: npm run verify:record -- --object-id=<sui_object_id> [--decrypt]");
  }

  const verification = await verifyLedgerRecord(objectId);
  const { record } = verification;

  const result: Record<string, unknown> = {
    ok: verification.ok,
    objectId: record.objectId,
    type: record.type,
    owner: record.owner,
    walrusBlobId: record.walrusBlobId,
    expectedContentHash: verification.expectedContentHash,
    actualContentHash: verification.actualContentHash,
    byteLength: verification.byteLength,
    recordType: record.recordType,
    createdAtMs: record.createdAtMs,
    sealed: record.sealed,
    evidenceBlobIds: record.evidenceBlobIds,
    actorType: record.actorType,
    actorId: record.actorId,
    txDigest: record.txDigest,
    linkedPolicyId: record.linkedPolicyId,
    actionStatus: record.actionStatus,
  };

  if (shouldDecrypt) {
    const config = getRuntimeConfig();
    const blobBytes = await fetchBlob(record.walrusBlobId);
    const encrypted = JSON.parse(new TextDecoder().decode(blobBytes)) as EncryptedPayload;
    result["plaintext"] = decrypt(encrypted, resolveDataKeyring(config.suiPrivateKey));
  }

  console.log(JSON.stringify(result, null, 2));
  if (!verification.ok) process.exit(2);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
