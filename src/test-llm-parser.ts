import {
  buildParserResponseSchema,
  callOpenAiParser,
  parseMessage,
  parseMessageWithLlm,
  type LlmParserClient,
  type ParsedRecord,
} from "./parsing/parser.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const validLlmRecord: ParsedRecord = {
  recordType: "payment_out",
  amountNgn: 185000,
  amountMist: null,
  currency: "NGN",
  counterparty: "SolarWorks",
  recipientAddress: null,
  purpose: "inverter battery",
  confidence: 0.91,
  summary: "Payment of N185,000 with SolarWorks for inverter battery",
};

async function validLlmExtractionIsUsed() {
  const client: LlmParserClient = async () => validLlmRecord;
  const parsed = await parseMessageWithLlm("Transfer made to vendor for inverter battery", client);

  assert(parsed.amountNgn === 185000, "expected LLM amount");
  assert(parsed.counterparty === "SolarWorks", "expected LLM counterparty");
  assert(parsed.parserSource === "llm", "expected parserSource llm");
}

async function invalidLlmFallsBackToDeterministicParser() {
  const client: LlmParserClient = async () => ({
    ...validLlmRecord,
    amountNgn: -1,
    confidence: 2,
  });
  const parsed = await parseMessageWithLlm("pay N50,000 to Emeka for fuel", client);

  assert(parsed.amountNgn === 50000, "expected deterministic fallback amount");
  assert(parsed.counterparty === "Emeka", "expected deterministic fallback counterparty");
  assert(parsed.parserSource === "deterministic", "expected parserSource deterministic");
}

async function parseMessageCanAcceptInjectedLlmClient() {
  const parsed = await parseMessage("settled supplier invoice", {
    llmClient: async () => validLlmRecord,
  });

  assert(parsed.parserSource === "llm", "expected parseMessage to use injected LLM client");
}

function structuredOutputSchemaIsStrict() {
  const schema = buildParserResponseSchema();
  assert(schema.type === "json_schema", "expected json_schema structured output");
  assert(schema.strict === true, "expected strict schema");
  assert(schema.schema.required.includes("recordType"), "expected required recordType");
  assert(schema.schema.required.includes("confidence"), "expected required confidence");
}

async function openAiParserErrorIncludesSanitizedBody() {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env["OPENAI_API_KEY"];
  process.env["OPENAI_API_KEY"] = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      type: "invalid_request_error",
      code: "invalid_api_key",
      message: "Incorrect API key provided: sk-secret_test_key_here",
    },
  }), { status: 401 });

  try {
    await callOpenAiParser("pay N50,000 to Emeka for fuel");
  } catch (err) {
    assert(err instanceof Error, "expected Error");
    assert(/401/.test(err.message), "expected status code in error");
    assert(/invalid_api_key/.test(err.message), "expected API error code in error");
    assert(!/sk-secret/.test(err.message), "expected API-key-like value to be redacted");
    return;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env["OPENAI_API_KEY"];
    } else {
      process.env["OPENAI_API_KEY"] = originalApiKey;
    }
  }

  throw new Error("expected OpenAI parser error");
}

await validLlmExtractionIsUsed();
await invalidLlmFallsBackToDeterministicParser();
await parseMessageCanAcceptInjectedLlmClient();
structuredOutputSchemaIsStrict();
await openAiParserErrorIncludesSanitizedBody();

console.log("LLM parser tests passed.");
