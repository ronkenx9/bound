process.env["LEDGER_MOCK"] = "true";
process.env["SUI_PRIVATE_KEY"] = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env["SUI_OWNER_ADDRESS"] = "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba";
process.env["LEDGER_DB_PATH"] = ":memory:";

import type { ContentBuilder, Message } from "spectrum-ts";
import { getMonthlySummary, getParserFeedback, resetDbForTests } from "./db.js";
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

const promptReplies = await collectReplies(createMockMessage("low-confidence-1", "instruction pay supplier later"));
assert(promptReplies.some(reply => /Not sure I understood/.test(reply)), "expected low-confidence confirmation prompt");

const confirmReplies = await collectReplies(createMockMessage("low-confidence-2", "yes"));
assert(confirmReplies.some(reply => /Record saved successfully/.test(reply)), `expected confirmed low-confidence record to save, got ${confirmReplies.join(" | ")}`);

const yearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
const summary = getMonthlySummary(yearMonth);
assert(summary.records.length === 1, `expected one saved low-confidence record, got ${summary.records.length}`);
assert(summary.records[0]?.recordType === "instruction", "expected confirmed low-confidence instruction record");

const feedback = getParserFeedback(10);
assert(feedback.length === 1, `expected one parser feedback row, got ${feedback.length}`);
assert(feedback[0]?.outcome === "confirmed", `expected confirmed feedback, got ${feedback[0]?.outcome}`);
assert(feedback[0]?.confidence === 0.5, `expected feedback confidence 0.5, got ${feedback[0]?.confidence}`);
assert(feedback[0]?.parserSource === "deterministic", `expected deterministic parser source, got ${feedback[0]?.parserSource}`);

console.log("Parser feedback tests passed.");
