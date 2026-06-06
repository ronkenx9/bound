import { getJsonRpcFullnodeUrl, JsonRpcHTTPTransport, SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getOptionalConfig, getRuntimeConfig } from "../config.js";

/** Serializes calls to at most `maxPerSecond`. Returns a gate to await before each request. */
function makeThrottleGate(maxPerSecond: number): () => Promise<void> {
  const minInterval = Math.ceil(1000 / maxPerSecond);
  let lastCall = 0;
  let queue: Promise<void> = Promise.resolve();

  return () => {
    const ticket = queue.then(async () => {
      const now = Date.now();
      const wait = minInterval - (now - lastCall);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastCall = Date.now();
    });
    queue = ticket;
    return ticket;
  };
}

function isInfraFailureStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * A fetch that throttles and routes to `primaryUrl`, and on rate-limit / 5xx /
 * network failure transparently retries the same JSON-RPC request against
 * `fallbackUrl` (a public Sui fullnode). JSON-RPC application errors (e.g. 400
 * with an error body) are returned as-is for the caller to handle.
 */
function makeFailoverFetch(primaryUrl: string, fallbackUrl: string, maxPerSecond: number): typeof fetch {
  const gate = makeThrottleGate(maxPerSecond);

  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      await gate();
      const res = await fetch(primaryUrl, init);
      if (res.ok || !isInfraFailureStatus(res.status)) return res;
    } catch {
      // network-level failure on primary — fall through to fallback
    }
    return fetch(fallbackUrl, init);
  };
}

export function buildClient(): SuiJsonRpcClient {
  const config = getOptionalConfig();
  const publicUrl = getJsonRpcFullnodeUrl(config.suiNetwork);

  // No custom RPC: talk to the public fullnode directly (no throttle/failover needed).
  if (!config.suiRpcUrl) {
    return new SuiJsonRpcClient({ network: config.suiNetwork, url: publicUrl });
  }

  // Custom RPC: throttle + transparently fail over to the fallback node on
  // rate-limit/5xx/network errors. The API key header is added only if present,
  // so failover works for both keyed and keyless custom endpoints.
  return new SuiJsonRpcClient({
    network: config.suiNetwork,
    transport: new JsonRpcHTTPTransport({
      url: config.suiRpcUrl,
      ...(config.suiRpcApiKey ? { rpc: { headers: { "x-api-key": config.suiRpcApiKey } } } : {}),
      fetch: makeFailoverFetch(config.suiRpcUrl, config.suiRpcFallbackUrl ?? publicUrl, 2),
    }),
  });
}

export function getSigner(): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(getRuntimeConfig().suiPrivateKey);
}

export type RecordType = "payment_in" | "payment_out" | "instruction" | "evidence";

const RECORD_TYPE_MAP: Record<RecordType, number> = {
  payment_in: 0,
  payment_out: 1,
  instruction: 2,
  evidence: 3,
};

export interface MintLedgerRecordArgs {
  ownerAddress: string;
  walrusBlobId: string;
  contentHash: string;
  recordType: RecordType;
  evidenceBlobIds?: string[];
  sealed: boolean;
  actorType?: "human" | "agent";
  actorId?: string;
  txDigest?: string;
  linkedPolicyId?: string;
  actionStatus?: "none" | "approved" | "rejected" | "executed" | "failed";
}

export interface MintedRecord {
  objectId: string;
  txDigest: string;
  verifyUrl: string;
}

export interface CreatedAgentPolicy {
  policyObjectId: string;
  txDigest: string;
}

export interface LoggedAgentAction {
  actionObjectId: string;
  txDigest: string;
}

export interface ExecutedSuiPayment {
  txDigest: string;
  recipient: string;
  amountMist: number;
  balanceBeforeMist: number;
  balanceAfterMist: number;
}

export interface SuiBalance {
  totalBalanceMist: number;
}

function findCreatedObjectId(result: Awaited<ReturnType<SuiJsonRpcClient["signAndExecuteTransaction"]>>): string | null {
  const createdChange = result.objectChanges?.find(change =>
    change.type === "created" && change.objectType?.endsWith("::record::LedgerRecord")
  );
  if (createdChange && "objectId" in createdChange) return createdChange.objectId;

  const createdEffect = result.effects?.created?.[0]?.reference?.objectId;
  return createdEffect ?? null;
}

function findCreatedObjectIdByType(
  result: Awaited<ReturnType<SuiJsonRpcClient["signAndExecuteTransaction"]>>,
  typeSuffix: string,
): string | null {
  const createdChange = result.objectChanges?.find(change =>
    change.type === "created" && change.objectType?.endsWith(typeSuffix)
  );
  if (createdChange && "objectId" in createdChange) return createdChange.objectId;
  return null;
}

const ACTOR_TYPE_MAP: Record<NonNullable<MintLedgerRecordArgs["actorType"]>, number> = {
  human: 0,
  agent: 1,
};

const ACTION_STATUS_MAP: Record<NonNullable<MintLedgerRecordArgs["actionStatus"]>, number> = {
  none: 0,
  approved: 1,
  rejected: 2,
  executed: 3,
  failed: 4,
};

function bytes(value: string): number[] {
  return Array.from(Buffer.from(value, "utf8"));
}

function amountToU64(value: number | null | undefined): bigint {
  if (!value || value < 0) return 0n;
  return BigInt(Math.round(value));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isStaleObjectVersionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Transaction needs to be rebuilt because object .* version .* is unavailable/i.test(message);
}

/**
 * True when the error proves the transaction was rejected before execution
 * (validation / insufficient gas / dry-run abort), so it definitely did not
 * land on-chain and there is nothing to recover by digest.
 */
export function isPreExecutionRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /lower than the needed amount|[Ii]nsufficient (gas|balance|coin)|GasBalanceTooLow|Balance of gas object|No valid gas coins|InsufficientGas|Could not resolve gas|ObjectNotFound|equivocat/i.test(message);
}

type ExecResult = Awaited<ReturnType<SuiJsonRpcClient["signAndExecuteTransaction"]>>;

/**
 * After an ambiguous submission failure (network drop, timeout, gateway error),
 * a transaction with a known digest may still have landed on-chain. Poll for it
 * before treating the action as failed. Returns the successful result if found,
 * or null if the transaction is confirmed absent after the polling window.
 */
export interface DigestRecoverable {
  getTransactionBlock(input: {
    digest: string;
    options?: { showEffects?: boolean; showObjectChanges?: boolean };
  }): Promise<ExecResult>;
}

export async function recoverByDigest(
  client: DigestRecoverable,
  digest: string,
  opts: { attempts?: number; baseIntervalMs?: number } = {},
): Promise<ExecResult | null> {
  const attempts = opts.attempts ?? 5;
  const baseIntervalMs = opts.baseIntervalMs ?? 1000;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const tx = await client.getTransactionBlock({
        digest,
        options: { showEffects: true, showObjectChanges: true },
      });
      if (tx.effects?.status.status === "success") return tx;
      if (tx.effects?.status.status === "failure") return null;
    } catch {
      // not yet indexed / not found — keep polling
    }
    await sleep(baseIntervalMs * (i + 1));
  }
  return null;
}

async function signAndExecute(buildTx: () => Transaction) {
  const client = buildClient();
  const signer = getSigner();
  const config = getOptionalConfig();
  let lastErr: unknown;

  let gasPrice: bigint | null = null;
  if (config.suiRpcUrl) {
    const raw = await client.getReferenceGasPrice({});
    gasPrice = BigInt(raw);
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Build and sign once per attempt so the submitted bytes and the digest we
    // recover against are identical.
    let bytes: Uint8Array;
    let digest: string;
    let signature: string;
    try {
      const tx = buildTx();
      tx.setSenderIfNotSet(signer.toSuiAddress());
      if (gasPrice !== null) {
        tx.setGasPrice(gasPrice);
        tx.setGasBudget(50_000_000);
      }
      bytes = await tx.build({ client });
      digest = await tx.getDigest({ client });
      signature = (await signer.signTransaction(bytes)).signature;
    } catch (err) {
      // Failures here are pre-submission: nothing was sent, so it is always
      // safe to retry on stale gas or surface the error otherwise.
      lastErr = err;
      if (isStaleObjectVersionError(err) && attempt < 3) {
        await sleep(750 * (attempt + 1));
        continue;
      }
      break;
    }

    try {
      const result = await client.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: { showEffects: true, showObjectChanges: true },
      });

      if (result.effects?.status.status !== "success") {
        throw new Error(`Transaction failed: ${result.effects?.status.error ?? result.digest}`);
      }
      return result;
    } catch (err) {
      lastErr = err;
      // If the error proves the tx never executed (insufficient gas, validation
      // rejection), skip digest recovery — there is nothing on-chain to find.
      if (isPreExecutionRejection(err)) break;
      // Otherwise the tx was submitted and may have executed despite this error.
      // Confirm on-chain by digest before retrying or failing.
      const recovered = await recoverByDigest(client, digest);
      if (recovered) return recovered;
      if (isStaleObjectVersionError(err) && attempt < 3) {
        await sleep(750 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  throw lastErr;
}

export async function getSuiBalanceMist(ownerAddress: string): Promise<SuiBalance> {
  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    return { totalBalanceMist: 1_000_000_000 };
  }

  const client = buildClient();
  const balance = await client.getBalance({ owner: ownerAddress, coinType: "0x2::sui::SUI" });
  const total = BigInt(balance.totalBalance);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("SUI balance is too large for safe JavaScript integer handling");
  }
  return { totalBalanceMist: Number(total) };
}

export async function mintLedgerRecord(args: MintLedgerRecordArgs): Promise<MintedRecord> {
  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    const mockObjectId = `0xmock-object-id-${Math.floor(Math.random() * 1000000)}`;
    return {
      objectId: mockObjectId,
      txDigest: `0xmock-tx-digest-${Math.floor(Math.random() * 1000000)}`,
      verifyUrl: `https://ledger.app/verify/${mockObjectId}`,
    };
  }

  const baseArgs = [
    args.ownerAddress,
    bytes(args.walrusBlobId),
    Array.from(Buffer.from(args.contentHash, "hex")),
    RECORD_TYPE_MAP[args.recordType],
    (args.evidenceBlobIds ?? []).map(bytes),
    args.sealed,
  ];

  const result = await signAndExecute(() => {
    const tx = new Transaction();
    const moveBaseArgs = [
      tx.pure.address(baseArgs[0] as string),
      tx.pure.vector("u8", baseArgs[1] as number[]),
      tx.pure.vector("u8", baseArgs[2] as number[]),
      tx.pure.u8(baseArgs[3] as number),
      tx.pure.vector("vector<u8>", baseArgs[4] as number[][]),
      tx.pure.bool(baseArgs[5] as boolean),
    ];

    if (config.useV2Mint) {
      tx.moveCall({
        target: `${config.ledgerPackageId}::record::mint_with_actor`,
        arguments: [
          ...moveBaseArgs,
          tx.pure.u8(ACTOR_TYPE_MAP[args.actorType ?? "human"]),
          tx.pure.vector("u8", bytes(args.actorId ?? "")),
          tx.pure.vector("u8", bytes(args.txDigest ?? "")),
          tx.pure.vector("u8", bytes(args.linkedPolicyId ?? "")),
          tx.pure.u8(ACTION_STATUS_MAP[args.actionStatus ?? "none"]),
          tx.object("0x6"),
        ],
      });
    } else {
      tx.moveCall({
        target: `${config.ledgerPackageId}::record::mint`,
        arguments: [
          ...moveBaseArgs,
          tx.object("0x6"),
        ],
      });
    }

    return tx;
  });

  const createdObjectId = findCreatedObjectId(result);

  if (!createdObjectId) {
    throw new Error(`Mint failed: no created LedgerRecord. Digest: ${result.digest}`);
  }

  return {
    objectId: createdObjectId,
    txDigest: result.digest,
    verifyUrl: `${config.ledgerBaseUrl}/verify/${createdObjectId}`,
  };
}

export async function createAgentPolicyOnChain(args: {
  ownerAddress: string;
  agentId: string;
  counterparty: string | null;
  category: string | null;
  maxAmountNgn: number;
  approvalThresholdNgn: number | null;
  allowedToken?: string;
  expiresAtMs: number | null;
}): Promise<CreatedAgentPolicy> {
  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    return {
      policyObjectId: `0xmock-policy-id-${Math.floor(Math.random() * 1000000)}`,
      txDigest: `0xmock-policy-tx-${Math.floor(Math.random() * 1000000)}`,
    };
  }

  const result = await signAndExecute(() => {
    const tx = new Transaction();
    tx.moveCall({
      target: `${config.ledgerPackageId}::record::create_agent_policy`,
      arguments: [
        tx.pure.address(args.ownerAddress),
        tx.pure.vector("u8", bytes(args.agentId)),
        tx.pure.vector("u8", bytes(args.counterparty ?? "")),
        tx.pure.vector("u8", bytes(args.category ?? "")),
        tx.pure.u64(amountToU64(args.maxAmountNgn)),
        tx.pure.u64(amountToU64(args.approvalThresholdNgn)),
        tx.pure.vector("u8", bytes(args.allowedToken ?? "NGN")),
        tx.pure.u64(BigInt(args.expiresAtMs ?? 0)),
        tx.object("0x6"),
      ],
    });
    return tx;
  });
  const policyObjectId = findCreatedObjectIdByType(result, "::record::AgentPolicy");
  if (!policyObjectId) {
    throw new Error(`Policy creation failed: no AgentPolicy object. Digest: ${result.digest}`);
  }

  return { policyObjectId, txDigest: result.digest };
}

export async function revokeAgentPolicyOnChain(policyObjectId: string): Promise<{ txDigest: string }> {
  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    return { txDigest: `0xmock-revoke-tx-${Math.floor(Math.random() * 1000000)}` };
  }

  const result = await signAndExecute(() => {
    const tx = new Transaction();
    tx.moveCall({
      target: `${config.ledgerPackageId}::record::revoke_agent_policy`,
      arguments: [
        tx.object(policyObjectId),
        tx.object("0x6"),
      ],
    });
    return tx;
  });
  return { txDigest: result.digest };
}

export async function logAgentActionOnChain(args: {
  ownerAddress: string;
  agentId: string;
  policyId: string | null;
  proposedText: string;
  amountNgn: number | null;
  counterparty: string | null;
  category: string | null;
  status: "approved" | "rejected" | "executed" | "failed";
  reason: string;
  txDigest?: string | null;
}): Promise<LoggedAgentAction> {
  const config = getRuntimeConfig();
  if (config.ledgerMock) {
    return {
      actionObjectId: `0xmock-action-id-${Math.floor(Math.random() * 1000000)}`,
      txDigest: `0xmock-action-tx-${Math.floor(Math.random() * 1000000)}`,
    };
  }

  const result = await signAndExecute(() => {
    const tx = new Transaction();
    tx.moveCall({
      target: `${config.ledgerPackageId}::record::log_agent_action`,
      arguments: [
        tx.pure.address(args.ownerAddress),
        tx.pure.vector("u8", bytes(args.agentId)),
        tx.pure.vector("u8", bytes(args.policyId ?? "")),
        tx.pure.vector("u8", bytes(args.proposedText)),
        tx.pure.u64(amountToU64(args.amountNgn)),
        tx.pure.vector("u8", bytes(args.counterparty ?? "")),
        tx.pure.vector("u8", bytes(args.category ?? "")),
        tx.pure.u8(ACTION_STATUS_MAP[args.status]),
        tx.pure.vector("u8", bytes(args.reason)),
        tx.pure.vector("u8", bytes(args.txDigest ?? "")),
        tx.object("0x6"),
      ],
    });
    return tx;
  });
  const actionObjectId = findCreatedObjectIdByType(result, "::record::AgentActionLog");
  if (!actionObjectId) {
    throw new Error(`Action log failed: no AgentActionLog object. Digest: ${result.digest}`);
  }

  return { actionObjectId, txDigest: result.digest };
}

export async function executeSuiPayment(args: {
  ownerAddress: string;
  recipientAddress: string;
  amountMist: number;
  minBalanceMist: number;
  estimatedGasMist?: number;
}): Promise<ExecutedSuiPayment> {
  const config = getRuntimeConfig();
  if (!config.paymentsEnabled) {
    throw new Error("Payment execution is disabled. Set LEDGER_ENABLE_PAYMENTS=true to enable.");
  }

  if (!Number.isSafeInteger(args.amountMist) || args.amountMist <= 0) {
    throw new Error(`Invalid payment amountMist: ${args.amountMist}`);
  }

  if (!Number.isSafeInteger(args.minBalanceMist) || args.minBalanceMist < 0) {
    throw new Error(`Invalid payment minBalanceMist: ${args.minBalanceMist}`);
  }

  const estimatedGasMist = args.estimatedGasMist ?? 10_000_000;
  if (!Number.isSafeInteger(estimatedGasMist) || estimatedGasMist < 0) {
    throw new Error(`Invalid estimatedGasMist: ${estimatedGasMist}`);
  }

  const { totalBalanceMist } = await getSuiBalanceMist(args.ownerAddress);
  const requiredMist = args.amountMist + args.minBalanceMist + estimatedGasMist;
  if (totalBalanceMist < requiredMist) {
    throw new Error(
      `Insufficient SUI balance for guarded payment: balance=${totalBalanceMist} MIST, required=${requiredMist} MIST`
    );
  }

  if (config.ledgerMock) {
    return {
      txDigest: `0xmock-payment-tx-${Math.floor(Math.random() * 1000000)}`,
      recipient: args.recipientAddress,
      amountMist: args.amountMist,
      balanceBeforeMist: totalBalanceMist,
      balanceAfterMist: totalBalanceMist - args.amountMist,
    };
  }

  const result = await signAndExecute(() => {
    const tx = new Transaction();
    const coin = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(args.amountMist))]);
    tx.transferObjects([coin], tx.pure.address(args.recipientAddress));
    return tx;
  });

  return {
    txDigest: result.digest,
    recipient: args.recipientAddress,
    amountMist: args.amountMist,
    balanceBeforeMist: totalBalanceMist,
    balanceAfterMist: (await getSuiBalanceMist(args.ownerAddress)).totalBalanceMist,
  };
}
