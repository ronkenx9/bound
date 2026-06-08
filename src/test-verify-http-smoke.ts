import { smokeVerifyHttp } from "./ops/verify-http.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verifiesKnownObjectThroughHttp() {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const result = await smokeVerifyHttp({
    baseUrl: "https://bound.example.test/",
    objectId: "0xabc",
    token: "verify-token",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return Response.json({
        ok: true,
        objectId: "0xabc",
        walrusBlobId: "blob-123",
        expectedContentHash: "hash-1",
        actualContentHash: "hash-1",
      });
    },
  });

  assert(result.ok === true, "expected verify HTTP smoke to pass");
  assert(result.status === 200, "expected response status");
  assert(result.objectId === "0xabc", "expected object id");
  assert(requests.length === 1, "expected one request");
  assert(requests[0]!.url === "https://bound.example.test/verify/0xabc", "expected verify URL");
  assert((requests[0]!.init.headers as Record<string, string>)["authorization"] === "Bearer verify-token", "expected bearer auth");
}

async function failsWithoutObjectId() {
  const result = await smokeVerifyHttp({
    baseUrl: "https://bound.example.test",
    objectId: "",
    fetchImpl: async () => Response.json({ ok: true }),
  });

  assert(result.ok === false, "expected missing object id to fail");
  assert(result.error === "verify smoke object id is required", "expected object id error");
}

async function failsOnNonTwoHundredResponse() {
  const result = await smokeVerifyHttp({
    baseUrl: "https://bound.example.test",
    objectId: "0xabc",
    fetchImpl: async () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 }),
  });

  assert(result.ok === false, "expected bad status to fail");
  assert(result.status === 401, "expected response status");
  assert(/unauthorized/.test(result.error ?? ""), "expected response body in error");
}

async function failsOnHashMismatch() {
  const result = await smokeVerifyHttp({
    baseUrl: "https://bound.example.test",
    objectId: "0xabc",
    fetchImpl: async () => Response.json({
      ok: true,
      objectId: "0xabc",
      expectedContentHash: "hash-1",
      actualContentHash: "hash-2",
    }),
  });

  assert(result.ok === false, "expected hash mismatch to fail");
  assert(result.error === "verify response hash mismatch", "expected hash mismatch error");
}

await verifiesKnownObjectThroughHttp();
await failsWithoutObjectId();
await failsOnNonTwoHundredResponse();
await failsOnHashMismatch();

console.log("Verify HTTP smoke tests passed.");
