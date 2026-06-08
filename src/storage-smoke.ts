import "dotenv/config";
import { smokePersistentStorage } from "./ops/storage-smoke.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

const result = smokePersistentStorage({
  databasePath: arg("db-path"),
});

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
