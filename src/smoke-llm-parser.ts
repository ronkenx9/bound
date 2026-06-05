import "dotenv/config";
import { runLlmParserSmoke } from "./parsing/llm-smoke.js";
import { callOpenAiParser } from "./parsing/parser.js";

if (!process.env["OPENAI_API_KEY"]?.trim()) {
  throw new Error("OPENAI_API_KEY is required for live LLM parser smoke");
}

const result = await runLlmParserSmoke(async input => ({
  ...(await callOpenAiParser(input)),
  parserSource: "llm",
}));
console.log(JSON.stringify({
  ok: result.ok,
  parserSource: result.record.parserSource,
  recordType: result.record.recordType,
  amountNgn: result.record.amountNgn,
  currency: result.record.currency,
  confidence: result.record.confidence,
  model: process.env["OPENAI_PARSER_MODEL"] ?? "gpt-4o-mini",
}, null, 2));
