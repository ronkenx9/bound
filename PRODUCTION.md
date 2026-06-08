# Bound Production Readiness

Bound is not production ready yet. This document is the working checklist for getting there without hiding
blockers.

## Current Verified State

Verified locally:

```bash
npm run build
npm run health
npm run production:check
npm run parser:calibrate
npm run test:config
npm run test:create-record
npm run test:encryption
npm run test:health
npm run test:inbound-idempotency
npm run test:llm-parser
npm run test:llm-parser-smoke
npm run test:ops
npm run test:alert-smoke
npm run test:production-check
npm run test:verify-http-smoke
npm run test:secrets-smoke
npm run test:parser
npm run test:parser-adversarial
npm run test:parser-calibration
npm run test:parser-feedback
npm run test:provider-offsets
npm run test:sui-read
npm run test:verify-server
npm run test:agent-safety
npm run test:e2e
npm run move:build
npm run move:test
```

Live agent-policy smoke:

```bash
LEDGER_MOCK=false npm run smoke:agent-policy
```

Live SUI payment execution smoke:

```bash
LEDGER_MOCK=false npm run smoke:sui-payment
```

Live approval-threshold smoke:

```bash
LEDGER_MOCK=false npm run smoke:approval-threshold
```

Live approval-execution smoke:

```bash
LEDGER_MOCK=false npm run smoke:approval-execution
```

Live payment-failure recovery smoke:

```bash
LEDGER_MOCK=false npm run smoke:payment-failure
```

Live LLM parser smoke:

```bash
npm run smoke:llm-parser
```

Current result: verified through Bankr LLM Gateway (`https://llm.bankr.bot/v1`) with `deepseek-v3.2`.
The smoke command calls the configured LLM parser directly instead of falling back to deterministic parsing,
and redacts API-key-like values from error details.

Verified live on Sui Testnet + Walrus Testnet:

```bash
LEDGER_MOCK=false LEDGER_USE_V2_MINT=false WALRUS_PROVIDER=cli \
  WALRUS_BINARY_PATH=/Users/gadgetplug/.local/share/suiup/binaries/testnet/walrus-v1.50.0 \
  WALRUS_CONTEXT=testnet WALRUS_EPOCHS=1 npm run smoke:testnet

WALRUS_PROVIDER=cli \
  WALRUS_BINARY_PATH=/Users/gadgetplug/.local/share/suiup/binaries/testnet/walrus-v1.50.0 \
  WALRUS_CONTEXT=testnet npm run verify:record -- \
  --object-id=0xab3b57a0b0aba47063588f6c447da7d0f05d769709445f6a99fcf719d4f24fbd

WALRUS_PROVIDER=sdk npm run verify:blob -- \
  --blob-id=BIsuHCJs3vBC2ZLB6plIyU_NGniwES0MjVfxOCg3Wss \
  --hash=7dcb2a65e6a033770d468b227e1d5fe48a6ddf750f42ba3babd2a570b5718e3d
```

Live proof:

- Sui object:
  `0xab3b57a0b0aba47063588f6c447da7d0f05d769709445f6a99fcf719d4f24fbd`
- Transaction digest: `HBTsyfGE1ngR44fRXaDWsxZyQiLn9dv3CFchKkbwT4hW`
- Walrus blob: `tuuJqcBN1hKYSS-WODVWCxG-dkGnU82xfi9lj7e2CyI`
- Content hash: `00b302f4ef9ddc41c159db14eec5c4a66b37847ad142c04259edffcacb3b4bd6`
- `verify:record` result: `ok: true`

Move v2 upgrade proof:

- Upgrade tx digest: `Djff1d2msLXphcBMpmVRgXuviVQMNTACvSjvS7uhwQ82`
- Current published package ID: `0x8a414cb0ccbfccf872b21c1edbe571434dd7fea7d49023d8d7a27f5ca0959f5e`
- Original package ID: `0x466fab36aaa226e98beeff2f7f5ef41dc7a2650a46936ce6156c72963423f2a9`
- Version: `2`
- Compatibility blocker discovered and fixed: Sui rejected adding fields to `LedgerRecord`, so v2 keeps
  `LedgerRecord` unchanged and mints a separate `RecordMetadata` object from `mint_with_actor`.

Configured v2 smoke proof:

- Sui object:
  `0x4464be6070b74f24de708026e0fa1b14eb2777c2df4ae6e089ab1791ee69c5d4`
- Transaction digest: `5fvVoYXaUoPSbMqGEQUo3wFm5KdFT558JJjLn3UBDRzi`
- Walrus blob: `1qgr9NMNPuv9IHydIb_ojL4mOjTv8L1-nYNPQIHAKrQ`
- Content hash: `be8f2c5cb3f21632af76f66b172713f83c17b76e1ecf8cde07e36b5b602f362a`
- `verify:record` result: `ok: true`

On-chain agent-policy smoke proof:

- Command: `LEDGER_MOCK=false npm run smoke:agent-policy`
- Policy object:
  `0xc8da85fe51486d8b722da527a828955f78d631dd2074fc73b9f54c704badb6e1`
- Approved action object:
  `0x3d1b3aa3f87b9a844a144b314f5b25f150c90bd675965d016a27e8669c78e906`
- Approved action tx:
  `cZZS5Hs1qknjgAuKoHQ6mBYYDsZ7zM19vaz3LbEPM3h`
- Approved action LedgerRecord:
  `0x5c94117f173c20e83e1ddee340e2a4496e47c70e012296e513b4b317759da05e`
- Rejected over-cap action object:
  `0xc2a264c66686db8ab56597552024d8e016cf4398fc71e5fca366d99a3c852fed`
- Post-revocation rejected action object:
  `0xafe253e80717481c325f6817e68cfc1be42e67205b1d8838dee0e2aa7ed792fa`

Live SUI payment execution proof:

- Command: `LEDGER_MOCK=false npm run smoke:sui-payment`
- Policy object:
  `0xf907b83fa561953dc2ed10471ae16644b2e637efd525c2da18084f4175801bf0`
- Payment transaction digest:
  `64Zks8573eN3o73pyDnzxGfVsxidKrMXaM9FhXpfcfTN`
- Audit action object:
  `0x9e1f87829a3680a461896e5a86adeabb8616aa21357958b9dcd12e8bbfd37dbf`
- Audit transaction digest:
  `2PTococh1vxwFRVo8Zbcr84ixt2tR2cTPFL4XCR48uSb`
- LedgerRecord:
  `0x1847cd99a15c792780b29a1d4ff6b4df255ad2786379d6d0706e121eb744b825`
- Walrus blob:
  `_Te2nRbsav12iNATCchbNWiDMZTJ3_aS5LsQ123-E88`
- Content hash:
  `33ab066b0c1f2ee57758e7548b05a861dcec50a1d22a132826969b5accb66bd0`
- `verify:record` result: `ok: true`

Live approval-threshold proof:

- Command: `LEDGER_MOCK=false npm run smoke:approval-threshold`
- Policy object:
  `0xfc3c39b9c1b2a9b1d8de170708850798cfe0abcfb75c04da2653656e31aea8b5`
- Approval threshold:
  `500` MIST
- Pending action object:
  `0xef1706db24c6b65f15958388d58b07566ecf276295fb155753841c7828f1655c`
- Pending action tx:
  `HHyZRWYJwSGHsS7edZ3XhLyCUq9wE9of35znoi1CcB5R`
- Result:
  `pending_approval`; no payment transaction digest and no LedgerRecord before approval.

Live approval-execution proof:

- Command: `LEDGER_MOCK=false npm run smoke:approval-execution`
- Policy object:
  `0x9990228ff169fbb94c0a9e6cc1f907311b9b48d8192c38597e229e5d616ded7d`
- Pending action object:
  `0x7b669a5ba9a1a8d8f0c5add831f56981e46a912ac559752989bab7a8fcd2923c`
- Pending action tx:
  `Bsnq8sJb8asKgDFYJo3ZgLDbnmcZurFS1bEp2DakMC3z`
- Payment tx after approval:
  `HGX228vkMmXgJinNZ627TAUHF3ToNd14N2NgwDRZmBVs`
- Execution audit action object:
  `0x4b152fac9e50adddd753b8c47d53bd325777de9fbe801844c37a322fc60d8c92`
- Execution audit tx:
  `BHWisg5MgZpKBJ83RXunQ2ejxXXXEANmmtaoZXQFgvsA`
- Before/after balance:
  `188325980` -> `182467300` MIST
- LedgerRecord:
  `0x9c4bb1492a0891869936631f86c4ceaaa8c71d3fee00ea661f2aa29749decb43`
- Walrus blob:
  `pC6lIXM-E1jwbjqgfk5hfDW6wn61kzmyCYyzY1RJ6Jk`
- Content hash:
  `3cf524ea9a76e0214f66731d3bdb353831656f941a2cfc4c836160837e5e539d`
- `verify:record` result: `ok: true`

Live payment-failure recovery proof:

- Command: `LEDGER_MOCK=false npm run smoke:payment-failure`
- Policy object:
  `0x7f14bf336cfb40dadb1d014e056e4204f21a6c44e97c1bf78022bd7ee4f34868`
- Failed action object:
  `0xe21bb1f7c109f96467c129ae73e4fac762fece6a3f904844baf84c3ee0af0946`
- Failed action tx:
  `EsBoPJR142h1XkZMXXBu8Cxpeu4M79BaYHJDAXmtnW6f`
- Result:
  `failed`; no payment transaction digest and no LedgerRecord.
- Failure reason:
  `Insufficient SUI balance for guarded payment`

Latest human record smoke:

- Object:
  `0xe93652e497006064aeebb769e52dcbfb155094feff9c5d063b1aa44f2b7370dd`
- Tx digest:
  `5VcKFYVwR5e78NhcbyoqdNxuhGChN51S24DJoyjRYivK`
- Walrus blob:
  `BIsuHCJs3vBC2ZLB6plIyU_NGniwES0MjVfxOCg3Wss`
- Content hash:
  `7dcb2a65e6a033770d468b227e1d5fe48a6ddf750f42ba3babd2a570b5718e3d`

Live testnet smoke gate:

```bash
LEDGER_MOCK=false npm run smoke:testnet
```

Only run this with funded Sui Testnet credentials, a valid `LEDGER_PACKAGE_ID`, and working Walrus access.

The mocked E2E flow currently covers:

- human financial message -> encrypted Walrus payload -> mocked Sui record
- duplicate detection and confirmation
- append-only correction record
- encrypted monthly report upload
- agent policy creation
- in-policy agent action approval and audit record
- over-cap agent action rejection
- policy revocation and post-revocation rejection

Focused `createRecord` integration coverage now verifies, with injected Walrus/Sui clients:

- encrypted primary payload upload with active `keyId`
- encrypted evidence upload
- Sui mint arguments, including actor/policy/action metadata and evidence blob IDs
- local DB cache fields for SUI agent records
- retry recovery for transient primary Walrus upload failures and Sui mint failures

The focused agent safety test currently covers:

- duplicate agent action replay rejection via a stable idempotency key
- rolling spend-window rejection when cumulative executed SUI spend would exceed the policy cap
- SUI balance reserve guard before payment execution
- approval-threshold parsing and pending-approval blocking before execution
- approval completion that executes a pending SUI action, records execution audit metadata, captures
  before/after balances, and creates a LedgerRecord
- failed-payment recovery that records failed status, reason, and on-chain audit without a payment digest or
  LedgerRecord
- post-submit reconciliation that mints a missing LedgerRecord for an executed action that already has a
  payment digest

## Hard Production Blockers

These must be resolved before claiming production readiness.

1. **SUI payment execution and reconciliation are verified on Testnet, but mainnet/non-SUI rails remain undecided.**
   `LEDGER_ENABLE_PAYMENTS=true` allows approved SUI transfers after policy checks, idempotency checks,
   approval-threshold checks, rolling spend-window checks, and SUI balance reserve checks. Pending approvals
   can be approved/rejected; approved pending SUI payments execute, write a second audit action, capture
   before/after balances, and mint a LedgerRecord. Failed pre-finality executions are marked `failed` and
   logged on-chain without a payment digest or LedgerRecord. `npm run reconcile:agent-action` can mint a
   missing LedgerRecord for an executed action with a payment digest. Live Testnet proof now covers direct
   SUI payment execution, approval-threshold blocking, approval execution, guarded payment failure, and a
   controlled orphan reconciliation. Production still needs explicit mainnet deployment/funding and
   non-SUI payment rail decisions.

2. **Structured LLM parser is live through an OpenAI-compatible gateway, but production traffic policy is open.**
   `LEDGER_LLM_PARSER=true` enables a structured OpenAI-compatible chat parser with local validation and
   deterministic fallback when the model output is invalid or unavailable. A local
   adversarial deterministic-parser corpus now covers decimal shorthand amounts, bank debit/credit alerts,
   receipt evidence, SUI recipients, and non-financial amount mentions. `npm run parser:calibrate` currently
   recommends the handler's `0.6` threshold with zero false accepts/rejects on the local calibration samples.
   Low-confidence confirmations now save confirmed records and persist parser feedback rows for calibration.
   `npm run smoke:llm-parser` is live-proven through Bankr LLM Gateway. Production still needs final traffic
   policy: gateway/provider SLA, spending limits, fallback behavior, and real user-confirmation volume before
   trusting it for customer messages at scale.

3. **Verify surface proves hashes and agent metadata, but needs deployment/TLS/UI hardening.**
   `npm run start:verify` serves `GET /verify/:objectId`, reads the Sui `LedgerRecord`, retrieves the Walrus
   blob, checks the stored hash, and follows the companion `RecordMetadata` object to expose agent actor,
   linked policy, payment digest, and action status without exposing decrypted financial payloads. Optional
   bearer auth (`LEDGER_VERIFY_AUTH_TOKEN`) and per-client rate limiting (`LEDGER_VERIFY_RATE_LIMIT_*`) are
   available. Production still needs deployment behind TLS, explorer/UI polish, and auth design for any
   future decrypt-capable endpoint.

4. **Dedicated data-encryption keys exist, but managed access operations are not complete.**
   Payloads are encrypted before Walrus upload. New payloads can use `LEDGER_DATA_KEY_ID` +
   `LEDGER_DATA_ENCRYPTION_KEY` instead of deriving encryption from `SUI_PRIVATE_KEY`, and decrypt can retain
   old dedicated keys through `LEDGER_LEGACY_DATA_KEY`. `docs/DATA_KEYS.md` documents rotation, rollback,
   recovery, and access rules. Production still needs a managed secret store configured, delegated decrypt
   access, and tested recovery from the chosen secret store.

5. **Live Walrus SDK writes are not yet production-proven; CLI-backed Walrus writes are verified.**
   Walrus CLI was installed through `suiup`, configured from `https://docs.wal.app/setup/client_config.yaml`,
   and funded with `walrus get-wal --context testnet`. Direct SDK reads now verify existing blobs. Direct
   SDK writes previously failed with generic `fetch failed`; the SDK path now exposes configurable
   `WALRUS_SDK_TIMEOUT_MS`, optional `WALRUS_UPLOAD_RELAY_URL`, optional
   `WALRUS_UPLOAD_RELAY_TIP_MAX_MIST`, and `WALRUS_SDK_LOG_NODE_ERRORS`. Production still needs a live SDK
   write proof, preferably with upload relay, before switching away from `WALRUS_PROVIDER=cli`.

6. **Operational deployment envelope is still incomplete.**
   Inbound platform message IDs are durably deduped in SQLite before side effects, and agent actions have
   policy-level idempotency keys. Runtime and verify-server errors now emit structured redacted JSON logs,
   error-level logs can post to `LEDGER_ALERT_WEBHOOK_URL`, a reusable retry/backoff helper exists,
   `createRecord` retries primary Walrus uploads, evidence uploads, and Sui minting, and provider/space
   high-water checkpoints are persisted in SQLite after message handlers settle. `npm run smoke:alert`
   sends an awaited redacted probe to the configured alert webhook so operators can prove alert delivery
   from the deployed host. `npm run smoke:secrets` proves production secrets resolve through managed
   `*_CMD` commands without printing values. `npm run smoke:verify-http` checks a deployed `/verify/:objectId` endpoint and
   fails unless it returns `ok: true` with matching content hashes for a known object. `npm run health` validates
   runtime config and SQLite initialization without spending gas; `npm run production:check` additionally
   blocks production start when persistent storage, dedicated data keys, verify/agent auth, alerting, MemWal,
   Walrus provider readiness, v2 minting, or SUI payment reserve are misconfigured. `deploy/systemd/`
   contains supervised worker/verify/agent API service templates that run the production preflight before
   start. Current
   Spectrum terminal/iMessage messages do not expose a separate replay cursor, so checkpoints use message IDs
   unless a future provider supplies `cursor`, `providerCursor`, or `checkpointCursor`. Production still
   needs those supervisor templates applied to a real host, a configured alert destination, provider-level
   replay/resume integration, and broader retry wiring around remaining external boundaries before running
   against real customer messages.

## Production Requirements

### Security

- Encrypt all Walrus payloads and evidence before upload.
- Store only anchors, hashes, types, timestamps, policy references, and digests on-chain.
- Never log private keys, decrypted financial content, or raw financial messages in production logs.
- Configure `LEDGER_DATA_KEY_ID` and `LEDGER_DATA_ENCRYPTION_KEY` in production; use
  `LEDGER_LEGACY_DATA_KEY` only for old dedicated-key decrypt support.
- Follow `docs/DATA_KEYS.md` for key rotation, rollback, recovery, and emergency decrypt handling.
- Add a managed secret store and access delegation for production key material.
- Add owner revocation for agent policies and delegated wallets.

### Correctness

- Keep schema-validated parser output enabled and locally validated.
- Keep the adversarial parser corpus, feedback capture, and calibration checks passing; expand calibration with user confirmation
  outcomes.
- Use append-only correction/amendment records; never mutate confirmed records in place.
- Keep idempotency for platform message IDs and agent actions enabled; both are enforced locally in SQLite.
- Record rejected agent actions too; refusals are part of the audit trail.

### Agent Wallet

- Agent actions must pass policy checks before any execution.
- Policies need at least: cap, counterparty, category, expiry, token/protocol scope, required evidence,
  approval threshold, revocation status.
- Approved/executed SUI actions need: agent ID, policy ID, rationale, tx digest/reference, result status,
  before/after balance, and evidence blob IDs.
- Pending approval actions need: policy ID, threshold reason, proposed transaction, timestamp, and a later
  approval/rejection decision linked to the original action. Local action logs now preserve the original
  pending audit plus approval execution/rejection audit metadata.
- Rejected actions need: reason, policy evaluated, proposed transaction, and timestamp.
- Failed actions need: reason, policy evaluated, proposed transaction, timestamp, on-chain failure audit, and
  no LedgerRecord unless a payment digest is later reconciled.
- Revoke-by-agent must revoke all active policies for that agent; otherwise an older policy can keep
  authorizing actions after a newer policy is revoked.

### Verification

- A verifier must prove:
  - Sui object exists and matches the expected package/module/type.
  - Walrus blob exists.
  - Blob hash matches on-chain `content_hash`.
  - Companion `RecordMetadata` is resolved for actor type, actor id, linked policy, payment digest, and
    action status when the record was minted through `mint_with_actor`.
  - Decryption succeeds for an authorized viewer.
  - Linked evidence blobs are present.
  - Amendments point to prior records correctly.

Current partial verifier:

```bash
npm run verify:blob -- --blob-id=<walrus_blob_id> --hash=<sha256> [--decrypt]
npm run verify:record -- --object-id=<sui_object_id> [--decrypt]
npm run reconcile:agent-action -- --action-id=<executed_action_id>
npm run production:check
npm run smoke:secrets
npm run smoke:alert
npm run smoke:verify-http -- --base-url=https://<host> --object-id=<known_object_id>
LEDGER_VERIFY_PORT=8787 npm run start:verify
```

`verify:blob` verifies Walrus blob bytes against an expected SHA-256 hash and can decrypt payloads when run
by an authorized local operator. `verify:record` reads the Sui `LedgerRecord`, extracts `walrus_blob_id` and
`content_hash`, follows the mint transaction to read companion `RecordMetadata`, fetches the Walrus blob,
verifies the hash, and optionally decrypts the payload.
`start:verify` exposes the same record verification as a JSON route at `/verify/:objectId`; it intentionally
does not return decrypted plaintext. Set `LEDGER_VERIFY_AUTH_TOKEN` to require bearer auth, and configure
`LEDGER_VERIFY_RATE_LIMIT_MAX` / `LEDGER_VERIFY_RATE_LIMIT_WINDOW_MS` for per-client throttling.
`reconcile:agent-action` mints a missing LedgerRecord for a locally cached executed agent action that has a
payment transaction digest.

## Next Implementation Order

1. Deploy the verify route behind TLS and pass `npm run smoke:verify-http` against a known live object from
   the public endpoint.
2. Apply `docs/DEPLOYMENT.md` to a real host, pass `npm run production:check`, pass `npm run smoke:secrets`, pass `npm run smoke:alert`, and prove worker/verify restart
   behavior plus redacted logs.
3. Configure managed secret storage, delegated decrypt access, and tested secret-store recovery.
4. Decide mainnet/non-SUI payment rail scope; deploy/fund mainnet package if mainnet production is required.
5. Live-test Walrus SDK writes, preferably with upload relay, before switching production from CLI writes.
6. Feed real user-confirmation outcomes back into parser calibration.

## Move V2 Upgrade Notes

The live v2 Move module now keeps the original `mint` entrypoint and adds:

- `mint_with_actor`
- `RecordMetadata`
- `AgentPolicy`
- `AgentActionLog`
- `create_agent_policy`
- `revoke_agent_policy`
- `log_agent_action`

Upgrade sequence used:

```bash
/Users/gadgetplug/.local/share/suiup/binaries/testnet/sui-v1.73.1 client upgrade \
  --upgrade-capability 0x8a689f0b744d4175a5fa057317d9ea0e2ece42abb5b03a3b72bbbded44b905cd \
  --skip-dependency-verification --json
```
After upgrading, `.env` was updated to:

```bash
LEDGER_PACKAGE_ID=0x8a414cb0ccbfccf872b21c1edbe571434dd7fea7d49023d8d7a27f5ca0959f5e
LEDGER_USE_V2_MINT=true
WALRUS_PROVIDER=cli
```
