import { getRuntimeConfig } from "../config.js";
import { initDb, listProviderOffsets } from "../db.js";

export interface HealthCheckResult {
  ok: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

export interface LedgerHealth {
  ok: boolean;
  checkedAt: string;
  checks: {
    config: HealthCheckResult;
    database: HealthCheckResult;
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkConfig(): HealthCheckResult {
  try {
    const config = getRuntimeConfig();
    return {
      ok: true,
      details: {
        mode: config.ledgerMock ? "mock" : "live",
        network: config.suiNetwork,
        walrusProvider: config.walrusProvider,
        paymentsEnabled: config.paymentsEnabled,
        useV2Mint: config.useV2Mint,
        databasePath: config.databasePath ?? "default",
      },
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function checkDatabase(): HealthCheckResult {
  try {
    initDb();
    const offsetCount = listProviderOffsets().length;
    return {
      ok: true,
      details: { providerOffsetCount: offsetCount },
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function runHealthChecks(now = new Date()): Promise<LedgerHealth> {
  const checks = {
    config: checkConfig(),
    database: checkDatabase(),
  };

  return {
    ok: checks.config.ok && checks.database.ok,
    checkedAt: now.toISOString(),
    checks,
  };
}
