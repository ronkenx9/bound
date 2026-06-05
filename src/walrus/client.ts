import { SuiGrpcClient } from "@mysten/sui/grpc";
import { walrus } from "@mysten/walrus";
import { createHash } from "crypto";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getSigner } from "../sui/client.js";
import { getOptionalConfig, type LedgerConfig } from "../config.js";

const execFileAsync = promisify(execFile);

const GRPC_URLS: Record<string, string> = {
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
};

function buildClient() {
  const config = getOptionalConfig();
  const { suiNetwork } = config;
  const baseUrl = GRPC_URLS[suiNetwork];
  if (!baseUrl) throw new Error(`Unknown Sui network: ${suiNetwork}`);

  const onError = config.walrusSdkLogNodeErrors
    ? (error: Error) => console.warn(`[walrus:sdk] ${error.name}: ${error.message}`)
    : undefined;

  return new SuiGrpcClient({ network: suiNetwork, baseUrl }).$extend(
    walrus({
      storageNodeClientOptions: {
        timeout: config.walrusSdkTimeoutMs,
        onError,
      },
      uploadRelay: config.walrusUploadRelayUrl
        ? {
            host: config.walrusUploadRelayUrl,
            timeout: config.walrusSdkTimeoutMs,
            onError,
            sendTip: config.walrusUploadRelayTipMaxMist === null
              ? undefined
              : { max: config.walrusUploadRelayTipMaxMist },
          }
        : undefined,
    }),
  );
}

export interface StoredBlob {
  blobId: string;
  contentHash: string;
}

interface WalrusCliStoreResult {
  blobStoreResult?: {
    newlyCreated?: {
      blobObject?: {
        blobId?: string;
      };
    };
    alreadyCertified?: {
      blobId?: string;
    };
    markedInvalid?: {
      blobId?: string;
    };
  };
}

function extractCliBlobId(stdout: string): string {
  const parsed = JSON.parse(stdout) as WalrusCliStoreResult[];
  for (const item of parsed) {
    const blobId = item.blobStoreResult?.newlyCreated?.blobObject?.blobId
      ?? item.blobStoreResult?.alreadyCertified?.blobId
      ?? item.blobStoreResult?.markedInvalid?.blobId;
    if (blobId) return blobId;
  }
  throw new Error(`Walrus CLI store did not return a blobId: ${stdout}`);
}

async function storeBlobWithCli(data: Uint8Array, config: LedgerConfig): Promise<StoredBlob> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ledger-walrus-"));
  const filePath = path.join(tempDir, "payload.bin");
  try {
    await writeFile(filePath, data);
    const { stdout } = await execFileAsync(config.walrusBinaryPath, [
      "--json",
      "store",
      "--context",
      config.walrusContext,
      "--epochs",
      String(config.walrusEpochs),
      filePath,
    ], { maxBuffer: 10 * 1024 * 1024 });

    return {
      blobId: extractCliBlobId(stdout),
      contentHash: createHash("sha256").update(data).digest("hex"),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function fetchBlobWithCli(blobId: string, config: LedgerConfig): Promise<Uint8Array> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ledger-walrus-read-"));
  const filePath = path.join(tempDir, "payload.bin");
  try {
    await execFileAsync(config.walrusBinaryPath, [
      "read",
      "--context",
      config.walrusContext,
      "--out",
      filePath,
      blobId,
    ], { maxBuffer: 10 * 1024 * 1024 });
    return await readFile(filePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function storeBlob(data: Uint8Array, deletable = false): Promise<StoredBlob> {
  const config = getOptionalConfig();
  if (config.ledgerMock) {
    const contentHash = createHash("sha256").update(data).digest("hex");
    return {
      blobId: `mock-walrus-blob-id-${contentHash.slice(0, 10)}`,
      contentHash,
    };
  }

  if (config.walrusProvider === "cli") {
    return storeBlobWithCli(data, config);
  }

  const client = buildClient();
  const signer = getSigner();

  const { blobId } = await client.walrus.writeBlob({
    blob: data,
    deletable,
    epochs: config.walrusEpochs,
    signer,
  });

  const contentHash = createHash("sha256").update(data).digest("hex");

  return { blobId, contentHash };
}

export async function fetchBlob(blobId: string): Promise<Uint8Array> {
  const config = getOptionalConfig();
  if (config.walrusProvider === "cli") {
    return fetchBlobWithCli(blobId, config);
  }

  const client = buildClient();
  return client.walrus.readBlob({ blobId });
}

export function hashBytes(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
