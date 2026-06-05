import assert from "node:assert";
import { secret, clearSecretCache } from "./secrets.js";

function reset(names: string[]) {
  clearSecretCache();
  for (const name of names) {
    delete process.env[name];
    delete process.env[`${name}_CMD`];
  }
}

function run() {
  // 1. Plain env var passes through unchanged.
  reset(["TEST_SECRET"]);
  process.env["TEST_SECRET"] = "plain-value";
  assert.strictEqual(secret("TEST_SECRET"), "plain-value");

  // 2. _CMD takes precedence and its stdout is used (trimmed).
  reset(["TEST_SECRET"]);
  process.env["TEST_SECRET"] = "ignored";
  process.env["TEST_SECRET_CMD"] = "printf 'from-command\\n'";
  assert.strictEqual(secret("TEST_SECRET"), "from-command");

  // 3. Result is cached: changing the command afterwards has no effect.
  process.env["TEST_SECRET_CMD"] = "printf 'changed'";
  assert.strictEqual(secret("TEST_SECRET"), "from-command", "value should be cached");

  // 4. Empty/whitespace env var resolves to undefined.
  reset(["TEST_SECRET"]);
  process.env["TEST_SECRET"] = "   ";
  assert.strictEqual(secret("TEST_SECRET"), undefined);

  // 5. Missing secret resolves to undefined.
  reset(["TEST_SECRET"]);
  assert.strictEqual(secret("TEST_SECRET"), undefined);

  // 6. A command that produces empty output throws.
  reset(["TEST_SECRET"]);
  process.env["TEST_SECRET_CMD"] = "printf ''";
  assert.throws(() => secret("TEST_SECRET"), /empty value/);

  // 7. A failing command throws with context.
  reset(["TEST_SECRET"]);
  process.env["TEST_SECRET_CMD"] = "exit 7";
  assert.throws(() => secret("TEST_SECRET"), /Failed to resolve secret TEST_SECRET/);

  reset(["TEST_SECRET"]);
  console.log("Secret resolver tests passed.");
}

run();
