import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLedgerMcpServer, type McpMode } from "./agent/mcp.js";
import { createAgentOps } from "./agent/operations.js";
import { getRuntimeConfig } from "./config.js";

// MCP runs over stdio: the client launches this process, so the trust boundary
// is "whoever can start it". It binds to and signs with the configured owner.
const ownerAddress = getRuntimeConfig().suiOwnerAddress;

// Default to the safe "agent" tier: only propose + read are exposed, so an
// agent on the other end can never create/approve/revoke policies and thus can
// never widen its own spending authority. Use owner mode only when the owner
// runs this as their own admin console.
const mode: McpMode = process.env["LEDGER_MCP_MODE"] === "owner" ? "owner" : "agent";
const agentId = process.env["LEDGER_MCP_AGENT_ID"]?.trim() || null;
const minProposalIntervalMs = Number.parseInt(process.env["LEDGER_MCP_MIN_PROPOSAL_INTERVAL_MS"] ?? "0", 10) || 0;

const server = createLedgerMcpServer(createAgentOps(ownerAddress), { mode, agentId, minProposalIntervalMs });

const transport = new StdioServerTransport();
await server.connect(transport);

// stdout is the MCP channel; log to stderr only.
process.stderr.write(
  `ledger mcp server ready (owner ${ownerAddress}, mode=${mode}${agentId ? `, agentId=${agentId}` : ""})\n`,
);
if (mode === "owner") {
  process.stderr.write("warning: owner mode exposes policy create/approve/revoke — run only as the owner, never for an untrusted agent\n");
}
