import { calibrateParserThreshold, DEFAULT_PARSER_CONFIDENCE_THRESHOLD } from "./parsing/calibration.js";
import { CONFIDENCE_THRESHOLD } from "./handler.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const calibration = calibrateParserThreshold([
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
    },
  },
]);

assert(DEFAULT_PARSER_CONFIDENCE_THRESHOLD === 0.6, "expected default parser threshold to stay at 0.6");
assert(CONFIDENCE_THRESHOLD === DEFAULT_PARSER_CONFIDENCE_THRESHOLD, "expected handler to use calibrated threshold constant");
assert(calibration.recommendedThreshold === 0.6, `expected recommended threshold 0.6, got ${calibration.recommendedThreshold}`);
assert(calibration.falseAccepts === 0, `expected no false accepts, got ${calibration.falseAccepts}`);
assert(calibration.falseRejects === 0, `expected no false rejects, got ${calibration.falseRejects}`);
assert(calibration.total === 4, `expected four calibration samples, got ${calibration.total}`);

const stricter = calibrateParserThreshold([
  {
    name: "borderline valid payment",
    expectedAccept: true,
    parsed: {
      recordType: "payment_out",
      amountNgn: 10_000,
      amountMist: null,
      currency: "NGN",
      counterparty: "Musa",
      recipientAddress: null,
      purpose: "transport",
      confidence: 0.64,
      summary: "Payment of N10,000 with Musa",
    },
  },
  {
    name: "ambiguous low confidence",
    expectedAccept: false,
    parsed: {
      recordType: "payment_out",
      amountNgn: null,
      amountMist: null,
      currency: "NGN",
      counterparty: null,
      recipientAddress: null,
      purpose: null,
      confidence: 0.63,
      summary: "Payment of unspecified amount",
    },
  },
], { candidateThresholds: [0.5, 0.6, 0.64, 0.7] });

assert(stricter.recommendedThreshold === 0.64, `expected highest zero-error threshold 0.64, got ${stricter.recommendedThreshold}`);

console.log("Parser calibration tests passed.");
