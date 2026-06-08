import { sendAlertProbe } from "./ops/alerts.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sendsRedactedProbeToConfiguredWebhook() {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const result = await sendAlertProbe({
    url: "https://alerts.example.test/hook",
    token: "alert-token",
    now: () => "2026-06-08T00:00:00.000Z",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    },
  });

  assert(result.ok === true, "expected alert probe to pass");
  assert(result.status === 202, "expected response status");
  assert(requests.length === 1, "expected one webhook request");
  assert(requests[0]!.url === "https://alerts.example.test/hook", "expected configured webhook URL");
  assert(requests[0]!.init.method === "POST", "expected POST");
  assert((requests[0]!.init.headers as Record<string, string>)["authorization"] === "Bearer alert-token", "expected bearer auth");

  const body = JSON.parse(String(requests[0]!.init.body)) as Record<string, any>;
  assert(body.source === "bound", "expected Bound source");
  assert(body.event === "bound_alert_probe", "expected probe event");
  assert(body.level === "error", "expected production-alert level");
  assert(body.probe === true, "expected probe marker");
  assert(body.token === "[redacted]", "expected probe payload redaction");
}

async function failsWhenWebhookIsMissing() {
  const result = await sendAlertProbe({
    url: "",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });

  assert(result.ok === false, "expected missing webhook to fail");
  assert(result.error === "LEDGER_ALERT_WEBHOOK_URL is required", "expected missing webhook error");
}

async function failsOnNonTwoHundredResponse() {
  const result = await sendAlertProbe({
    url: "https://alerts.example.test/hook",
    fetchImpl: async () => new Response("denied", { status: 401 }),
  });

  assert(result.ok === false, "expected bad status to fail");
  assert(result.status === 401, "expected response status");
  assert(/denied/.test(result.error ?? ""), "expected response body in error");
}

await sendsRedactedProbeToConfiguredWebhook();
await failsWhenWebhookIsMissing();
await failsOnNonTwoHundredResponse();

console.log("Alert smoke tests passed.");
