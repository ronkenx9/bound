process.env["LEDGER_MOCK"] = "true";
process.env["LEDGER_DB_PATH"] = ":memory:";
process.env["SUI_PRIVATE_KEY"] = "test-private-key";
process.env["SUI_OWNER_ADDRESS"] = "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba";

export {};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withEnv(values: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const { runHealthChecks } = await import("./ops/health.js");

await withEnv({
  LEDGER_MOCK: "true",
  SUI_PRIVATE_KEY: "test-private-key",
  SUI_OWNER_ADDRESS: "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",
  LEDGER_DB_PATH: ":memory:",
}, async () => {
  const health = await runHealthChecks();
  assert(health.ok === true, "expected healthy runtime config and DB");
  assert(health.checks.config.ok === true, "expected config check to pass");
  assert(health.checks.database.ok === true, "expected database check to pass");
  assert(health.checks.config.details?.mode === "mock", "expected config details to report mock mode");
});

await withEnv({
  LEDGER_MOCK: "false",
  SUI_PRIVATE_KEY: undefined,
  SUI_OWNER_ADDRESS: "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",
  LEDGER_PACKAGE_ID: "0xpackage",
}, async () => {
  const health = await runHealthChecks();
  assert(health.ok === false, "expected missing runtime config to fail health");
  assert(health.checks.config.ok === false, "expected config check to fail");
  assert(/SUI_PRIVATE_KEY/.test(health.checks.config.error ?? ""), "expected missing SUI_PRIVATE_KEY error");
});

console.log("Health tests passed.");
