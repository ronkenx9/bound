import { secret } from "../secrets.js";

/**
 * Bound's financial memory layer, backed by MemWal (Walrus Memory).
 *
 * Records and agent decisions are remembered as durable, verifiable memories on
 * Walrus and recalled semantically — so an agent (or the business running it) can
 * answer "have I paid this vendor before?", "what's my fuel spend this week?", or
 * spot a duplicate from prior context, not just a local log. This is the layer
 * that makes Bound *memory*, not just enforcement.
 *
 * It is optional and fails open: if MemWal is not configured the app keeps
 * working with a no-op memory (remember -> nothing, recall -> []), so the rest of
 * Bound never depends on it being present.
 */

export interface MemoryHit {
  text: string;
  score?: number;
}

export interface FinancialMemory {
  /** Whether a real MemWal backend is wired (vs the no-op fallback). */
  readonly enabled: boolean;
  /** Liveness check against the relayer. Returns false if disabled or unreachable. */
  health(): Promise<boolean>;
  /** Persist a memory. With wait=true, blocks until the remember job is indexed. */
  remember(text: string, opts?: { wait?: boolean }): Promise<{ jobId: string } | null>;
  /** Semantic recall. Returns [] when disabled. */
  recall(query: string, opts?: { limit?: number }): Promise<MemoryHit[]>;
}

/** Minimal shape of the MemWal SDK client we depend on (kept narrow for testability). */
export interface MemWalClient {
  health(): Promise<unknown>;
  remember(text: string): Promise<{ job_id: string }>;
  waitForRememberJob(jobId: string): Promise<unknown>;
  recall(input: { query: string }): Promise<{ results: Array<{ text?: string; content?: string; score?: number }> }>;
}

interface MemWalConfig {
  key: string;
  accountId: string;
  serverUrl: string;
  namespace: string;
}

function readConfig(): MemWalConfig | null {
  // Match MemWal's own naming (MEMWAL_PRIVATE_KEY), with MEMWAL_KEY as a fallback.
  const key = secret("MEMWAL_PRIVATE_KEY") ?? secret("MEMWAL_KEY");
  const accountId = process.env["MEMWAL_ACCOUNT_ID"]?.trim();
  const serverUrl = process.env["MEMWAL_SERVER_URL"]?.trim() || "https://relayer.memory.walrus.xyz";
  const namespace = process.env["MEMWAL_NAMESPACE"]?.trim() || "bound";
  if (!key || !accountId) return null;
  return { key, accountId, serverUrl, namespace };
}

/** Lazily constructs the real MemWal client via dynamic import (dep loaded only when configured). */
async function loadMemWalClient(config: MemWalConfig): Promise<MemWalClient> {
  // Non-constant specifier so tsc doesn't require the package to be installed at build time.
  const specifier = "@mysten-incubation/memwal";
  const mod: any = await import(specifier);
  const MemWal = mod.MemWal ?? mod.default?.MemWal ?? mod.default;
  return MemWal.create({
    key: config.key,
    accountId: config.accountId,
    serverUrl: config.serverUrl,
    namespace: config.namespace,
  }) as MemWalClient;
}

const NOOP_MEMORY: FinancialMemory = {
  enabled: false,
  async health() { return false; },
  async remember() { return null; },
  async recall() { return []; },
};

/**
 * Build a FinancialMemory. Pass a client for tests; otherwise it reads MemWal
 * config from the environment and lazily connects on first use, or returns the
 * no-op memory if unconfigured.
 */
export function createMemory(opts: { client?: MemWalClient } = {}): FinancialMemory {
  const injected = opts.client;
  const config = injected ? null : readConfig();
  if (!injected && !config) return NOOP_MEMORY;

  let clientPromise: Promise<MemWalClient> | null = null;
  const client = (): Promise<MemWalClient> => {
    if (injected) return Promise.resolve(injected);
    if (!clientPromise) clientPromise = loadMemWalClient(config!);
    return clientPromise;
  };

  return {
    enabled: true,
    async health() {
      try {
        await (await client()).health();
        return true;
      } catch {
        return false;
      }
    },
    async remember(text, o = {}) {
      const c = await client();
      const job = await c.remember(text);
      if (o.wait) await c.waitForRememberJob(job.job_id);
      return { jobId: job.job_id };
    },
    async recall(query, o = {}) {
      const c = await client();
      const res = await c.recall({ query });
      const hits = (res.results ?? []).map(r => ({ text: r.text ?? r.content ?? "", score: r.score }));
      const filtered = hits.filter(h => h.text.length > 0);
      return typeof o.limit === "number" ? filtered.slice(0, o.limit) : filtered;
    },
  };
}

let shared: FinancialMemory | null = null;
/** Process-wide memory instance (reuses one relayer client). */
export function getMemory(): FinancialMemory {
  return (shared ??= createMemory());
}
/** Test-only: reset the shared instance. */
export function resetSharedMemory(): void {
  shared = null;
}

/** Render a financial record/decision into a compact, recall-friendly memory string. */
export function formatRecordMemory(input: {
  recordType: string;
  amount: string;
  counterparty?: string | null;
  purpose?: string | null;
  actorType?: "human" | "agent";
  actorId?: string | null;
  status?: string | null;
  policyId?: string | null;
  objectId?: string | null;
  atMs?: number;
}): string {
  const date = new Date(input.atMs ?? Date.now()).toISOString().slice(0, 10);
  const parts = [
    input.recordType,
    input.amount,
    input.counterparty ? `to ${input.counterparty}` : null,
    input.purpose ? `for ${input.purpose}` : null,
    `on ${date}`,
    input.actorType ? `by ${input.actorType}${input.actorId ? ` ${input.actorId}` : ""}` : null,
    input.status ? `— ${input.status}` : null,
    input.policyId ? `under policy ${input.policyId}` : null,
    input.objectId ? `(record ${input.objectId})` : null,
  ].filter(Boolean);
  return parts.join(" ");
}
