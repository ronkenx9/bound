import { runLlmParserSmoke, validateLlmSmokeRecord } from "./parsing/llm-smoke.js";
import type { ParsedRecord } from "./parsing/parser.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const validRecord: ParsedRecord = {
  recordType: "payment_out",
  amountNgn: 18750,
  amountMist: null,
  currency: "NGN",
  counterparty: "Jumia",
  recipientAddress: null,
  purpose: "printer ink",
  confidence: 0.92,
  summary: "Payment of N18,750 with Jumia for printer ink",
  parserSource: "llm",
};

validateLlmSmokeRecord(validRecord);

let failed = false;
try {
  validateLlmSmokeRecord({
    ...validRecord,
    amountNgn: null,
  });
} catch (err) {
  failed = true;
  assert(err instanceof Error, "expected validator error");
  assert(/amountNgn/.test(err.message), "expected amountNgn validation error");
}
assert(failed, "expected invalid smoke record to fail validation");

const smoke = await runLlmParserSmoke(async () => validRecord);
assert(smoke.ok === true, "expected injected smoke parser to pass");
assert(smoke.record.amountNgn === 18750, "expected smoke amount");

console.log("LLM parser smoke tests passed.");
