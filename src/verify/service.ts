import type { LedgerRecordOnChain } from "../sui/read.js";
import { getLedgerRecordObject } from "../sui/read.js";
import { fetchBlob, hashBytes } from "../walrus/client.js";

export interface VerifyRecordResult {
  ok: boolean;
  record: LedgerRecordOnChain;
  expectedContentHash: string;
  actualContentHash: string;
  byteLength: number;
}

export async function verifyLedgerRecord(objectId: string): Promise<VerifyRecordResult> {
  const record = await getLedgerRecordObject(objectId);
  if (!record.walrusBlobId) {
    throw new Error(`LedgerRecord ${objectId} has no walrus_blob_id`);
  }

  const blobBytes = await fetchBlob(record.walrusBlobId);
  const actualContentHash = hashBytes(blobBytes);

  return {
    ok: actualContentHash === record.contentHash,
    record,
    expectedContentHash: record.contentHash,
    actualContentHash,
    byteLength: blobBytes.byteLength,
  };
}
