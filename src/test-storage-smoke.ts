import os from "os";
import path from "path";
import { mkdtempSync, rmSync } from "fs";
import { smokePersistentStorage } from "./ops/storage-smoke.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "bound-storage-smoke-"));

try {
  const dbPath = path.join(tempDir, "bound.db");
  const result = smokePersistentStorage({ databasePath: dbPath, marker: "marker-1" });
  assert(result.ok === true, "expected persistent storage smoke to pass");
  assert(result.databasePath === dbPath, "expected database path");
  assert(result.reopened === true, "expected close/reopen proof");

  const missing = smokePersistentStorage({ databasePath: "", marker: "marker-2" });
  assert(missing.ok === false, "expected missing database path to fail");
  assert(missing.error === "LEDGER_DB_PATH is required", "expected missing path error");

  const memory = smokePersistentStorage({ databasePath: ":memory:", marker: "marker-3" });
  assert(memory.ok === false, "expected in-memory path to fail");
  assert(memory.error === "LEDGER_DB_PATH must be a persistent file path", "expected persistent path error");

  const badParent = smokePersistentStorage({
    databasePath: path.join(tempDir, "missing", "bound.db"),
    marker: "marker-4",
  });
  assert(badParent.ok === false, "expected missing parent to fail");
  assert(/parent directory does not exist/.test(badParent.error ?? ""), "expected parent directory error");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("Storage smoke tests passed.");
