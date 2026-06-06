# Ledger

Verifiable financial memory + permissioned agent wallet on Sui, powered by Walrus and Tatum.

Ledger is a messaging-based financial record system for humans and AI agents. It listens for financial messages (bank alerts, invoices, payment instructions), parses them into structured records, stores encrypted payloads on [Walrus](https://www.walrus.xyz/), and mints tamper-evident `LedgerRecord` objects on [Sui](https://sui.io/) for auditability. All Sui RPC calls route through [Tatum](https://tatum.io/) infrastructure.

For AI agents, Ledger adds scoped autonomy: an owner creates a spending policy, and the agent can execute payments only within that policy. Every action — approved, rejected, or failed — is recorded on-chain with a full audit trail.

## How It Works

```
Financial message (iMessage / terminal)
  -> Parser (regex + optional LLM extraction)
  -> Encrypt payload
  -> Store on Walrus (content-addressed blob)
  -> Mint LedgerRecord on Sui (via Tatum RPC)
  -> Reply with summary + verification URL
```

### On-Chain Objects (Sui Move)

| Object | Purpose |
|--------|---------|
| `LedgerRecord` | Audit anchor: Walrus blob ID, content hash, record type, timestamps |
| `RecordMetadata` | v2 actor-aware metadata: human/agent, agent ID, tx digest, linked policy |
| `AgentPolicy` | Spending policy: cap, counterparty, category, token, expiry, approval threshold |
| `AgentActionLog` | Every agent action attempt with status, reason, and tx digest |

### Agent Wallet Flow

1. Human creates a scoped policy (e.g. "agent can pay Emeka up to N70,000 until Sunday")
2. Agent sees a payment intent that fits the policy — executes and records
3. Agent sees an over-cap invoice — refuses with policy reason, logs rejection on-chain
4. Owner revokes policy — subsequent agent attempts fail with audit trail
5. Above-threshold payments go to `pending_approval` — owner approves/rejects before execution

Safety guards: idempotency keys, rolling spend-window enforcement, SUI balance reserve, approval thresholds.

## Tatum Integration

All Sui JSON-RPC calls route through Tatum's Sui Testnet endpoint (`https://sui-testnet.gateway.tatum.io`) with `x-api-key` header auth. This includes:

- Transaction signing and execution (`sui_executeTransactionBlock`)
- Object reads for verification (`sui_getObject`, `sui_getTransactionBlock`)
- Balance and coin queries (`suix_getBalance`, `suix_getCoins`)
- Gas price resolution (`suix_getReferenceGasPrice`)

A throttled fetch wrapper serializes requests to respect Tatum's rate limits, and gas price/budget are set explicitly to avoid unsupported extended RPC methods.

**Config:**

```bash
SUI_RPC_URL=https://sui-testnet.gateway.tatum.io
SUI_RPC_API_KEY=<your-tatum-api-key>
```

## Walrus Integration

Every financial record is stored as an encrypted, content-addressed blob on Walrus before the on-chain anchor is minted. The content hash (SHA-256) is stored in the `LedgerRecord` object, making the record independently verifiable: anyone with the object ID can fetch the Walrus blob and check it against the on-chain hash.

- Primary payload: encrypted JSON (parsed metadata + raw message + timestamp)
- Evidence attachments: additional encrypted blobs (receipts, confirmations)
- Verification: `GET /verify/:objectId` fetches the Sui object, retrieves the Walrus blob, and checks the hash

**Config:**

```bash
WALRUS_PROVIDER=cli          # cli | sdk
WALRUS_EPOCHS=3              # storage duration
```

## Agent API

A programmatic HTTP interface so AI agents can access Ledger directly (not just via messaging). Every endpoint runs the same policy-enforced, on-chain-audited engine as the message handler. Auth is **mandatory** — the server refuses to start without `LEDGER_AGENT_AUTH_TOKEN`, and fails closed (503) on any request if it's unset.

```bash
LEDGER_AGENT_AUTH_TOKEN=<token> npm run start:agent-api   # listens on :8788
```

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/agent/policy` | Create a scoped agent policy |
| `POST` | `/agent/transaction` | Propose a payment intent; returns the policy decision (approved / executed / rejected / pending_approval) |
| `POST` | `/agent/actions/:id/approve` | Approve a pending action (executes the payment) |
| `POST` | `/agent/actions/:id/reject` | Reject a pending action |
| `GET`  | `/agent/actions/:id` | Read an action's status + audit fields |
| `POST` | `/agent/policies/:id/revoke` | Revoke a policy |

All requests require `Authorization: Bearer <token>`. Example:

```bash
# Create a policy: fuel-agent can pay Emeka up to N70,000
curl -X POST localhost:8788/agent/policy -H "Authorization: Bearer $TOKEN" \
  -d '{"agentId":"fuel-agent","maxAmount":70000,"counterparty":"Emeka","category":"fuel"}'

# Propose a payment (agent's intent in natural language)
curl -X POST localhost:8788/agent/transaction -H "Authorization: Bearer $TOKEN" \
  -d '{"agentId":"fuel-agent","intent":"pay Emeka N50,000 for fuel"}'
```

The response carries the on-chain action id, payment digest (if executed), and verify URL. An over-cap or out-of-policy intent comes back `rejected` with a reason and an on-chain rejection log — the agent cannot move money outside the rails.

## Verification API

```bash
npm run start:verify
# GET /verify/:objectId -> { ok: true, objectId, blobId, contentHash, ... }
```

Optional bearer auth (`LEDGER_VERIFY_AUTH_TOKEN`) and per-client rate limiting.

## Setup

```bash
# Install
npm install

# Copy and fill environment variables
cp .env.example .env

# Get a free Tatum API key at https://dashboard.tatum.io
# Set SUI_RPC_URL and SUI_RPC_API_KEY in .env

# Build
npm run build

# Health check (validates config + DB without spending gas)
npm run health

# Run (terminal provider)
npm run dev
```

### Requirements

- Node.js 20+
- Sui CLI (`suiup`) for Move builds
- Walrus CLI for blob storage (`suiup` installs it)
- A funded Sui Testnet wallet (`sui client faucet`)
- WAL tokens for Walrus storage (`walrus get-wal --context testnet`)

## Move Contract

Published on Sui Testnet:

- Package: `0x8a414cb0ccbfccf872b21c1edbe571434dd7fea7d49023d8d7a27f5ca0959f5e`
- Original ID: `0x466fab36aaa226e98beeff2f7f5ef41dc7a2650a46936ce6156c72963423f2a9`
- Chain ID: `4c78adac`

```bash
npm run move:build
npm run move:test
```

## Tests

```bash
# Unit / integration
npm run test:parser              # Financial message parsing
npm run test:parser-adversarial  # Adversarial parser inputs
npm run test:agent-safety        # Agent policy enforcement
npm run test:encryption          # Payload encryption + key rotation
npm run test:create-record       # Record pipeline with injected clients
npm run test:inbound-idempotency # Duplicate message rejection
npm run test:e2e                 # Full mocked end-to-end

# Live smoke (requires funded wallet + Tatum key)
LEDGER_MOCK=false npm run smoke:testnet
LEDGER_MOCK=false npm run smoke:agent-policy
LEDGER_MOCK=false npm run smoke:sui-payment
LEDGER_MOCK=false npm run smoke:approval-threshold
LEDGER_MOCK=false npm run smoke:approval-execution
LEDGER_MOCK=false npm run smoke:payment-failure
```

## Live Proofs (Sui Testnet via Tatum RPC)

**Human record:**
- Sui object: [`0xfe28b5ae28b4ecf7e3294ed177fb21ffb43fc67d021ef85bf4bd8e2cdfac17e6`](https://testnet.suivision.xyz/object/0xfe28b5ae28b4ecf7e3294ed177fb21ffb43fc67d021ef85bf4bd8e2cdfac17e6)
- Tx: [`Dj1TgWvqG422pmKRePiU6ujEWkL1oBoNfViP3C1w5oBS`](https://testnet.suivision.xyz/txblock/Dj1TgWvqG422pmKRePiU6ujEWkL1oBoNfViP3C1w5oBS)
- Walrus blob: `oRp5y40yD-K45HtU0lcn7Pf7mFy_YlSnfp4a8g2jcpA`

**Agent policy + approved payment:**
- Policy: [`0xf907b83fa561953dc2ed10471ae16644b2e637efd525c2da18084f4175801bf0`](https://testnet.suivision.xyz/object/0xf907b83fa561953dc2ed10471ae16644b2e637efd525c2da18084f4175801bf0)
- Payment tx: [`64Zks8573eN3o73pyDnzxGfVsxidKrMXaM9FhXpfcfTN`](https://testnet.suivision.xyz/txblock/64Zks8573eN3o73pyDnzxGfVsxidKrMXaM9FhXpfcfTN)

**Over-cap rejection:**
- Rejected action: [`0xc2a264c66686db8ab56597552024d8e016cf4398fc71e5fca366d99a3c852fed`](https://testnet.suivision.xyz/object/0xc2a264c66686db8ab56597552024d8e016cf4398fc71e5fca366d99a3c852fed)

**Approval threshold (pending -> approved -> executed):**
- Pending action: [`0xef1706db24c6b65f15958388d58b07566ecf276295fb155753841c7828f1655c`](https://testnet.suivision.xyz/object/0xef1706db24c6b65f15958388d58b07566ecf276295fb155753841c7828f1655c)
- Post-approval payment: [`HGX228vkMmXgJinNZ627TAUHF3ToNd14N2NgwDRZmBVs`](https://testnet.suivision.xyz/txblock/HGX228vkMmXgJinNZ627TAUHF3ToNd14N2NgwDRZmBVs)

**Payment failure recovery:**
- Failed action: [`0xe21bb1f7c109f96467c129ae73e4fac762fece6a3f904844baf84c3ee0af0946`](https://testnet.suivision.xyz/object/0xe21bb1f7c109f96467c129ae73e4fac762fece6a3f904844baf84c3ee0af0946)

## Architecture

```
src/
  index.ts              # Spectrum provider entrypoint (terminal, iMessage)
  handler.ts            # Message handler: parse -> record -> reply
  config.ts             # Environment config with validation
  agent.ts              # Agent policy engine + payment execution
  db.ts                 # SQLite: policies, actions, idempotency, offsets
  encryption.ts         # AES-256-GCM payload encryption with key rotation
  parsing/parser.ts     # Deterministic + optional LLM financial parser
  record/creator.ts     # Record pipeline: encrypt -> Walrus -> Sui mint
  sui/client.ts         # Sui client with Tatum RPC, throttling, retry
  walrus/client.ts      # Walrus blob storage (SDK + CLI providers)
  verify/               # Verification server + blob checker
  ops/                  # Structured logging, retry, alerts
move/ledger/            # Sui Move package (LedgerRecord, AgentPolicy, AgentActionLog)
```

## License

MIT
