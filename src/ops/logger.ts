import { secret } from "../secrets.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(event: string, context?: Record<string, unknown>): void;
  info(event: string, context?: Record<string, unknown>): void;
  warn(event: string, context?: Record<string, unknown>, error?: unknown): void;
  error(event: string, context?: Record<string, unknown>, error?: unknown): void;
}

export type AlertSink = (entry: Record<string, unknown>) => void;

interface LoggerOptions {
  sink?: (line: string) => void;
  alertSink?: AlertSink | null;
  now?: () => string;
}

const SECRET_PATTERN = /(private[_-]?key|secret|token|password|api[_-]?key|authorization)/i;

function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, innerValue] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_PATTERN.test(key) ? "[redacted]" : redact(innerValue);
  }
  return output;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? (line => console.log(line));
  const alertSink = options.alertSink === undefined ? createWebhookAlertSink() : options.alertSink;
  const now = options.now ?? (() => new Date().toISOString());

  function write(level: LogLevel, event: string, context: Record<string, unknown> = {}, error?: unknown) {
    const serializedError = serializeError(error);
    const entry = {
      ts: now(),
      level,
      event,
      ...redact(context) as Record<string, unknown>,
      ...(serializedError ? { error: redact(serializedError) } : {}),
    };

    sink(JSON.stringify(entry));
    if (level === "error") {
      alertSink?.(entry);
    }
  }

  return {
    debug: (event, context) => write("debug", event, context),
    info: (event, context) => write("info", event, context),
    warn: (event, context, error) => write("warn", event, context, error),
    error: (event, context, error) => write("error", event, context, error),
  };
}

export const logger = createLogger();

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function createWebhookAlertSink(): AlertSink | null {
  const url = env("LEDGER_ALERT_WEBHOOK_URL");
  if (!url) return null;

  return entry => {
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret("LEDGER_ALERT_WEBHOOK_TOKEN")
          ? { authorization: `Bearer ${secret("LEDGER_ALERT_WEBHOOK_TOKEN")}` }
          : {}),
      },
      body: JSON.stringify({
        source: "ledger",
        ...entry,
      }),
    }).catch(() => {
      // Alert delivery must never break Ledger's primary control flow.
    });
  };
}
