import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export interface StorageSmokeOptions {
  databasePath?: string | null;
  marker?: string;
}

export interface StorageSmokeResult {
  ok: boolean;
  databasePath?: string;
  reopened?: boolean;
  error?: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveDatabasePath(databasePath: string | null | undefined): string | undefined {
  return databasePath === undefined ? env("LEDGER_DB_PATH") : databasePath ?? undefined;
}

export function smokePersistentStorage(options: StorageSmokeOptions = {}): StorageSmokeResult {
  const databasePath = resolveDatabasePath(options.databasePath);
  if (!databasePath || databasePath.trim().length === 0) {
    return { ok: false, error: "LEDGER_DB_PATH is required" };
  }
  if (databasePath === ":memory:") {
    return { ok: false, databasePath, error: "LEDGER_DB_PATH must be a persistent file path" };
  }

  const resolvedPath = path.resolve(databasePath);
  const parent = path.dirname(resolvedPath);
  if (!fs.existsSync(parent)) {
    return { ok: false, databasePath: resolvedPath, error: `parent directory does not exist: ${parent}` };
  }

  const marker = options.marker ?? `storage-smoke-${Date.now()}`;
  try {
    fs.accessSync(parent, fs.constants.R_OK | fs.constants.W_OK);

    const db = new Database(resolvedPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS _storage_smoke (
        marker TEXT PRIMARY KEY,
        createdAtMs INTEGER NOT NULL
      )
    `);
    db.prepare("INSERT OR REPLACE INTO _storage_smoke(marker, createdAtMs) VALUES (?, ?)").run(marker, Date.now());
    db.close();

    const reopened = new Database(resolvedPath);
    const row = reopened.prepare("SELECT marker FROM _storage_smoke WHERE marker = ?").get(marker) as { marker: string } | undefined;
    reopened.prepare("DELETE FROM _storage_smoke WHERE marker = ?").run(marker);
    reopened.close();

    if (row?.marker !== marker) {
      return { ok: false, databasePath: resolvedPath, reopened: true, error: "storage marker was not durable after reopen" };
    }

    return { ok: true, databasePath: resolvedPath, reopened: true };
  } catch (error) {
    return {
      ok: false,
      databasePath: resolvedPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
