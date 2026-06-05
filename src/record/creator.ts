import { storeBlob } from "../walrus/client.js";
import { mintLedgerRecord, type MintedRecord } from "../sui/client.js";
import type { ParsedRecord } from "../parsing/parser.js";
import { encrypt, resolveDataKeyring } from "../encryption.js";
import { insertRecord } from "../db.js";
import { getRuntimeConfig } from "../config.js";
import type { MintLedgerRecordArgs } from "../sui/client.js";
import { retry, type RetryOptions } from "../ops/retry.js";

export interface RecordInput {
  ownerAddress: string;
  rawText: string;
  parsed: ParsedRecord;
  evidenceBytes?: Uint8Array[];
  parentObjectId?: string;
  actorType?: "human" | "agent";
  actorId?: string;
  linkedPolicyId?: string;
  txDigest?: string;
  actionStatus?: string;
}

export interface CreatedRecord extends MintedRecord {
  blobId: string;
  contentHash: string;
  summary: string;
}

export interface CreateRecordDeps {
  storeBlob?: typeof storeBlob;
  mintLedgerRecord?: typeof mintLedgerRecord;
  retry?: Partial<RetryOptions>;
}

export async function createRecord(input: RecordInput, deps: CreateRecordDeps = {}): Promise<CreatedRecord> {
  const storeRecordBlob = deps.storeBlob ?? storeBlob;
  const mintRecord = deps.mintLedgerRecord ?? mintLedgerRecord;
  const retryOptions: RetryOptions = {
    maxAttempts: deps.retry?.maxAttempts ?? 3,
    baseDelayMs: deps.retry?.baseDelayMs ?? 500,
    sleep: deps.retry?.sleep,
    logger: deps.retry?.logger,
    shouldRetry: deps.retry?.shouldRetry,
  };
  const { suiPrivateKey } = getRuntimeConfig();
  const dataKeyring = resolveDataKeyring(suiPrivateKey);

  // Create the transaction payload
  const recordPayload = JSON.stringify({
    raw: input.rawText,
    parsed: input.parsed,
    createdAt: new Date().toISOString(),
    parentObjectId: input.parentObjectId ?? null,
    actorType: input.actorType ?? "human",
    actorId: input.actorId ?? null,
    linkedPolicyId: input.linkedPolicyId ?? null,
    txDigest: input.txDigest ?? null,
    actionStatus: input.actionStatus ?? null,
  });

  // Encrypt the payload using AES-256-GCM
  const encrypted = encrypt(recordPayload, dataKeyring);
  const encryptedBytes = new TextEncoder().encode(JSON.stringify(encrypted));

  // Store the encrypted payload on Walrus
  const { blobId, contentHash } = await retry(
    "record.primary_walrus_upload",
    () => storeRecordBlob(encryptedBytes),
    retryOptions,
  );

  // Store evidence blobs on Walrus (these can be stored directly or encrypted; let's encrypt if privateKey exists)
  const evidenceBlobIds: string[] = [];
  for (const evidenceBytes of input.evidenceBytes ?? []) {
    // Encrypt evidence if it's sensitive (e.g. receipt image)
    const encryptedEvidence = encrypt(Buffer.from(evidenceBytes).toString("base64"), dataKeyring);
    const encryptedEvidenceBytes = new TextEncoder().encode(JSON.stringify(encryptedEvidence));
    const { blobId: eid } = await retry(
      "record.evidence_walrus_upload",
      () => storeRecordBlob(encryptedEvidenceBytes),
      retryOptions,
    );
    evidenceBlobIds.push(eid);
  }

  // Mint the Sui record
  const actionStatus = (
    input.actionStatus === "approved" ||
    input.actionStatus === "rejected" ||
    input.actionStatus === "executed" ||
    input.actionStatus === "failed"
  ) ? input.actionStatus : undefined satisfies MintLedgerRecordArgs["actionStatus"] | undefined;

  const minted = await retry(
    "record.sui_mint",
    () => mintRecord({
      ownerAddress: input.ownerAddress,
      walrusBlobId: blobId,
      contentHash,
      recordType: input.parsed.recordType,
      evidenceBlobIds,
      sealed: true,
      actorType: input.actorType ?? "human",
      actorId: input.actorId,
      linkedPolicyId: input.linkedPolicyId,
      txDigest: input.txDigest,
      actionStatus,
    }),
    retryOptions,
  );

  // Cache record in local SQLite database for memory and analytics
  insertRecord({
    objectId: minted.objectId,
    walrusBlobId: blobId,
    contentHash,
    recordType: input.parsed.recordType,
    actorType: input.actorType ?? "human",
    actorId: input.actorId ?? null,
    amountNgn: input.parsed.amountNgn,
    amountMist: input.parsed.amountMist,
    currency: input.parsed.currency,
    counterparty: input.parsed.counterparty,
    recipientAddress: input.parsed.recipientAddress,
    purpose: input.parsed.purpose,
    createdAtMs: Date.now(),
    parentObjectId: input.parentObjectId ?? null,
    linkedPolicyId: input.linkedPolicyId ?? null,
    txDigest: input.txDigest ?? null,
  });

  return {
    ...minted,
    blobId,
    contentHash,
    summary: input.parsed.summary,
  };
}
