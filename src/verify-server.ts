import "dotenv/config";
import { startVerifyServer } from "./verify/server.js";

const portRaw = process.env["LEDGER_VERIFY_PORT"] ?? "8787";
const port = Number.parseInt(portRaw, 10);

if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`LEDGER_VERIFY_PORT must be a valid TCP port; received "${portRaw}"`);
}

await startVerifyServer(port);
