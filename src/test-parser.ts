import { parseMessage, validateParsedRecord } from "./parsing/parser.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const outgoing = await parseMessage("pay N50,000 to Emeka for fuel");
  assert(outgoing.recordType === "payment_out", "expected payment_out");
  assert(outgoing.amountNgn === 50000, "expected amount 50000");
  assert(outgoing.currency === "NGN", "expected NGN currency");
  assert(outgoing.counterparty === "Emeka", "expected Emeka");
  assert(outgoing.purpose === "fuel", "expected fuel purpose");

  const incoming = await parseMessage("received ₦120,000 from Ada for deposit");
  assert(incoming.recordType === "payment_in", "expected payment_in");
  assert(incoming.amountNgn === 120000, "expected amount 120000");

  const shorthand = await parseMessage("send 70k to Musa for diesel");
  assert(shorthand.amountNgn === 70000, "expected 70k normalization");

  const sui = await parseMessage("fuel agent pay 0.000001 SUI to 0x1234567890abcdef1234567890abcdef12345678 for smoke");
  assert(sui.currency === "SUI", "expected SUI currency");
  assert(sui.amountMist === 1000, "expected 1000 MIST");
  assert(sui.recipientAddress === "0x1234567890abcdef1234567890abcdef12345678", "expected recipient address");

  assert(!validateParsedRecord({
    recordType: "instruction",
    amountNgn: null,
    amountMist: null,
    currency: "NGN",
    counterparty: null,
    recipientAddress: null,
    purpose: "policy",
    confidence: 0.5,
    summary: "Instruction",
  }).amountNgn, "expected nullable amount");

  let threw = false;
  try {
    validateParsedRecord({
      recordType: "payment_out",
      amountNgn: -1,
      amountMist: null,
      currency: "NGN",
      counterparty: null,
      recipientAddress: null,
      purpose: null,
      confidence: 0.9,
      summary: "Bad amount",
    });
  } catch {
    threw = true;
  }
  assert(threw, "expected invalid negative amount to throw");

  console.log("Parser tests passed.");
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
