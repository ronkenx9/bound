import "dotenv/config";
import { getRuntimeConfig } from "./config.js";
import { decrypt, resolveDataKeyring, type EncryptedPayload } from "./encryption.js";
import { fetchBlob, hashBytes } from "./walrus/client.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const blobId = arg("blob-id");
  const expectedHash = arg("hash");
  const shouldDecrypt = process.argv.includes("--decrypt");

  if (!blobId || !expectedHash) {
    throw new Error("Usage: npm run verify:blob -- --blob-id=<id> --hash=<sha256> [--decrypt]");
  }

  const bytes = await fetchBlob(blobId);
  const actualHash = hashBytes(bytes);
  const ok = actualHash === expectedHash;

  const result: Record<string, unknown> = {
    ok,
    blobId,
    expectedHash,
    actualHash,
    byteLength: bytes.byteLength,
  };

  if (shouldDecrypt) {
    const config = getRuntimeConfig();
    const encrypted = JSON.parse(new TextDecoder().decode(bytes)) as EncryptedPayload;
    result["plaintext"] = decrypt(encrypted, resolveDataKeyring(config.suiPrivateKey));
  }

  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exit(2);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
