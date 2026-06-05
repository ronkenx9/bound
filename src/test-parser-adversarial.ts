import { isFinancialMessage, parseMessage } from "./parsing/parser.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type ExpectedRecord = {
  recordType?: "payment_in" | "payment_out" | "instruction" | "evidence";
  amountNgn?: number | null;
  amountMist?: number | null;
  currency?: "NGN" | "SUI";
  counterparty?: string | null;
  recipientAddress?: string | null;
  purposeIncludes?: string;
  minConfidence?: number;
  isFinancial?: boolean;
};

const cases: Array<{ name: string; text: string; expected: ExpectedRecord }> = [
  {
    name: "decimal shorthand amount",
    text: "sent 12.5k to Chika for POS paper",
    expected: {
      recordType: "payment_out",
      amountNgn: 12500,
      currency: "NGN",
      counterparty: "Chika",
      purposeIncludes: "POS paper",
      minConfidence: 0.9,
      isFinancial: true,
    },
  },
  {
    name: "bank debit alert",
    text: "Debit alert: NGN 18,750 paid to Jumia for printer ink",
    expected: {
      recordType: "payment_out",
      amountNgn: 18750,
      currency: "NGN",
      counterparty: "Jumia",
      purposeIncludes: "printer ink",
      isFinancial: true,
    },
  },
  {
    name: "bank credit alert",
    text: "CR: ₦250,000 received from Kelechi for December rent balance",
    expected: {
      recordType: "payment_in",
      amountNgn: 250000,
      currency: "NGN",
      counterparty: "Kelechi",
      purposeIncludes: "December rent balance",
      isFinancial: true,
    },
  },
  {
    name: "receipt evidence with amount",
    text: "Receipt attached for ₦8,400 from TotalEnergies fuel station",
    expected: {
      recordType: "evidence",
      amountNgn: 8400,
      currency: "NGN",
      counterparty: "TotalEnergies",
      purposeIncludes: "fuel station",
      isFinancial: true,
    },
  },
  {
    name: "sui transfer with 64-char recipient",
    text: "agent pay 0.0025 SUI to 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef for storage fee",
    expected: {
      recordType: "payment_out",
      amountMist: 2500000,
      currency: "SUI",
      counterparty: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      recipientAddress: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      purposeIncludes: "storage fee",
      isFinancial: true,
    },
  },
  {
    name: "non-financial amount mention",
    text: "remind me at 5 to call Ada",
    expected: {
      isFinancial: false,
    },
  },
];

for (const item of cases) {
  const financial = isFinancialMessage(item.text);
  if (item.expected.isFinancial !== undefined) {
    assert(financial === item.expected.isFinancial, `${item.name}: expected isFinancial=${item.expected.isFinancial}, got ${financial}`);
  }
  if (!financial) continue;

  const parsed = await parseMessage(item.text);
  if (item.expected.recordType !== undefined) {
    assert(parsed.recordType === item.expected.recordType, `${item.name}: expected type ${item.expected.recordType}, got ${parsed.recordType}`);
  }
  if (item.expected.amountNgn !== undefined) {
    assert(parsed.amountNgn === item.expected.amountNgn, `${item.name}: expected amountNgn ${item.expected.amountNgn}, got ${parsed.amountNgn}`);
  }
  if (item.expected.amountMist !== undefined) {
    assert(parsed.amountMist === item.expected.amountMist, `${item.name}: expected amountMist ${item.expected.amountMist}, got ${parsed.amountMist}`);
  }
  if (item.expected.currency !== undefined) {
    assert(parsed.currency === item.expected.currency, `${item.name}: expected currency ${item.expected.currency}, got ${parsed.currency}`);
  }
  if (item.expected.counterparty !== undefined) {
    assert(parsed.counterparty === item.expected.counterparty, `${item.name}: expected counterparty ${item.expected.counterparty}, got ${parsed.counterparty}`);
  }
  if (item.expected.recipientAddress !== undefined) {
    assert(parsed.recipientAddress === item.expected.recipientAddress, `${item.name}: expected recipient ${item.expected.recipientAddress}, got ${parsed.recipientAddress}`);
  }
  if (item.expected.purposeIncludes !== undefined) {
    assert(parsed.purpose?.includes(item.expected.purposeIncludes), `${item.name}: expected purpose to include ${item.expected.purposeIncludes}, got ${parsed.purpose}`);
  }
  if (item.expected.minConfidence !== undefined) {
    assert(parsed.confidence >= item.expected.minConfidence, `${item.name}: expected confidence >= ${item.expected.minConfidence}, got ${parsed.confidence}`);
  }
}

console.log("Adversarial parser corpus passed.");
