import { createLogger } from "./ops/logger.js";
import { retry } from "./ops/retry.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function structuredLoggerRedactsSecrets() {
  const lines: string[] = [];
  const logger = createLogger({
    sink: line => lines.push(line),
    now: () => "2026-06-05T00:00:00.000Z",
  });

  logger.error("payment_failed", {
    actionId: "action_1",
    SUI_PRIVATE_KEY: "suiprivkey-secret",
    nested: { password: "hidden", ok: true },
  }, new Error("boom"));

  assert(lines.length === 1, "expected one log line");
  const entry = JSON.parse(lines[0]!) as Record<string, any>;
  assert(entry["level"] === "error", "expected error level");
  assert(entry["event"] === "payment_failed", "expected event name");
  assert(entry["actionId"] === "action_1", "expected context field");
  assert(entry["SUI_PRIVATE_KEY"] === "[redacted]", "expected private key redaction");
  assert(entry["nested"].password === "[redacted]", "expected nested secret redaction");
  assert(entry["error"].message === "boom", "expected error message");
}

function errorLogsEmitRedactedAlerts() {
  const alerts: Array<Record<string, any>> = [];
  const logger = createLogger({
    sink: () => {},
    alertSink: entry => alerts.push(entry),
    now: () => "2026-06-05T00:00:00.000Z",
  });

  logger.info("normal_event", { token: "do-not-alert" });
  logger.error("critical_failure", { token: "secret-token", objectId: "0xabc" }, new Error("bad"));

  assert(alerts.length === 1, `expected one alert, got ${alerts.length}`);
  assert(alerts[0]!["event"] === "critical_failure", "expected error event alert");
  assert(alerts[0]!["token"] === "[redacted]", "expected alert redaction");
  assert(alerts[0]!["objectId"] === "0xabc", "expected safe context in alert");
  assert(alerts[0]!["error"].message === "bad", "expected error in alert");
}

async function retryBacksOffAndLogs() {
  const events: string[] = [];
  const delays: number[] = [];
  const logger = createLogger({
    sink: line => events.push((JSON.parse(line) as Record<string, string>)["event"]!),
    now: () => "2026-06-05T00:00:00.000Z",
  });

  let attempts = 0;
  const result = await retry(
    "sui_read",
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary");
      return "ok";
    },
    {
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep: async delay => { delays.push(delay); },
      logger,
    },
  );

  assert(result === "ok", "expected retry result");
  assert(attempts === 3, `expected three attempts, got ${attempts}`);
  assert(delays.join(",") === "10,20", `expected exponential delays, got ${delays.join(",")}`);
  assert(events.filter(event => event === "retry_attempt_failed").length === 2, "expected retry failure logs");
  assert(events.includes("retry_succeeded"), "expected retry success log");
}

structuredLoggerRedactsSecrets();
errorLogsEmitRedactedAlerts();
await retryBacksOffAndLogs();

console.log("Ops tests passed.");
