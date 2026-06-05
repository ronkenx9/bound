import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_SALT = "ledger-walrus-salt";

export interface EncryptedPayload {
  version: string;
  keyId?: string;
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface DataKeyring {
  activeKeyId: string | null;
  keys: Map<string, string>;
  legacyKey: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function parseLegacyKeys(raw: string | undefined): Map<string, string> {
  const keys = new Map<string, string>();
  if (!raw) return keys;

  for (const part of raw.split(",")) {
    const separator = part.indexOf(":");
    if (separator <= 0 || separator === part.length - 1) {
      throw new Error(`LEDGER_LEGACY_DATA_KEY entries must be keyId:key pairs; invalid entry "${part}"`);
    }
    const keyId = part.slice(0, separator).trim();
    const keyMaterial = part.slice(separator + 1).trim();
    if (!keyId || !keyMaterial) {
      throw new Error(`LEDGER_LEGACY_DATA_KEY entries must include a key id and key material; invalid entry "${part}"`);
    }
    keys.set(keyId, keyMaterial);
  }

  return keys;
}

export function resolveDataKeyring(legacyKey: string): DataKeyring {
  const activeKey = env("LEDGER_DATA_ENCRYPTION_KEY");
  const activeKeyId = env("LEDGER_DATA_KEY_ID") ?? null;
  const keys = parseLegacyKeys(env("LEDGER_LEGACY_DATA_KEY"));

  if (activeKey || activeKeyId) {
    if (!activeKey || !activeKeyId) {
      throw new Error("LEDGER_DATA_KEY_ID and LEDGER_DATA_ENCRYPTION_KEY must be set together");
    }
    keys.set(activeKeyId, activeKey);
  }

  return {
    activeKeyId,
    keys,
    legacyKey,
  };
}

export function hasDedicatedDataKey(keyring: DataKeyring): boolean {
  return keyring.activeKeyId !== null && keyring.keys.has(keyring.activeKeyId);
}

/**
 * Derives a 32-byte key from key material.
 */
export function deriveKey(keyMaterial: string): Buffer {
  return crypto.pbkdf2Sync(keyMaterial, KEY_SALT, 100000, 32, "sha256");
}

function resolveEncryptKey(keyringOrLegacyKey: DataKeyring | string): { keyMaterial: string; keyId?: string } {
  if (typeof keyringOrLegacyKey === "string") {
    return { keyMaterial: keyringOrLegacyKey };
  }

  if (hasDedicatedDataKey(keyringOrLegacyKey)) {
    const keyId = keyringOrLegacyKey.activeKeyId!;
    return { keyMaterial: keyringOrLegacyKey.keys.get(keyId)!, keyId };
  }

  return { keyMaterial: keyringOrLegacyKey.legacyKey };
}

function resolveDecryptKey(payload: EncryptedPayload, keyringOrLegacyKey: DataKeyring | string): string {
  if (typeof keyringOrLegacyKey === "string") {
    return keyringOrLegacyKey;
  }

  if (payload.keyId) {
    const keyMaterial = keyringOrLegacyKey.keys.get(payload.keyId);
    if (!keyMaterial) {
      throw new Error(`No data encryption key configured for key id "${payload.keyId}"`);
    }
    return keyMaterial;
  }

  return keyringOrLegacyKey.legacyKey;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 */
export function encrypt(plaintext: string, keyringOrLegacyKey: DataKeyring | string): EncryptedPayload {
  const { keyMaterial, keyId } = resolveEncryptKey(keyringOrLegacyKey);
  const key = deriveKey(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final().toString("hex");
  
  const tag = cipher.getAuthTag().toString("hex");

  return {
    version: "1.0",
    ...(keyId ? { keyId } : {}),
    ciphertext,
    iv: iv.toString("hex"),
    tag: tag,
  };
}

/**
 * Decrypts an EncryptedPayload back into a plaintext string.
 */
export function decrypt(payload: EncryptedPayload, keyringOrLegacyKey: DataKeyring | string): string {
  const key = deriveKey(resolveDecryptKey(payload, keyringOrLegacyKey));
  const iv = Buffer.from(payload.iv, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(payload.ciphertext, "hex", "utf8");
  decrypted += decipher.final().toString("utf8");
  
  return decrypted;
}
