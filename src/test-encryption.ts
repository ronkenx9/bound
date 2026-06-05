import { decrypt, encrypt, resolveDataKeyring } from "./encryption.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
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
    fn();
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

withEnv({
  LEDGER_DATA_KEY_ID: "dek-2026-06",
  LEDGER_DATA_ENCRYPTION_KEY: "dedicated-test-data-key",
  LEDGER_LEGACY_DATA_KEY: undefined,
}, () => {
  const keyring = resolveDataKeyring("legacy-sui-secret");
  const encrypted = encrypt("sensitive ledger payload", keyring);

  assert(encrypted.keyId === "dek-2026-06", "expected encrypted payload to include active key id");
  assert(decrypt(encrypted, keyring) === "sensitive ledger payload", "expected dedicated key decrypt");
});

withEnv({
  LEDGER_DATA_KEY_ID: "dek-new",
  LEDGER_DATA_ENCRYPTION_KEY: "new-dedicated-key",
  LEDGER_LEGACY_DATA_KEY: "dek-old:old-dedicated-key",
}, () => {
  const oldKeyring = {
    activeKeyId: "dek-old",
    keys: new Map([["dek-old", "old-dedicated-key"]]),
    legacyKey: "legacy-sui-secret",
  };
  const oldPayload = encrypt("old payload", oldKeyring);

  const rotatedKeyring = resolveDataKeyring("legacy-sui-secret");
  assert(decrypt(oldPayload, rotatedKeyring) === "old payload", "expected rotated keyring to decrypt old key id");
});

withEnv({
  LEDGER_DATA_KEY_ID: undefined,
  LEDGER_DATA_ENCRYPTION_KEY: undefined,
  LEDGER_LEGACY_DATA_KEY: undefined,
}, () => {
  const legacyPayload = encrypt("legacy payload", "legacy-sui-secret");
  const keyring = resolveDataKeyring("legacy-sui-secret");

  assert(legacyPayload.keyId === undefined, "expected legacy payloads to omit key id");
  assert(decrypt(legacyPayload, keyring) === "legacy payload", "expected fallback legacy decrypt");
});

console.log("Encryption tests passed.");
