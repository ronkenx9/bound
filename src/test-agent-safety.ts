process.env["LEDGER_MOCK"] = "true";
process.env["LEDGER_ENABLE_PAYMENTS"] = "true";
process.env["SUI_PRIVATE_KEY"] = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env["SUI_OWNER_ADDRESS"] = "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba";
process.env["LEDGER_DB_PATH"] = ":memory:";
process.env["LEDGER_MIN_SUI_BALANCE_MIST"] = "0";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function duplicateReplayTest() {
  process.env["LEDGER_AGENT_SPEND_WINDOW_MS"] = "86400000";
  const { resetDbForTests } = await import("./db.js");
  const { createAgentPolicy, evaluateAgentTransaction } = await import("./agent.js");

  resetDbForTests();
  const ownerAddress = process.env["SUI_OWNER_ADDRESS"]!;
  const recipient = "0x1234567890abcdef1234567890abcdef12345678";

  await createAgentPolicy({
    ownerAddress,
    agentId: "payment-agent",
    counterparty: recipient,
    category: null,
    maxAmountNgn: 2_000,
    approvalThresholdNgn: null,
    expiresAtMs: Date.now() + 60_000,
  });

  const first = await evaluateAgentTransaction({
    ownerAddress,
    agentId: "payment-agent",
    rawText: `payment-agent pay 0.000001 SUI to ${recipient} for smoke`,
  });
  assert(first.log.status === "executed", `expected first action executed, got ${first.log.status}`);
  assert(first.log.balanceBeforeMist !== null, "expected direct execution balanceBeforeMist");
  assert(first.log.balanceAfterMist !== null, "expected direct execution balanceAfterMist");

  const second = await evaluateAgentTransaction({
    ownerAddress,
    agentId: "payment-agent",
    rawText: `payment-agent pay 0.000001 SUI to ${recipient} for smoke`,
  });
  assert(second.log.status === "rejected", `expected duplicate rejected, got ${second.log.status}`);
  assert(/Duplicate agent action rejected/.test(second.log.reason), "expected duplicate reason");
}

async function rollingWindowTest() {
  process.env["LEDGER_AGENT_SPEND_WINDOW_MS"] = "86400000";
  const { resetDbForTests } = await import("./db.js");
  const { createAgentPolicy, evaluateAgentTransaction } = await import("./agent.js");

  resetDbForTests();
  const ownerAddress = process.env["SUI_OWNER_ADDRESS"]!;
  const recipient = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

  await createAgentPolicy({
    ownerAddress,
    agentId: "window-agent",
    counterparty: recipient,
    category: null,
    maxAmountNgn: 1_500,
    approvalThresholdNgn: null,
    expiresAtMs: Date.now() + 60_000,
  });

  const first = await evaluateAgentTransaction({
    ownerAddress,
    agentId: "window-agent",
    rawText: `window-agent pay 0.000001 SUI to ${recipient} for first smoke`,
  });
  assert(first.log.status === "executed", `expected first window action executed, got ${first.log.status}`);

  const second = await evaluateAgentTransaction({
    ownerAddress,
    agentId: "window-agent",
    rawText: `window-agent pay 0.000001 SUI to ${recipient} for second smoke`,
  });
  assert(second.log.status === "rejected", `expected window overage rejected, got ${second.log.status}`);
  assert(/Rolling spend window/.test(second.log.reason), "expected rolling window reason");
}

async function balanceGuardTest() {
  process.env["LEDGER_AGENT_SPEND_WINDOW_MS"] = "86400000";
  process.env["LEDGER_MIN_SUI_BALANCE_MIST"] = "2000000000";
  const { resetDbForTests } = await import("./db.js");
  const { createAgentPolicy, evaluateAgentTransaction } = await import("./agent.js");

  resetDbForTests();
  const ownerAddress = process.env["SUI_OWNER_ADDRESS"]!;
  const recipient = "0x2222222222222222222222222222222222222222";

  await createAgentPolicy({
    ownerAddress,
    agentId: "balance-agent",
    counterparty: recipient,
    category: null,
    maxAmountNgn: 2_000,
    approvalThresholdNgn: null,
    expiresAtMs: Date.now() + 60_000,
  });

  const result = await evaluateAgentTransaction({
    ownerAddress,
    agentId: "balance-agent",
    rawText: `balance-agent pay 0.000001 SUI to ${recipient} for smoke`,
  });
  assert(result.log.status === "failed", `expected low balance guard to create failed action, got ${result.log.status}`);
  assert(/Insufficient SUI balance for guarded payment/.test(result.log.reason), "expected low balance failure reason");
  assert(result.log.onChainActionId, "expected failed action to be logged on-chain");
  assert(!result.record, "failed action must not create a LedgerRecord");
}

async function approvalThresholdTest() {
  process.env["LEDGER_AGENT_SPEND_WINDOW_MS"] = "86400000";
  process.env["LEDGER_MIN_SUI_BALANCE_MIST"] = "0";
  const { resetDbForTests } = await import("./db.js");
  const { createAgentPolicy, evaluateAgentTransaction } = await import("./agent.js");

  resetDbForTests();
  const ownerAddress = process.env["SUI_OWNER_ADDRESS"]!;
  const recipient = "0x3333333333333333333333333333333333333333";

  await createAgentPolicy({
    ownerAddress,
    agentId: "approval-agent",
    counterparty: recipient,
    category: null,
    maxAmountNgn: 2_000,
    approvalThresholdNgn: 500,
    expiresAtMs: Date.now() + 60_000,
  });

  const result = await evaluateAgentTransaction({
    ownerAddress,
    agentId: "approval-agent",
    rawText: `approval-agent pay 0.000001 SUI to ${recipient} for smoke`,
  });

  assert(result.log.status === "pending_approval", `expected pending approval, got ${result.log.status}`);
  assert(/operator approval required/.test(result.log.reason), "expected operator approval reason");
  assert(!result.log.txDigest || result.log.txDigest === result.log.onChainTxDigest, "pending approval must not have a payment digest");
  assert(!result.record, "pending approval must not create an executed/approved LedgerRecord");
}

async function approvalCompletionTest() {
  process.env["LEDGER_AGENT_SPEND_WINDOW_MS"] = "86400000";
  process.env["LEDGER_MIN_SUI_BALANCE_MIST"] = "0";
  const { resetDbForTests } = await import("./db.js");
  const { createAgentPolicy, evaluateAgentTransaction, approvePendingAgentAction } = await import("./agent.js");

  resetDbForTests();
  const ownerAddress = process.env["SUI_OWNER_ADDRESS"]!;
  const recipient = "0x4444444444444444444444444444444444444444";

  await createAgentPolicy({
    ownerAddress,
    agentId: "approval-complete-agent",
    counterparty: recipient,
    category: null,
    maxAmountNgn: 2_000,
    approvalThresholdNgn: 500,
    expiresAtMs: Date.now() + 60_000,
  });

  const pending = await evaluateAgentTransaction({
    ownerAddress,
    agentId: "approval-complete-agent",
    rawText: `approval-complete-agent pay 0.000001 SUI to ${recipient} for smoke`,
  });
  assert(pending.log.status === "pending_approval", `expected pending approval, got ${pending.log.status}`);

  const approved = await approvePendingAgentAction({
    ownerAddress,
    actionId: pending.log.actionId,
    approvedBy: "operator",
  });

  assert(approved.log.status === "executed", `expected approved pending action to execute, got ${approved.log.status}`);
  assert(approved.log.txDigest?.startsWith("0xmock-payment-tx-"), "expected payment digest on approved action");
  assert(approved.log.approvalOnChainActionId, "expected approval execution audit action id");
  assert(approved.log.approvalOnChainTxDigest, "expected approval execution audit tx");
  assert(approved.record?.objectId, "expected LedgerRecord after approval execution");
}

async function approvalFailureRecoveryTest() {
  process.env["LEDGER_AGENT_SPEND_WINDOW_MS"] = "86400000";
  process.env["LEDGER_MIN_SUI_BALANCE_MIST"] = "0";
  const { resetDbForTests } = await import("./db.js");
  const { createAgentPolicy, evaluateAgentTransaction, approvePendingAgentAction } = await import("./agent.js");

  resetDbForTests();
  const ownerAddress = process.env["SUI_OWNER_ADDRESS"]!;
  const recipient = "0x5555555555555555555555555555555555555555";

  await createAgentPolicy({
    ownerAddress,
    agentId: "approval-fail-agent",
    counterparty: recipient,
    category: null,
    maxAmountNgn: 2_000,
    approvalThresholdNgn: 500,
    expiresAtMs: Date.now() + 60_000,
  });

  const pending = await evaluateAgentTransaction({
    ownerAddress,
    agentId: "approval-fail-agent",
    rawText: `approval-fail-agent pay 0.000001 SUI to ${recipient} for smoke`,
  });
  assert(pending.log.status === "pending_approval", `expected pending approval, got ${pending.log.status}`);

  process.env["LEDGER_MIN_SUI_BALANCE_MIST"] = "2000000000";
  const failed = await approvePendingAgentAction({
    ownerAddress,
    actionId: pending.log.actionId,
    approvedBy: "operator",
  });

  assert(failed.log.status === "failed", `expected failed approved action, got ${failed.log.status}`);
  assert(/Insufficient SUI balance for guarded payment/.test(failed.log.reason), "expected approval failure reason");
  assert(failed.log.approvalOnChainActionId, "expected failed approval audit action id");
  assert(!failed.record, "failed approval must not create a LedgerRecord");
}

async function reconciliationTest() {
  process.env["LEDGER_AGENT_SPEND_WINDOW_MS"] = "86400000";
  process.env["LEDGER_MIN_SUI_BALANCE_MIST"] = "0";
  const { resetDbForTests, insertAgentActionLog } = await import("./db.js");
  const { createAgentPolicy, reconcileAgentActionRecord } = await import("./agent.js");

  resetDbForTests();
  const ownerAddress = process.env["SUI_OWNER_ADDRESS"]!;
  const recipient = "0x6666666666666666666666666666666666666666";
  const policy = await createAgentPolicy({
    ownerAddress,
    agentId: "reconcile-agent",
    counterparty: recipient,
    category: null,
    maxAmountNgn: 2_000,
    approvalThresholdNgn: null,
    expiresAtMs: Date.now() + 60_000,
  });

  insertAgentActionLog({
    actionId: "action_reconcile_missing_record",
    onChainActionId: "0xmock-action-id-reconcile",
    policyId: policy.policyId,
    agentId: "reconcile-agent",
    counterparty: recipient,
    recipientAddress: recipient,
    category: null,
    amountNgn: null,
    amountMist: 1_000,
    currency: "SUI",
    proposedText: `reconcile-agent pay 0.000001 SUI to ${recipient} for smoke`,
    status: "executed",
    reason: "Payment submitted but LedgerRecord missing.",
    idempotencyKey: "reconcile-test-key",
    txDigest: "0xmock-payment-tx-reconcile",
    onChainTxDigest: "0xmock-audit-tx-reconcile",
    approvalOnChainActionId: null,
    approvalOnChainTxDigest: null,
    approvedBy: null,
    approvedAtMs: null,
    balanceBeforeMist: 1_000_000_000,
    balanceAfterMist: 999_999_000,
    reconciledRecordObjectId: null,
    reconciledAtMs: null,
    createdAtMs: Date.now(),
  });

  const result = await reconcileAgentActionRecord({
    ownerAddress,
    actionId: "action_reconcile_missing_record",
  });

  assert(result.log.status === "executed", `expected reconciled action to remain executed, got ${result.log.status}`);
  assert(result.record.objectId, "expected reconciliation to create LedgerRecord");
  assert(result.log.reconciledRecordObjectId === result.record.objectId, "expected action to store reconciled record id");
  assert(result.log.reconciledAtMs !== null, "expected reconciledAtMs");
}

async function policyThresholdParserTest() {
  const { parsePolicyCommand } = await import("./agent.js");
  const ownerAddress = process.env["SUI_OWNER_ADDRESS"]!;

  const suiPolicy = parsePolicyCommand(
    "payment agent can pay 0x3333333333333333333333333333333333333333 up to 0.000003 SUI with manual approval over 0.000001 SUI",
    ownerAddress,
  );
  assert(suiPolicy?.maxAmountNgn === 3_000, "expected SUI policy cap in MIST");
  assert(suiPolicy.approvalThresholdNgn === 1_000, "expected SUI approval threshold in MIST");

  const ngnPolicy = parsePolicyCommand(
    "fuel agent can pay Emeka up to N70,000 this week with operator approval above N50,000",
    ownerAddress,
  );
  assert(ngnPolicy?.maxAmountNgn === 70_000, "expected NGN policy cap");
  assert(ngnPolicy.approvalThresholdNgn === 50_000, "expected NGN approval threshold");
}

async function main() {
  await policyThresholdParserTest();
  await duplicateReplayTest();
  await rollingWindowTest();
  await balanceGuardTest();
  await approvalThresholdTest();
  await approvalCompletionTest();
  await approvalFailureRecoveryTest();
  await reconciliationTest();
  console.log("Agent safety tests passed.");
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
