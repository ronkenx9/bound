import { existsSync } from "fs";
import { getRuntimeConfig } from "../config.js";
import { secret } from "../secrets.js";

export interface ProductionCheck {
  ok: boolean;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface ProductionReadinessResult {
  ok: boolean;
  checkedAt: string;
  checks: ProductionCheck[];
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function pass(code: string, message: string): ProductionCheck {
  return { ok: true, code, message, severity: "error" };
}

function fail(code: string, message: string): ProductionCheck {
  return { ok: false, code, message, severity: "error" };
}

function warn(code: string, message: string): ProductionCheck {
  return { ok: false, code, message, severity: "warning" };
}

export async function runProductionReadinessChecks(now = new Date()): Promise<ProductionReadinessResult> {
  const checks: ProductionCheck[] = [];
  let config: ReturnType<typeof getRuntimeConfig> | null = null;

  try {
    config = getRuntimeConfig();
    checks.push(pass("runtime_config", "Runtime config resolves."));
  } catch (error) {
    checks.push(fail("runtime_config", error instanceof Error ? error.message : String(error)));
  }

  if (config) {
    checks.push(config.ledgerMock
      ? fail("mock_mode", "LEDGER_MOCK must be false for production.")
      : pass("mock_mode", "LEDGER_MOCK is false."));

    checks.push(config.useV2Mint
      ? pass("v2_mint", "LEDGER_USE_V2_MINT is enabled.")
      : fail("v2_mint", "LEDGER_USE_V2_MINT must be true so agent metadata is minted."));

    checks.push(config.databasePath && config.databasePath !== ":memory:"
      ? pass("database_path", "LEDGER_DB_PATH points at persistent storage.")
      : fail("database_path", "LEDGER_DB_PATH must be set to a persistent path, not the workspace default or :memory:."));

    if (config.walrusProvider === "cli") {
      checks.push(existsSync(config.walrusBinaryPath)
        ? pass("walrus_cli", "Walrus CLI binary exists.")
        : fail("walrus_cli", `WALRUS_BINARY_PATH does not exist: ${config.walrusBinaryPath}`));
    } else {
      checks.push(warn("walrus_sdk_write", "WALRUS_PROVIDER=sdk is configured, but live SDK writes are not production-proven yet."));
    }

    if (config.paymentsEnabled && config.minSuiBalanceMist < 50_000_000) {
      checks.push(fail("payment_reserve", "LEDGER_MIN_SUI_BALANCE_MIST must reserve at least 50,000,000 MIST when payments are enabled."));
    } else {
      checks.push(pass("payment_reserve", "SUI payment reserve is configured."));
    }
  }

  checks.push(env("LEDGER_DATA_KEY_ID") && secret("LEDGER_DATA_ENCRYPTION_KEY")
    ? pass("data_key", "Dedicated payload encryption key is configured.")
    : fail("data_key", "LEDGER_DATA_KEY_ID and LEDGER_DATA_ENCRYPTION_KEY are required; do not derive production data encryption from SUI_PRIVATE_KEY."));

  checks.push(secret("LEDGER_VERIFY_AUTH_TOKEN")
    ? pass("verify_auth", "Verify route bearer token is configured.")
    : fail("verify_auth", "LEDGER_VERIFY_AUTH_TOKEN is required before exposing /verify."));

  checks.push(secret("LEDGER_AGENT_AUTH_TOKEN")
    ? pass("agent_auth", "Agent API bearer token is configured.")
    : fail("agent_auth", "LEDGER_AGENT_AUTH_TOKEN is required before running the Agent API."));

  checks.push(env("LEDGER_ALERT_WEBHOOK_URL")
    ? pass("alerts", "Alert webhook is configured.")
    : fail("alerts", "LEDGER_ALERT_WEBHOOK_URL is required so production errors page an operator."));

  checks.push(secret("MEMWAL_PRIVATE_KEY") && env("MEMWAL_ACCOUNT_ID")
    ? pass("memwal", "MemWal credentials are configured.")
    : fail("memwal", "MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID are required for production financial memory."));

  if (process.env["LEDGER_LLM_PARSER"] === "true") {
    checks.push(secret("LEDGER_LLM_API_KEY") || secret("BANKR_LLM_KEY") || secret("OPENAI_API_KEY")
      ? pass("llm_key", "LLM parser key is configured.")
      : fail("llm_key", "LEDGER_LLM_PARSER=true requires LEDGER_LLM_API_KEY, BANKR_LLM_KEY, or OPENAI_API_KEY."));
  } else {
    checks.push(warn("llm_parser", "LEDGER_LLM_PARSER is disabled; deterministic parsing remains available but structured parsing is off."));
  }

  const blocking = checks.filter(check => !check.ok && check.severity === "error");
  return {
    ok: blocking.length === 0,
    checkedAt: now.toISOString(),
    checks,
  };
}
