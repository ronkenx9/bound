process.env["LEDGER_MOCK"] = "true";
process.env["SUI_PRIVATE_KEY"] = "legacy-sui-secret";
process.env["SUI_OWNER_ADDRESS"] = "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba";
process.env["LEDGER_DB_PATH"] = ":memory:";
process.env["LEDGER_DATA_KEY_ID"] = "dek-create-record";
process.env["LEDGER_DATA_ENCRYPTION_KEY"] = "create-record-dedicated-key";
delete process.env["LEDGER_LEGACY_DATA_KEY"];

import { createHash } from "crypto";
import { decrypt, type EncryptedPayload, resolveDataKeyring } from "./encryption.js";
import { createLogger } from "./ops/logger.js";
import type { MintLedgerRecordArgs } from "./sui/client.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function decodeEncryptedUpload(data: Uint8Array) {
  const decoded = new TextDecoder().decode(data);
  return JSON.parse(decoded) as EncryptedPayload;
}

const { resetDbForTests, getRecord } = await import("./db.js");
const { createRecord } = await import("./record/creator.js");
const retryLogs: string[] = [];
const retryLogger = createLogger({ sink: line => retryLogs.push(line), alertSink: null });

const parsedPayment = {
  recordType: "payment_out" as const,
  amountNgn: null,
  amountMist: 1000,
  currency: "SUI" as const,
  counterparty: "supplier-wallet",
  recipientAddress: "0x1111111111111111111111111111111111111111",
  purpose: "supplier settlement",
  confidence: 0.98,
  summary: "Paid supplier wallet 0.000001 SUI",
};

resetDbForTests();

const uploads: Uint8Array[] = [];
const mintCalls: MintLedgerRecordArgs[] = [];
const ownerAddress = process.env["SUI_OWNER_ADDRESS"]!;

const created = await createRecord({
  ownerAddress,
  rawText: "agent paid 0.000001 SUI to 0x1111111111111111111111111111111111111111 for supplier settlement",
  parsed: parsedPayment,
  evidenceBytes: [new TextEncoder().encode("receipt bytes")],
  parentObjectId: "0xparent",
  actorType: "agent",
  actorId: "settlement-agent",
  linkedPolicyId: "policy-123",
  txDigest: "payment-tx-123",
  actionStatus: "executed",
}, {
  storeBlob: async (data) => {
    uploads.push(data);
    const contentHash = createHash("sha256").update(data).digest("hex");
    return {
      blobId: `test-blob-${uploads.length}`,
      contentHash,
    };
  },
  mintLedgerRecord: async (args) => {
    mintCalls.push(args);
    return {
      objectId: "0xcreated-record",
      txDigest: "mint-tx-123",
      verifyUrl: "https://ledger.test/verify/0xcreated-record",
    };
  },
});

assert(created.objectId === "0xcreated-record", "expected injected mint result object id");
assert(created.blobId === "test-blob-1", "expected primary upload blob id");
assert(uploads.length === 2, `expected primary payload and one evidence upload, got ${uploads.length}`);
assert(mintCalls.length === 1, `expected one mint call, got ${mintCalls.length}`);

const keyring = resolveDataKeyring(process.env["SUI_PRIVATE_KEY"]!);
const primaryPayload = decodeEncryptedUpload(uploads[0]!);
assert(primaryPayload.keyId === "dek-create-record", "expected primary payload to use active data key id");
const decryptedPrimary = JSON.parse(decrypt(primaryPayload, keyring)) as {
  raw: string;
  actorType: string;
  actorId: string;
  linkedPolicyId: string;
  txDigest: string;
  actionStatus: string;
  parentObjectId: string;
  parsed: { recordType: string; currency: string; amountMist: number };
};
assert(decryptedPrimary.raw.includes("agent paid"), "expected encrypted primary payload to preserve raw text");
assert(decryptedPrimary.actorType === "agent", "expected encrypted primary payload actor type");
assert(decryptedPrimary.actorId === "settlement-agent", "expected encrypted primary payload actor id");
assert(decryptedPrimary.linkedPolicyId === "policy-123", "expected encrypted primary payload linked policy id");
assert(decryptedPrimary.txDigest === "payment-tx-123", "expected encrypted primary payload tx digest");
assert(decryptedPrimary.actionStatus === "executed", "expected encrypted primary payload action status");
assert(decryptedPrimary.parentObjectId === "0xparent", "expected encrypted primary payload parent object id");
assert(decryptedPrimary.parsed.recordType === "payment_out", "expected encrypted primary payload parsed record type");
assert(decryptedPrimary.parsed.currency === "SUI", "expected encrypted primary payload currency");
assert(decryptedPrimary.parsed.amountMist === 1000, "expected encrypted primary payload amountMist");

const evidencePayload = decodeEncryptedUpload(uploads[1]!);
assert(evidencePayload.keyId === "dek-create-record", "expected evidence payload to use active data key id");
assert(decrypt(evidencePayload, keyring) === Buffer.from("receipt bytes").toString("base64"), "expected encrypted evidence payload");

const mintArgs = mintCalls[0]!;
assert(mintArgs.ownerAddress === ownerAddress, "expected mint owner address");
assert(mintArgs.walrusBlobId === "test-blob-1", "expected mint to use primary blob id");
assert(mintArgs.contentHash === createHash("sha256").update(uploads[0]!).digest("hex"), "expected mint content hash to match primary bytes");
assert(mintArgs.recordType === "payment_out", "expected mint record type");
assert(mintArgs.evidenceBlobIds?.[0] === "test-blob-2", "expected mint evidence blob id");
assert(mintArgs.actorType === "agent", "expected mint actor type");
assert(mintArgs.actorId === "settlement-agent", "expected mint actor id");
assert(mintArgs.linkedPolicyId === "policy-123", "expected mint linked policy id");
assert(mintArgs.txDigest === "payment-tx-123", "expected mint tx digest");
assert(mintArgs.actionStatus === "executed", "expected mint action status");

const cached = getRecord("0xcreated-record");
assert(cached, "expected created record cached in local DB");
assert(cached.walrusBlobId === "test-blob-1", "expected cached Walrus blob id");
assert(cached.contentHash === mintArgs.contentHash, "expected cached content hash");
assert(cached.actorType === "agent", "expected cached actor type");
assert(cached.actorId === "settlement-agent", "expected cached actor id");
assert(cached.amountMist === 1000, "expected cached amountMist");
assert(cached.currency === "SUI", "expected cached currency");
assert(cached.recipientAddress === "0x1111111111111111111111111111111111111111", "expected cached recipient address");
assert(cached.parentObjectId === "0xparent", "expected cached parent object id");
assert(cached.linkedPolicyId === "policy-123", "expected cached linked policy id");
assert(cached.txDigest === "payment-tx-123", "expected cached tx digest");

resetDbForTests();

let uploadAttempts = 0;
const retriedUploadRecord = await createRecord({
  ownerAddress,
  rawText: "agent paid 0.000001 SUI to supplier after transient upload failure",
  parsed: parsedPayment,
}, {
  storeBlob: async (data) => {
    uploadAttempts += 1;
    if (uploadAttempts === 1) {
      throw new Error("temporary Walrus upload failure");
    }
    return {
      blobId: "retried-upload-blob",
      contentHash: createHash("sha256").update(data).digest("hex"),
    };
  },
  mintLedgerRecord: async () => ({
    objectId: "0xretried-upload-record",
    txDigest: "mint-after-upload-retry",
    verifyUrl: "https://ledger.test/verify/0xretried-upload-record",
  }),
  retry: {
    maxAttempts: 2,
    baseDelayMs: 0,
    sleep: async () => {},
    logger: retryLogger,
  },
});
assert(uploadAttempts === 2, `expected upload retried once, got ${uploadAttempts} attempts`);
assert(retriedUploadRecord.objectId === "0xretried-upload-record", "expected record creation after upload retry");
assert(retryLogs.some(line => line.includes('"operation":"record.primary_walrus_upload"') && line.includes('"event":"retry_succeeded"')), "expected primary upload retry success log");

resetDbForTests();

let mintAttempts = 0;
const retriedMintRecord = await createRecord({
  ownerAddress,
  rawText: "agent paid 0.000001 SUI to supplier after transient mint failure",
  parsed: parsedPayment,
}, {
  storeBlob: async (data) => ({
    blobId: "mint-retry-blob",
    contentHash: createHash("sha256").update(data).digest("hex"),
  }),
  mintLedgerRecord: async () => {
    mintAttempts += 1;
    if (mintAttempts === 1) {
      throw new Error("temporary Sui mint failure");
    }
    return {
      objectId: "0xretried-mint-record",
      txDigest: "mint-after-mint-retry",
      verifyUrl: "https://ledger.test/verify/0xretried-mint-record",
    };
  },
  retry: {
    maxAttempts: 2,
    baseDelayMs: 0,
    sleep: async () => {},
    logger: retryLogger,
  },
});
assert(mintAttempts === 2, `expected mint retried once, got ${mintAttempts} attempts`);
assert(retriedMintRecord.objectId === "0xretried-mint-record", "expected record creation after mint retry");
assert(retryLogs.some(line => line.includes('"operation":"record.sui_mint"') && line.includes('"event":"retry_succeeded"')), "expected Sui mint retry success log");

console.log("Create record integration tests passed.");
