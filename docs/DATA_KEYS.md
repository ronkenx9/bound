# Ledger Data Key Operations

Ledger encrypts Walrus payloads before upload. Production deployments must use dedicated data keys through
`LEDGER_DATA_KEY_ID` and `LEDGER_DATA_ENCRYPTION_KEY`; `SUI_PRIVATE_KEY` is only the legacy fallback for
payloads that were written before dedicated data keys existed.

## Required Secret Layout

Store these values in a managed secret store, not in plaintext files on a server:

- `LEDGER_DATA_KEY_ID`: active key identifier, for example `dek-2026-06`.
- `LEDGER_DATA_ENCRYPTION_KEY`: active key material for new encryptions.
- `LEDGER_LEGACY_DATA_KEY`: comma-separated `keyId:keyMaterial` entries for old dedicated keys that must
  remain decryptable.
- `SUI_PRIVATE_KEY`: wallet signing key and legacy decrypt fallback. Do not reuse it as a data key.

Use stable, date/version-based key IDs. Never change key material while keeping the same key ID.

## Pre-Rotation Checklist

Before rotating a data key:

1. Confirm the current active `LEDGER_DATA_KEY_ID` and key material are present in the managed secret store.
2. Run local decrypt verification against at least one recent object:
   `npm run verify:record -- --object-id=<recent_object_id> --decrypt`
3. Run the local encryption tests:
   `npm run test:encryption`
4. Generate the new key material outside logs and shell history.
5. Prepare a rollback secret version that restores the old active key configuration.

Do not rotate during an incident, live demo, or active migration unless rotation is the incident response.

## Rotation Procedure

Assume the old active key is:

```bash
LEDGER_DATA_KEY_ID=dek-2026-06
LEDGER_DATA_ENCRYPTION_KEY=<old-key-material>
```

Rotate to `dek-2026-07`:

1. Add the old active key to `LEDGER_LEGACY_DATA_KEY`:
   ```bash
   LEDGER_LEGACY_DATA_KEY=dek-2026-06:<old-key-material>
   ```
2. Set the new active key:
   ```bash
   LEDGER_DATA_KEY_ID=dek-2026-07
   LEDGER_DATA_ENCRYPTION_KEY=<new-key-material>
   ```
3. Restart Ledger workers and the verify server using the new secret version.
4. Run:
   ```bash
   npm run test:encryption
   npm run test:create-record
   ```
5. Create one non-sensitive smoke record in the target environment.
6. Verify the smoke record decrypts locally:
   ```bash
   npm run verify:record -- --object-id=<smoke_object_id> --decrypt
   ```
7. Verify at least one pre-rotation record still decrypts locally:
   ```bash
   npm run verify:record -- --object-id=<old_object_id> --decrypt
   ```
8. Record the rotation time, old key ID, new key ID, operator, and verification object IDs in the operator
   journal.

New records should carry the new `keyId`; older records should retain their original `keyId` and decrypt
through `LEDGER_LEGACY_DATA_KEY`.

## Rollback

Rollback is allowed only if new writes fail or decrypt verification fails immediately after rotation.

1. Restore the previous secret version.
2. Restart Ledger workers and verify server.
3. Run:
   ```bash
   npm run test:encryption
   npm run verify:record -- --object-id=<known_good_object_id> --decrypt
   ```
4. Keep any records written with the failed new key decryptable by adding that key to
   `LEDGER_LEGACY_DATA_KEY` before removing it as active.
5. Record the failed key ID and object IDs affected.

Never delete key material for any key ID that may have encrypted a Walrus payload.

## Recovery

If active data-key material is lost:

1. Stop new writes immediately.
2. Identify the active `LEDGER_DATA_KEY_ID` used by affected records.
3. Restore key material from the managed secret-store history or offline backup.
4. Verify decrypt on representative records with:
   `npm run verify:record -- --object-id=<object_id> --decrypt`
5. Rotate to a new active key after recovery, keeping the recovered key in `LEDGER_LEGACY_DATA_KEY`.

If a legacy key is lost, records encrypted with that `keyId` are not recoverable from Walrus/Sui alone.
Walrus stores ciphertext; Sui stores anchors and hashes, not plaintext or key material.

## Access Rules

- Only production operators who need decrypt access should be able to read data-key secrets.
- The verify HTTP route must not expose decrypted payloads.
- Decrypt-capable commands are local/operator-only until a delegated access design exists.
- Alert payloads and logs must never include raw financial messages, plaintext payloads, or key material.
- Any emergency decrypt should record operator, reason, object ID, timestamp, and output handling location.

## Decommissioning Old Keys

Do not remove a key from `LEDGER_LEGACY_DATA_KEY` until all records encrypted with that key are outside the
required retention window or have been re-encrypted into a new record lineage. Because Ledger records are
append-only, re-encryption should create linked replacement records rather than mutating historical records.
