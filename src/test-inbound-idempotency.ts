process.env["LEDGER_MOCK"] = "true";
process.env["SUI_PRIVATE_KEY"] = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env["SUI_OWNER_ADDRESS"] = "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba";
process.env["LEDGER_DB_PATH"] = ":memory:";

import type { ContentBuilder, Message } from "spectrum-ts";
import { resetDbForTests, getMonthlySummary } from "./db.js";
import { handleMessage } from "./handler.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createMockMessage(id: string, text: string): Message {
  return {
    id,
    content: [{ type: "plain_text", text }],
    platform: "terminal",
    sender: { __platform: "terminal", id: "user-1" },
    space: {
      __platform: "terminal",
      id: "space-1",
      responding: async fn => fn(),
      send: async () => {},
      startTyping: async () => {},
      stopTyping: async () => {},
    },
    timestamp: new Date(),
    react: async () => {},
    reply: async () => {},
  };
}

async function collectReplies(message: Message): Promise<string[]> {
  const replies: string[] = [];
  const reply = async (...content: [ContentBuilder, ...ContentBuilder[]]) => {
    for (const item of content) {
      const built = await item.build();
      if (built.type === "plain_text") replies.push(built.text);
    }
  };

  await handleMessage(reply, message);
  return replies;
}

resetDbForTests();

const firstReplies = await collectReplies(createMockMessage("platform-msg-1", "pay N50,000 to Emeka for fuel"));
const secondReplies = await collectReplies(createMockMessage("platform-msg-1", "pay N50,000 to Emeka for fuel"));
const summary = getMonthlySummary(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);

assert(firstReplies.some(reply => /Record saved/.test(reply)), "expected first delivery to save a record");
assert(secondReplies.length === 0, `expected duplicate delivery to be ignored silently, got ${secondReplies.join(" | ")}`);
assert(summary.records.length === 1, `expected one record after duplicate platform delivery, got ${summary.records.length}`);

console.log("Inbound idempotency tests passed.");
