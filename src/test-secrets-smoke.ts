import { checkProductionSecrets } from "./ops/secret-smoke.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const required = ["SUI_PRIVATE_KEY", "LEDGER_DATA_ENCRYPTION_KEY", "LEDGER_AGENT_AUTH_TOKEN"];

withEnv({
  SUI_PRIVATE_KEY_CMD: "printf 'sui-key'",
  LEDGER_DATA_ENCRYPTION_KEY_CMD: "printf 'data-key'",
  LEDGER_AGENT_AUTH_TOKEN_CMD: "printf 'agent-token'",
}, () => {
  const result = checkProductionSecrets({ required });
  assert(result.ok === true, "expected command-backed secrets to pass");
  assert(result.checks.every(check => check.ok), "expected every check to pass");
  assert(result.checks.every(check => check.source === "command"), "expected command source");
  assert(!JSON.stringify(result).includes("sui-key"), "secret values must not be included in output");
});

withEnv({
  SUI_PRIVATE_KEY: "plain-sui-key",
  SUI_PRIVATE_KEY_CMD: undefined,
  LEDGER_DATA_ENCRYPTION_KEY_CMD: "printf 'data-key'",
  LEDGER_AGENT_AUTH_TOKEN_CMD: "printf 'agent-token'",
}, () => {
  const result = checkProductionSecrets({ required, requireCommandBacked: true });
  assert(result.ok === false, "expected plaintext secret to fail when commands are required");
  const check = result.checks.find(item => item.name === "SUI_PRIVATE_KEY");
  assert(check?.ok === false, "expected SUI private key failure");
  assert(check?.source === "plain_env", "expected plain env source");
});

withEnv({
  SUI_PRIVATE_KEY_CMD: "printf ''",
  LEDGER_DATA_ENCRYPTION_KEY_CMD: "printf 'data-key'",
  LEDGER_AGENT_AUTH_TOKEN_CMD: "printf 'agent-token'",
}, () => {
  const result = checkProductionSecrets({ required });
  assert(result.ok === false, "expected empty command to fail");
  const check = result.checks.find(item => item.name === "SUI_PRIVATE_KEY");
  assert(check?.ok === false, "expected SUI private key failure");
  assert(/empty value/.test(check?.error ?? ""), "expected empty value error");
});

console.log("Secret smoke tests passed.");
