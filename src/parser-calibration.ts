import { calibrateParserThreshold, DEFAULT_PARSER_CONFIDENCE_THRESHOLD } from "./parsing/calibration.js";

const result = calibrateParserThreshold([
  {
    name: "clear outgoing payment",
    expectedAccept: true,
    parsed: {
      recordType: "payment_out",
      amountNgn: 50_000,
      amountMist: null,
      currency: "NGN",
      counterparty: "Emeka",
      recipientAddress: null,
      purpose: "fuel",
      confidence: 0.95,
      summary: "Payment of N50,000 with Emeka for fuel",
      parserSource: "deterministic",
    },
  },
  {
    name: "clear incoming payment",
    expectedAccept: true,
    parsed: {
      recordType: "payment_in",
      amountNgn: 120_000,
      amountMist: null,
      currency: "NGN",
      counterparty: "Ada",
      recipientAddress: null,
      purpose: "deposit",
      confidence: 0.91,
      summary: "Receipt of N120,000 from Ada",
      parserSource: "deterministic",
    },
  },
  {
    name: "instruction without amount needs confirmation",
    expectedAccept: false,
    parsed: {
      recordType: "instruction",
      amountNgn: null,
      amountMist: null,
      currency: "NGN",
      counterparty: null,
      recipientAddress: null,
      purpose: "policy",
      confidence: 0.5,
      summary: "Instruction",
      parserSource: "deterministic",
    },
  },
  {
    name: "ambiguous evidence needs confirmation",
    expectedAccept: false,
    parsed: {
      recordType: "evidence",
      amountNgn: null,
      amountMist: null,
      currency: "NGN",
      counterparty: null,
      recipientAddress: null,
      purpose: "receipt",
      confidence: 0.59,
      summary: "Evidence with unspecified amount",
      parserSource: "deterministic",
    },
  },
]);

console.log(JSON.stringify({
  currentThreshold: DEFAULT_PARSER_CONFIDENCE_THRESHOLD,
  ...result,
}, null, 2));
