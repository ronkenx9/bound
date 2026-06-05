import "dotenv/config";
import { runHealthChecks } from "./ops/health.js";

const health = await runHealthChecks();
console.log(JSON.stringify(health, null, 2));

if (!health.ok) {
  process.exitCode = 1;
}
