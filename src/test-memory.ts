import assert from "node:assert";
import { createMemory, formatRecordMemory, type MemWalClient } from "./memory/memwal.js";

function fakeClient(over: Partial<MemWalClient> = {}): MemWalClient & { calls: Record<string, number> } {
  const calls = { health: 0, remember: 0, wait: 0, recall: 0 };
  return {
    calls,
    async health() { calls.health++; return { ok: true }; },
    async remember(_t: string) { calls.remember++; return { job_id: "job_1" }; },
    async waitForRememberJob(_id: string) { calls.wait++; return {}; },
    async recall(_i: { query: string }) {
      calls.recall++;
      return { results: [
        { text: "payment_out ₦42,000 to Emeka for fuel on 2026-06-01 — APPROVED", score: 0.91 },
        { content: "payment_out ₦38,000 to Emeka for fuel on 2026-05-28 — APPROVED", score: 0.88 },
        { text: "" },
      ] };
    },
    ...over,
  };
}

async function run() {
  // 1. Unconfigured -> no-op memory, app keeps working.
  const off = createMemory();
  // (env has no MEMWAL_* in test) — disabled
  if (!process.env["MEMWAL_KEY"] && !process.env["MEMWAL_ACCOUNT_ID"]) {
    assert.strictEqual(off.enabled, false, "should be disabled without config");
    assert.strictEqual(await off.health(), false, "disabled health is false");
    assert.strictEqual(await off.remember("x"), null, "disabled remember is null");
    assert.deepStrictEqual(await off.recall("x"), [], "disabled recall is []");
  }

  // 2. With an injected client -> enabled, real calls.
  const client = fakeClient();
  const mem = createMemory({ client });
  assert.strictEqual(mem.enabled, true, "injected client -> enabled");
  assert.strictEqual(await mem.health(), true, "health true");

  const job = await mem.remember("payment_out ₦42,000 to Emeka", { wait: true });
  assert.strictEqual(job?.jobId, "job_1", "returns job id");
  assert.strictEqual(client.calls.remember, 1, "remember called");
  assert.strictEqual(client.calls.wait, 1, "waited for indexing when wait=true");

  // 3. Recall maps text/content, drops empties, respects limit.
  const hits = await mem.recall("have I paid Emeka for fuel?", { limit: 1 });
  assert.strictEqual(hits.length, 1, "limit respected");
  assert.ok(hits[0]!.text.includes("Emeka"), "hit carries text");
  const all = await mem.recall("emeka");
  assert.strictEqual(all.length, 2, "empty results filtered out");

  // 4. health swallows backend errors -> false.
  const broken = createMemory({ client: fakeClient({ async health() { throw new Error("relayer down"); } }) });
  assert.strictEqual(await broken.health(), false, "health false on error");

  // 5. formatRecordMemory renders a compact, recall-friendly line.
  const line = formatRecordMemory({
    recordType: "payment_out", amount: "₦42,000", counterparty: "Emeka", purpose: "fuel",
    actorType: "agent", actorId: "fuel-agent", status: "APPROVED", policyId: "policy_abc",
    objectId: "0x5cb1dc", atMs: Date.parse("2026-06-06T00:00:00Z"),
  });
  for (const frag of ["payment_out", "₦42,000", "to Emeka", "for fuel", "2026-06-06", "agent fuel-agent", "APPROVED", "policy_abc", "0x5cb1dc"]) {
    assert.ok(line.includes(frag), `memory line should include "${frag}" — got: ${line}`);
  }

  console.log("Memory (MemWal) tests passed.");
}

run().catch(err => { console.error(err); process.exit(1); });
