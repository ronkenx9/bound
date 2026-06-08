import { secret } from "../secrets.js";

export interface AlertProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface AlertProbeOptions {
  url?: string | null;
  token?: string | null;
  now?: () => string;
  fetchImpl?: typeof fetch;
}

const SECRET_PATTERN = /(private[_-]?key|secret|token|password|api[_-]?key|authorization)/i;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
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

export async function sendAlertProbe(options: AlertProbeOptions = {}): Promise<AlertProbeResult> {
  const url = options.url === undefined ? env("LEDGER_ALERT_WEBHOOK_URL") : options.url;
  if (!url || url.trim().length === 0) {
    return { ok: false, error: "LEDGER_ALERT_WEBHOOK_URL is required" };
  }

  const token = options.token === undefined ? secret("LEDGER_ALERT_WEBHOOK_TOKEN") : options.token;
  const now = options.now ?? (() => new Date().toISOString());
  const fetchImpl = options.fetchImpl ?? fetch;
  const payload = redact({
    source: "bound",
    ts: now(),
    level: "error",
    event: "bound_alert_probe",
    probe: true,
    token: "probe-secret-must-redact",
  }) as Record<string, unknown>;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        error: `Alert webhook returned ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
      };
    }

    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
