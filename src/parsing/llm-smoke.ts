import { parseMessage, type ParsedRecord } from "./parser.js";

export const LLM_SMOKE_INPUT = "Debit alert: NGN 18,750 paid to Jumia for printer ink";

export interface LlmParserSmokeResult {
  ok: true;
  input: string;
  record: ParsedRecord;
}

export function validateLlmSmokeRecord(record: ParsedRecord) {
  if (record.parserSource !== "llm") {
    throw new Error(`Expected parserSource "llm", got "${record.parserSource ?? "missing"}"`);
  }
  if (record.recordType !== "payment_out") {
    throw new Error(`Expected payment_out, got "${record.recordType}"`);
  }
  if (record.currency !== "NGN") {
    throw new Error(`Expected NGN currency, got "${record.currency}"`);
  }
  if (record.amountNgn !== 18750) {
    throw new Error(`Expected amountNgn 18750, got "${record.amountNgn}"`);
  }
  if (record.confidence < 0 || record.confidence > 1) {
    throw new Error(`Expected confidence between 0 and 1, got "${record.confidence}"`);
  }
  if (!record.summary.trim()) {
    throw new Error("Expected non-empty summary");
  }
}

export async function runLlmParserSmoke(
  parser: (input: string) => Promise<ParsedRecord> = input => parseMessage(input, { useLlm: true }),
  input = LLM_SMOKE_INPUT,
): Promise<LlmParserSmokeResult> {
  const record = await parser(input);
  validateLlmSmokeRecord(record);
  return { ok: true, input, record };
}
