import { type SuiObjectResponse } from "@mysten/sui/jsonRpc";
import { buildClient } from "./client.js";

export interface LedgerRecordOnChain {
  objectId: string;
  type: string;
  owner: string;
  walrusBlobId: string;
  contentHash: string;
  recordType: number;
  createdAtMs: number;
  evidenceBlobIds: string[];
  sealed: boolean;
  actorType: number | null;
  actorId: string | null;
  txDigest: string | null;
  linkedPolicyId: string | null;
  actionStatus: number | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bytesToString(value: unknown): string {
  if (Array.isArray(value)) return Buffer.from(value as number[]).toString("utf8");
  if (typeof value === "string") {
    try {
      return Buffer.from(value, "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return "";
}

function bytesToHex(value: unknown): string {
  if (Array.isArray(value)) return Buffer.from(value as number[]).toString("hex");
  if (typeof value === "string") {
    try {
      return Buffer.from(value, "base64").toString("hex");
    } catch {
      return "";
    }
  }
  return "";
}

function nestedBytesToStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(bytesToString).filter(Boolean);
}

function numberField(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10);
  return 0;
}

function boolField(value: unknown): boolean {
  return value === true;
}

export function parseRecordMetadataFields(fields: Record<string, unknown>): Pick<
  LedgerRecordOnChain,
  "actorType" | "actorId" | "txDigest" | "linkedPolicyId" | "actionStatus"
> {
  return {
    actorType: fields["actor_type"] == null ? null : numberField(fields["actor_type"]),
    actorId: fields["actor_id"] == null ? null : bytesToString(fields["actor_id"]),
    txDigest: fields["tx_digest"] == null ? null : bytesToString(fields["tx_digest"]),
    linkedPolicyId: fields["linked_policy_id"] == null ? null : bytesToString(fields["linked_policy_id"]),
    actionStatus: fields["action_status"] == null ? null : numberField(fields["action_status"]),
  };
}

async function getRecordMetadataFromMintTx(recordObjectId: string, previousTransaction?: string): Promise<ReturnType<typeof parseRecordMetadataFields> | null> {
  if (!previousTransaction) return null;

  const client = buildClient();
  const tx = await client.getTransactionBlock({
    digest: previousTransaction,
    options: { showObjectChanges: true },
  });
  const metadataChange = tx.objectChanges?.find(change =>
    change.type === "created" &&
    change.objectType?.endsWith("::record::RecordMetadata") &&
    "objectId" in change
  );
  const metadataObjectId = metadataChange && "objectId" in metadataChange ? metadataChange.objectId : null;
  if (!metadataObjectId) return null;

  const metadata = await client.getObject({
    id: metadataObjectId,
    options: {
      showContent: true,
      showType: true,
    },
  });
  if (metadata.error || !metadata.data?.content || metadata.data.content.dataType !== "moveObject") return null;
  if (!metadata.data.type?.endsWith("::record::RecordMetadata")) return null;

  const fields = metadata.data.content.fields as Record<string, unknown>;
  const recordId = typeof fields["record_id"] === "string" ? fields["record_id"] : "";
  if (recordId.toLowerCase() !== recordObjectId.toLowerCase()) return null;

  return parseRecordMetadataFields(fields);
}

export async function getLedgerRecordObject(objectId: string): Promise<LedgerRecordOnChain> {
  const client = buildClient();
  let response: SuiObjectResponse | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await client.getObject({
      id: objectId,
      options: {
        showContent: true,
        showOwner: true,
        showType: true,
        showPreviousTransaction: true,
      },
    });

    if (!response.error || response.error.code !== "notExists" || attempt === 5) break;
    await sleep(1000 * (attempt + 1));
  }

  if (!response) {
    throw new Error("Sui object lookup failed: no response");
  }

  if (response.error) {
    throw new Error(`Sui object lookup failed: ${JSON.stringify(response.error)}`);
  }

  const data = response.data;
  if (!data?.content || data.content.dataType !== "moveObject") {
    throw new Error(`Object ${objectId} is not a Move object`);
  }

  if (!data.type?.endsWith("::record::LedgerRecord")) {
    throw new Error(`Object ${objectId} is not a ledger::record::LedgerRecord; type=${data.type ?? "unknown"}`);
  }

  const fields = data.content.fields as Record<string, unknown>;
  const ownerValue = fields["owner"];
  const metadata = await getRecordMetadataFromMintTx(
    data.objectId,
    (data as { previousTransaction?: string }).previousTransaction,
  );

  return {
    objectId: data.objectId,
    type: data.type,
    owner: typeof ownerValue === "string" ? ownerValue : "",
    walrusBlobId: bytesToString(fields["walrus_blob_id"]),
    contentHash: bytesToHex(fields["content_hash"]),
    recordType: numberField(fields["record_type"]),
    createdAtMs: numberField(fields["created_at_ms"]),
    evidenceBlobIds: nestedBytesToStrings(fields["evidence_blob_ids"]),
    sealed: boolField(fields["sealed"]),
    actorType: metadata?.actorType ?? null,
    actorId: metadata?.actorId ?? null,
    txDigest: metadata?.txDigest ?? null,
    linkedPolicyId: metadata?.linkedPolicyId ?? null,
    actionStatus: metadata?.actionStatus ?? null,
  };
}
