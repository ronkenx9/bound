import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLedgerMcpServer } from "./agent/mcp.js";
import { createAgentOps } from "./agent/operations.js";
import { getRuntimeConfig } from "./config.js";

// MCP runs over stdio: the client launches this process, so the trust boundary
// is "whoever can start it". It binds to the configured owner's Ledger instance.
const ownerAddress = getRuntimeConfig().suiOwnerAddress;
const server = createLedgerMcpServer(createAgentOps(ownerAddress));

const transport = new StdioServerTransport();
await server.connect(transport);

// stdout is the MCP channel; log to stderr only.
process.stderr.write(`ledger mcp server ready (owner ${ownerAddress})\n`);
