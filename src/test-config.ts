import { getOptionalConfig } from "./config.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

withEnv({
  WALRUS_SDK_TIMEOUT_MS: undefined,
  WALRUS_UPLOAD_RELAY_URL: undefined,
  WALRUS_UPLOAD_RELAY_TIP_MAX_MIST: undefined,
  WALRUS_SDK_LOG_NODE_ERRORS: undefined,
}, () => {
  const config = getOptionalConfig();
  assert(config.walrusSdkTimeoutMs === 60_000, "expected default SDK timeout to be 60s");
  assert(config.walrusUploadRelayUrl === null, "expected upload relay to default to null");
  assert(config.walrusUploadRelayTipMaxMist === null, "expected upload relay tip to default to null");
  assert(config.walrusSdkLogNodeErrors === false, "expected node error logging to default off");
});

withEnv({
  WALRUS_SDK_TIMEOUT_MS: "90000",
  WALRUS_UPLOAD_RELAY_URL: "https://upload-relay.testnet.walrus.space",
  WALRUS_UPLOAD_RELAY_TIP_MAX_MIST: "1000",
  WALRUS_SDK_LOG_NODE_ERRORS: "true",
}, () => {
  const config = getOptionalConfig();
  assert(config.walrusSdkTimeoutMs === 90_000, "expected SDK timeout override");
  assert(config.walrusUploadRelayUrl === "https://upload-relay.testnet.walrus.space", "expected relay URL override");
  assert(config.walrusUploadRelayTipMaxMist === 1_000, "expected relay tip override");
  assert(config.walrusSdkLogNodeErrors === true, "expected node error logging override");
});

withEnv({ WALRUS_SDK_TIMEOUT_MS: "0" }, () => {
  try {
    getOptionalConfig();
  } catch (err) {
    assert(err instanceof Error, "expected Error for invalid SDK timeout");
    assert(/WALRUS_SDK_TIMEOUT_MS/.test(err.message), "expected timeout env name in error");
    return;
  }
  throw new Error("expected invalid SDK timeout to throw");
});

withEnv({ WALRUS_UPLOAD_RELAY_TIP_MAX_MIST: "-1" }, () => {
  try {
    getOptionalConfig();
  } catch (err) {
    assert(err instanceof Error, "expected Error for invalid relay tip");
    assert(/WALRUS_UPLOAD_RELAY_TIP_MAX_MIST/.test(err.message), "expected relay tip env name in error");
    return;
  }
  throw new Error("expected invalid relay tip to throw");
});

console.log("Config test passed.");
