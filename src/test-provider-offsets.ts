process.env["LEDGER_MOCK"] = "true";
process.env["LEDGER_DB_PATH"] = ":memory:";

export {};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const {
  getProviderOffset,
  listProviderOffsets,
  resetDbForTests,
  upsertProviderOffset,
} = await import("./db.js");
const { checkpointMessageOffset } = await import("./provider-offsets.js");

resetDbForTests();

assert(getProviderOffset("iMessage", "chat-1") === undefined, "expected missing provider offset to be undefined");

upsertProviderOffset({
  platform: "iMessage",
  spaceId: "chat-1",
  cursor: "message-guid-1",
  messageId: "message-guid-1",
  messageTimestampMs: 1_783_123_456_000,
  updatedAtMs: 1_783_123_456_100,
});

const first = getProviderOffset("iMessage", "chat-1");
assert(first, "expected provider offset after insert");
assert(first.platform === "iMessage", "expected platform to be preserved");
assert(first.spaceId === "chat-1", "expected space id to be preserved");
assert(first.cursor === "message-guid-1", "expected cursor to be preserved");
assert(first.messageId === "message-guid-1", "expected message id to be preserved");
assert(first.messageTimestampMs === 1_783_123_456_000, "expected message timestamp to be preserved");
assert(first.updatedAtMs === 1_783_123_456_100, "expected update time to be preserved");

upsertProviderOffset({
  platform: "iMessage",
  spaceId: "chat-1",
  cursor: "message-guid-2",
  messageId: "message-guid-2",
  messageTimestampMs: 1_783_123_456_500,
  updatedAtMs: 1_783_123_456_600,
});

const updated = getProviderOffset("iMessage", "chat-1");
assert(updated?.cursor === "message-guid-2", "expected cursor to update for same provider space");
assert(updated?.messageId === "message-guid-2", "expected message id to update for same provider space");
assert(updated?.messageTimestampMs === 1_783_123_456_500, "expected timestamp to update for same provider space");
assert(updated?.updatedAtMs === 1_783_123_456_600, "expected updatedAt to update for same provider space");

upsertProviderOffset({
  platform: "terminal",
  spaceId: "terminal",
  cursor: "terminal-message-1",
  messageId: "terminal-message-1",
  messageTimestampMs: 1_783_123_457_000,
  updatedAtMs: 1_783_123_457_100,
});

const all = listProviderOffsets();
assert(all.length === 2, `expected two provider offsets, got ${all.length}`);
assert(all.some(offset => offset.platform === "iMessage" && offset.spaceId === "chat-1"), "expected iMessage offset in list");
assert(all.some(offset => offset.platform === "terminal" && offset.spaceId === "terminal"), "expected terminal offset in list");

checkpointMessageOffset({
  id: "runtime-message-1",
  platform: "iMessage",
  space: { id: "runtime-chat" },
  timestamp: new Date(1_783_123_458_000),
});

const runtimeOffset = getProviderOffset("iMessage", "runtime-chat");
assert(runtimeOffset?.cursor === "runtime-message-1", "expected runtime checkpoint to use message id as default cursor");
assert(runtimeOffset?.messageTimestampMs === 1_783_123_458_000, "expected runtime checkpoint timestamp");

checkpointMessageOffset({
  id: "runtime-message-2",
  platform: "custom-provider",
  space: { id: "runtime-chat-2" },
  cursor: "provider-cursor-2",
  timestamp: new Date(1_783_123_459_000),
});

const customOffset = getProviderOffset("custom-provider", "runtime-chat-2");
assert(customOffset?.cursor === "provider-cursor-2", "expected runtime checkpoint to prefer provider cursor when present");
assert(customOffset?.messageId === "runtime-message-2", "expected runtime checkpoint to preserve message id");

console.log("Provider offset tests passed.");
