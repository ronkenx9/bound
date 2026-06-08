import { secret, clearSecretCache } from "../secrets.js";

export interface SecretSmokeCheck {
  name: string;
  ok: boolean;
  source: "command" | "plain_env" | "missing";
  error?: string;
}

export interface SecretSmokeResult {
  ok: boolean;
  checks: SecretSmokeCheck[];
}

export interface SecretSmokeOptions {
  required?: string[];
  requireCommandBacked?: boolean;
}

export const DEFAULT_PRODUCTION_SECRETS = [
  "SUI_PRIVATE_KEY",
  "LEDGER_DATA_ENCRYPTION_KEY",
  "LEDGER_VERIFY_AUTH_TOKEN",
  "LEDGER_AGENT_AUTH_TOKEN",
  "MEMWAL_PRIVATE_KEY",
];

function clean(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function sourceFor(name: string): SecretSmokeCheck["source"] {
  if (clean(process.env[`${name}_CMD`])) return "command";
  if (clean(process.env[name])) return "plain_env";
  return "missing";
}

function checkSecret(name: string, requireCommandBacked: boolean): SecretSmokeCheck {
  const source = sourceFor(name);
  if (source === "missing") {
    return { name, ok: false, source, error: `${name} or ${name}_CMD is required` };
  }

  if (requireCommandBacked && source !== "command") {
    return { name, ok: false, source, error: `${name}_CMD is required for production secret-store proof` };
  }

  try {
    secret(name);
    return { name, ok: true, source };
  } catch (error) {
    return {
      name,
      ok: false,
      source,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function checkProductionSecrets(options: SecretSmokeOptions = {}): SecretSmokeResult {
  clearSecretCache();
  const required = options.required ?? DEFAULT_PRODUCTION_SECRETS;
  const requireCommandBacked = options.requireCommandBacked ?? true;
  const checks = required.map(name => checkSecret(name, requireCommandBacked));
  return {
    ok: checks.every(check => check.ok),
    checks,
  };
}
