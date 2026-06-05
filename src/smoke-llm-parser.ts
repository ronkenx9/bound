import "dotenv/config";
import { runLlmParserSmoke } from "./parsing/llm-smoke.js";
import { callOpenAiParser } from "./parsing/parser.js";
import { secret } from "./secrets.js";

const apiKey = secret("LEDGER_LLM_API_KEY") ?? secret("BANKR_LLM_KEY") ?? secret("OPENAI_API_KEY");
if (!apiKey) {
  throw new Error("An LLM API key is required for live LLM parser smoke (LEDGER_LLM_API_KEY, BANKR_LLM_KEY, or OPENAI_API_KEY)");
}

const baseUrl = process.env["LEDGER_LLM_BASE_URL"] ?? process.env["BANKR_LLM_BASE_URL"] ?? "https://api.openai.com/v1";
const model = process.env["LEDGER_LLM_MODEL"] ?? process.env["OPENAI_PARSER_MODEL"] ?? "gpt-4o-mini";

const result = await runLlmParserSmoke(async input => ({
  ...(await callOpenAiParser(input)),
  parserSource: "llm",
}));
console.log(JSON.stringify({
  ok: result.ok,
  provider: baseUrl,
  model,
  parserSource: result.record.parserSource,
  recordType: result.record.recordType,
  amountNgn: result.record.amountNgn,
  currency: result.record.currency,
  confidence: result.record.confidence,
}, null, 2));
