import "dotenv/config";
import { smokeVerifyHttp } from "./ops/verify-http.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

const result = await smokeVerifyHttp({
  baseUrl: arg("base-url"),
  objectId: arg("object-id"),
});

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
