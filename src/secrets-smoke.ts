import "dotenv/config";
import { checkProductionSecrets, DEFAULT_PRODUCTION_SECRETS } from "./ops/secret-smoke.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

const names = arg("names")?.split(",").map(name => name.trim()).filter(Boolean);
const allowPlainEnv = process.argv.includes("--allow-plain-env");
const result = checkProductionSecrets({
  required: names && names.length > 0 ? names : DEFAULT_PRODUCTION_SECRETS,
  requireCommandBacked: !allowPlainEnv,
});

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
