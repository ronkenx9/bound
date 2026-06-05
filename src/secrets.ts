import { execSync } from "child_process";

/**
 * Resolves a secret value with optional indirection through a managed secret
 * store. For any secret NAME, if `${NAME}_CMD` is set, that command is executed
 * once at startup and its trimmed stdout becomes the value — letting operators
 * pull from any secret manager via its CLI (1Password `op read`, AWS
 * `aws secretsmanager get-secret-value`, HashiCorp `vault kv get`, etc.) without
 * a provider-specific SDK. If `${NAME}_CMD` is unset, the plain `NAME` env var
 * is used. Results are cached so each command runs at most once per process.
 */
const cache = new Map<string, string | undefined>();

function clean(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function secret(name: string): string | undefined {
  const command = clean(process.env[`${name}_CMD`]);

  // No command configured: read the plain env var live (uncached) so callers
  // that rotate env between reads — tests, key rotation — see fresh values.
  if (!command) {
    return clean(process.env[name]);
  }

  // Command configured: execute once and cache, so the secret store is queried
  // a single time per process regardless of how often the value is read.
  if (cache.has(name)) return cache.get(name);

  let value: string | undefined;
  try {
    value = clean(execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to resolve secret ${name} via ${name}_CMD: ${message}`);
  }
  if (!value) {
    throw new Error(`Secret command ${name}_CMD produced an empty value`);
  }

  cache.set(name, value);
  return value;
}

/** Test-only: clears the resolution cache. */
export function clearSecretCache(): void {
  cache.clear();
}
