import "dotenv/config";
import { createMemory, formatRecordMemory } from "./memory/memwal.js";

const mem = createMemory();

if (!mem.enabled) {
  console.error("MemWal not configured. Set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID in .env");
  process.exit(1);
}

const ok = await mem.health();
console.log(JSON.stringify({ enabled: mem.enabled, health: ok }, null, 2));
if (!ok) {
  console.error("Relayer health check failed — check key/account/serverUrl.");
  process.exit(1);
}

const line = formatRecordMemory({
  recordType: "payment_out", amount: "₦42,000", counterparty: "Emeka", purpose: "fuel",
  actorType: "agent", actorId: "fuel-agent", status: "APPROVED", policyId: "policy_demo", objectId: "0x5cb1dc",
});
console.log("remembering:", line);
const job = await mem.remember(line, { wait: true });
console.log("remembered:", job);

const query = "have I paid Emeka for fuel?";
const hits = await mem.recall(query, { limit: 3 });
console.log(`recall "${query}":`);
for (const h of hits) console.log(`  - ${h.text}${h.score != null ? `  (${h.score.toFixed(2)})` : ""}`);
console.log(hits.length ? "\nMemory smoke OK." : "\nNo hits yet (indexing can lag a few seconds on first write).");
