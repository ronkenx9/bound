import "dotenv/config";
import { runProductionReadinessChecks } from "./ops/production.js";

const result = await runProductionReadinessChecks();
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
