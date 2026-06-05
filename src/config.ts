import { secret } from "./secrets.js";

export type SuiNetwork = "testnet" | "mainnet";

export interface LedgerConfig {
  ledgerMock: boolean;
  ledgerBaseUrl: string;
  ledgerPackageId: string;
  suiNetwork: SuiNetwork;
  suiRpcUrl: string | null;
  suiRpcApiKey: string | null;
  suiRpcFallbackUrl: string | null;
  suiOwnerAddress: string;
  suiPrivateKey: string;
  walrusEpochs: number;
  databasePath: string | null;
  useV2Mint: boolean;
  walrusProvider: "sdk" | "cli";
  walrusBinaryPath: string;
  walrusContext: string;
  walrusSdkTimeoutMs: number;
  walrusUploadRelayUrl: string | null;
  walrusUploadRelayTipMaxMist: number | null;
  walrusSdkLogNodeErrors: boolean;
  paymentsEnabled: boolean;
  minSuiBalanceMist: number;
  agentSpendWindowMs: number;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function parsePositiveInteger(name: string, defaultValue: number): number {
  const raw = env(name);
  if (!raw) return defaultValue;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer; received "${raw}"`);
  }
  return parsed;
}

function parseNonNegativeInteger(name: string): number | null {
  const raw = env(name);
  if (!raw) return null;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer; received "${raw}"`);
  }
  return parsed;
}

export function isMockMode(): boolean {
  return process.env["LEDGER_MOCK"] === "true";
}

export function getOptionalConfig(): LedgerConfig {
  const network = (env("SUI_NETWORK") ?? "testnet") as SuiNetwork;
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`SUI_NETWORK must be "testnet" or "mainnet"; received "${network}"`);
  }

  const walrusEpochsRaw = env("WALRUS_EPOCHS") ?? "3";
  const walrusEpochs = Number.parseInt(walrusEpochsRaw, 10);
  if (!Number.isFinite(walrusEpochs) || walrusEpochs <= 0) {
    throw new Error(`WALRUS_EPOCHS must be a positive integer; received "${walrusEpochsRaw}"`);
  }

  const minSuiBalanceRaw = env("LEDGER_MIN_SUI_BALANCE_MIST") ?? "50000000";
  const minSuiBalanceMist = Number.parseInt(minSuiBalanceRaw, 10);
  if (!Number.isSafeInteger(minSuiBalanceMist) || minSuiBalanceMist < 0) {
    throw new Error(`LEDGER_MIN_SUI_BALANCE_MIST must be a non-negative safe integer; received "${minSuiBalanceRaw}"`);
  }

  const spendWindowRaw = env("LEDGER_AGENT_SPEND_WINDOW_MS") ?? "86400000";
  const agentSpendWindowMs = Number.parseInt(spendWindowRaw, 10);
  if (!Number.isSafeInteger(agentSpendWindowMs) || agentSpendWindowMs <= 0) {
    throw new Error(`LEDGER_AGENT_SPEND_WINDOW_MS must be a positive safe integer; received "${spendWindowRaw}"`);
  }

  const walrusSdkTimeoutMs = parsePositiveInteger("WALRUS_SDK_TIMEOUT_MS", 60_000);
  const walrusUploadRelayTipMaxMist = parseNonNegativeInteger("WALRUS_UPLOAD_RELAY_TIP_MAX_MIST");

  return {
    ledgerMock: isMockMode(),
    ledgerBaseUrl: env("LEDGER_BASE_URL") ?? "https://ledger.app",
    ledgerPackageId: env("LEDGER_PACKAGE_ID") ?? "",
    suiNetwork: network,
    suiRpcUrl: env("SUI_RPC_URL") ?? null,
    suiRpcApiKey: secret("SUI_RPC_API_KEY") ?? null,
    suiRpcFallbackUrl: env("SUI_RPC_FALLBACK_URL") ?? null,
    suiOwnerAddress: env("SUI_OWNER_ADDRESS") ?? "",
    suiPrivateKey: secret("SUI_PRIVATE_KEY") ?? "",
    walrusEpochs,
    databasePath: env("LEDGER_DB_PATH") ?? null,
    useV2Mint: process.env["LEDGER_USE_V2_MINT"] === "true",
    walrusProvider: env("WALRUS_PROVIDER") === "cli" ? "cli" : "sdk",
    walrusBinaryPath: env("WALRUS_BINARY_PATH") ?? "walrus",
    walrusContext: env("WALRUS_CONTEXT") ?? network,
    walrusSdkTimeoutMs,
    walrusUploadRelayUrl: env("WALRUS_UPLOAD_RELAY_URL") ?? null,
    walrusUploadRelayTipMaxMist,
    walrusSdkLogNodeErrors: process.env["WALRUS_SDK_LOG_NODE_ERRORS"] === "true",
    paymentsEnabled: process.env["LEDGER_ENABLE_PAYMENTS"] === "true",
    minSuiBalanceMist,
    agentSpendWindowMs,
  };
}

export function getRuntimeConfig(): LedgerConfig {
  const config = getOptionalConfig();
  const missing: string[] = [];

  if (!config.suiPrivateKey) missing.push("SUI_PRIVATE_KEY");
  if (!config.suiOwnerAddress) missing.push("SUI_OWNER_ADDRESS");
  if (!config.ledgerMock && !config.ledgerPackageId) missing.push("LEDGER_PACKAGE_ID");

  if (missing.length > 0) {
    throw new Error(`Missing required Ledger environment variables: ${missing.join(", ")}`);
  }

  return config;
}
