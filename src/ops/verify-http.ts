import { secret } from "../secrets.js";

export interface VerifyHttpSmokeOptions {
  baseUrl?: string | null;
  objectId?: string | null;
  token?: string | null;
  fetchImpl?: typeof fetch;
}

export interface VerifyHttpSmokeResult {
  ok: boolean;
  status?: number;
  objectId?: string;
  error?: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export async function smokeVerifyHttp(options: VerifyHttpSmokeOptions = {}): Promise<VerifyHttpSmokeResult> {
  const baseUrl = options.baseUrl === undefined
    ? env("LEDGER_VERIFY_SMOKE_BASE_URL") ?? env("LEDGER_BASE_URL")
    : options.baseUrl;
  const objectId = options.objectId === undefined ? env("LEDGER_VERIFY_SMOKE_OBJECT_ID") : options.objectId;

  if (!baseUrl || baseUrl.trim().length === 0) {
    return { ok: false, error: "verify smoke base URL is required" };
  }
  if (!objectId || objectId.trim().length === 0) {
    return { ok: false, error: "verify smoke object id is required" };
  }

  const token = options.token === undefined ? secret("LEDGER_VERIFY_AUTH_TOKEN") : options.token;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${normalizeBaseUrl(baseUrl)}/verify/${encodeURIComponent(objectId)}`;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const body = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Verify route returned ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
      };
    }

    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed["ok"] !== true) {
      return { ok: false, status: response.status, error: "verify response ok was not true" };
    }
    if (parsed["objectId"] !== objectId) {
      return { ok: false, status: response.status, error: "verify response object id mismatch" };
    }
    if (
      typeof parsed["expectedContentHash"] === "string"
      && typeof parsed["actualContentHash"] === "string"
      && parsed["expectedContentHash"] !== parsed["actualContentHash"]
    ) {
      return { ok: false, status: response.status, objectId, error: "verify response hash mismatch" };
    }

    return { ok: true, status: response.status, objectId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
