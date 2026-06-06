import "dotenv/config";
import { startAgentServer } from "./agent/server.js";

const portRaw = process.env["LEDGER_AGENT_PORT"] ?? "8788";
const port = Number.parseInt(portRaw, 10);

if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`LEDGER_AGENT_PORT must be a valid TCP port; received "${portRaw}"`);
}

await startAgentServer(port);
