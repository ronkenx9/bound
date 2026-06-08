import "dotenv/config";
import { sendAlertProbe } from "./ops/alerts.js";

const result = await sendAlertProbe();
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
