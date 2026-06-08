import { runProductionReadinessChecks } from "./ops/production.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withEnv(values: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const baseEnv: Record<string, string> = {
  LEDGER_MOCK: "false",
  SUI_PRIVATE_KEY: "test-private-key",
  SUI_OWNER_ADDRESS: "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",
  LEDGER_PACKAGE_ID: "0xpackage",
  LEDGER_USE_V2_MINT: "true",
  LEDGER_DB_PATH: "/var/lib/bound/bound.db",
  WALRUS_PROVIDER: "cli",
  WALRUS_BINARY_PATH: "/bin/sh",
  LEDGER_DATA_KEY_ID: "dek-prod",
  LEDGER_DATA_ENCRYPTION_KEY: "data-key",
  LEDGER_VERIFY_AUTH_TOKEN: "verify-token",
  LEDGER_AGENT_AUTH_TOKEN: "agent-token",
  LEDGER_ALERT_WEBHOOK_URL: "https://alerts.example.test/hook",
  MEMWAL_PRIVATE_KEY: "memwal-key",
  MEMWAL_ACCOUNT_ID: "0xmemwal",
  LEDGER_LLM_PARSER: "true",
  LEDGER_LLM_API_KEY: "llm-key",
};

function check(result: Awaited<ReturnType<typeof runProductionReadinessChecks>>, code: string) {
  return result.checks.find(item => item.code === code);
}

await withEnv(baseEnv, async () => {
  const result = await runProductionReadinessChecks(new Date("2026-06-08T00:00:00Z"));
  assert(result.ok === true, "expected production-shaped env to pass");
  assert(check(result, "runtime_config")?.ok === true, "expected runtime config pass");
});

await withEnv({ ...baseEnv, LEDGER_MOCK: "true" }, async () => {
  const result = await runProductionReadinessChecks();
  assert(result.ok === false, "expected mock mode to fail");
  assert(check(result, "mock_mode")?.ok === false, "expected mock_mode failure");
});

await withEnv({ ...baseEnv, LEDGER_DATA_ENCRYPTION_KEY: undefined }, async () => {
  const result = await runProductionReadinessChecks();
  assert(result.ok === false, "expected missing data key to fail");
  assert(check(result, "data_key")?.ok === false, "expected data_key failure");
});

await withEnv({ ...baseEnv, LEDGER_VERIFY_AUTH_TOKEN: undefined, LEDGER_AGENT_AUTH_TOKEN: undefined }, async () => {
  const result = await runProductionReadinessChecks();
  assert(result.ok === false, "expected missing auth tokens to fail");
  assert(check(result, "verify_auth")?.ok === false, "expected verify auth failure");
  assert(check(result, "agent_auth")?.ok === false, "expected agent auth failure");
});

await withEnv({ ...baseEnv, MEMWAL_PRIVATE_KEY: undefined }, async () => {
  const result = await runProductionReadinessChecks();
  assert(result.ok === false, "expected missing MemWal credentials to fail");
  assert(check(result, "memwal")?.ok === false, "expected memwal failure");
});

await withEnv({ ...baseEnv, LEDGER_ALERT_WEBHOOK_URL: undefined }, async () => {
  const result = await runProductionReadinessChecks();
  assert(result.ok === false, "expected missing alert webhook to fail");
  assert(check(result, "alerts")?.ok === false, "expected alerts failure");
});

console.log("Production readiness checks passed.");
