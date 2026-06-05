import assert from "node:assert";
import { recoverByDigest, type DigestRecoverable } from "./sui/client.js";

type TxResponse = Awaited<ReturnType<DigestRecoverable["getTransactionBlock"]>>;

function successTx(digest: string): TxResponse {
  return {
    digest,
    effects: { status: { status: "success" } },
  } as unknown as TxResponse;
}

function failureTx(digest: string): TxResponse {
  return {
    digest,
    effects: { status: { status: "failure", error: "MoveAbort" } },
  } as unknown as TxResponse;
}

function makeClient(behavior: (call: number) => TxResponse | "throw"): {
  client: DigestRecoverable;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    client: {
      async getTransactionBlock() {
        calls += 1;
        const outcome = behavior(calls);
        if (outcome === "throw") throw new Error("not found");
        return outcome;
      },
    },
  };
}

async function run() {
  // 1. A transaction that landed despite an ambiguous submit error is recovered.
  {
    const { client, calls } = makeClient(() => successTx("DIGEST_A"));
    const result = await recoverByDigest(client, "DIGEST_A", { baseIntervalMs: 1 });
    assert.ok(result, "expected a recovered result");
    assert.strictEqual(result.digest, "DIGEST_A");
    assert.strictEqual(calls(), 1, "should return on first successful lookup");
  }

  // 2. Not-found-then-found: keeps polling until the tx is indexed.
  {
    const { client, calls } = makeClient(call => (call < 3 ? "throw" : successTx("DIGEST_B")));
    const result = await recoverByDigest(client, "DIGEST_B", { attempts: 5, baseIntervalMs: 1 });
    assert.ok(result, "expected recovery after retries");
    assert.strictEqual(result.digest, "DIGEST_B");
    assert.strictEqual(calls(), 3, "should poll until found");
  }

  // 3. A transaction confirmed failed on-chain returns null immediately (no false recovery).
  {
    const { client, calls } = makeClient(() => failureTx("DIGEST_C"));
    const result = await recoverByDigest(client, "DIGEST_C", { baseIntervalMs: 1 });
    assert.strictEqual(result, null, "failed tx must not be recovered as success");
    assert.strictEqual(calls(), 1, "should stop on confirmed failure");
  }

  // 4. A genuinely absent transaction returns null after exhausting attempts.
  {
    const { client, calls } = makeClient(() => "throw");
    const result = await recoverByDigest(client, "DIGEST_D", { attempts: 4, baseIntervalMs: 1 });
    assert.strictEqual(result, null, "absent tx must resolve to null");
    assert.strictEqual(calls(), 4, "should exhaust all attempts");
  }

  console.log("Digest recovery tests passed.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
