// Set environment variables for mocking
process.env["LEDGER_MOCK"] = "true";
process.env["SUI_PRIVATE_KEY"] = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env["SUI_OWNER_ADDRESS"] = "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba";
process.env["LEDGER_DB_PATH"] = ":memory:";

import { handleMessage } from "./handler.js";
import type { Message, ContentBuilder } from "spectrum-ts";
import { resetDbForTests } from "./db.js";

resetDbForTests();

// Helper to create a mock Message object
function createMockMessage(text: string): Message {
  return {
    id: `msg-${Math.floor(Math.random() * 100000)}`,
    content: [{ type: "plain_text", text }],
    platform: "terminal",
    sender: { __platform: "terminal", id: "user-1" },
    space: {
      __platform: "terminal",
      id: "space-1",
      responding: async (fn) => fn(),
      send: async () => {},
      startTyping: async () => {},
      stopTyping: async () => {},
    },
    timestamp: new Date(),
    react: async () => {},
    reply: async () => {},
  };
}

// Global array to capture replies
let capturedReplies: string[] = [];

const mockReply = async (...content: [ContentBuilder, ...ContentBuilder[]]) => {
  for (const c of content) {
    // Call build() on ContentBuilder to get raw Content
    const built = await c.build();
    if (built.type === "plain_text") {
      capturedReplies.push(built.text);
    }
  }
};

async function runStep(label: string, textInput: string) {
  console.log(`\n--- Step: ${label} ---`);
  console.log(`Input: "${textInput}"`);
  
  capturedReplies = [];
  const message = createMockMessage(textInput);
  await handleMessage(mockReply, message);
  
  for (const reply of capturedReplies) {
    console.log(`Reply: ${reply}`);
  }
}

async function main() {
  console.log("Starting E2E Verifiable Financial Memory Agent Test...");

  // 1. Log an initial transaction
  await runStep("Record Initial Transaction", "pay N50,000 to Emeka for fuel");

  // 2. Send the exact same transaction again (expect duplicate warning)
  await runStep("Attempt Duplicate Transaction", "pay N50,000 to Emeka for fuel");

  // 3. Confirm the duplicate transaction
  await runStep("Confirm Duplicate", "confirm");

  // 4. Send a correction to the last transaction
  await runStep("Apply Linked Correction", "correction: it was actually N45,000");

  // 5. Generate monthly report
  await runStep("Generate Monthly Report", "generate report");

  // 6. Create an agent policy
  await runStep("Create Agent Policy", "fuel agent can pay Emeka up to N70,000 this week");

  // 7. Agent action inside policy
  await runStep("Approve Agent Action", "fuel agent invoice from Emeka for N62,000 fuel");

  // 8. Agent action outside policy
  await runStep("Reject Agent Action", "fuel agent invoice from Emeka for N120,000 fuel");

  // 9. Revoke policy and confirm future action is rejected
  await runStep("Revoke Agent Policy", "revoke fuel agent");
  await runStep("Reject After Revocation", "fuel agent invoice from Emeka for N40,000 fuel");

  console.log("\nE2E Test Suite Concluded.");
}

main().catch(err => {
  console.error("Fatal E2E test failure:", err);
  process.exit(1);
});
