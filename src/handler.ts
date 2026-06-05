import type { ContentBuilder } from "spectrum-ts";
import { text } from "spectrum-ts";
import type { Message } from "spectrum-ts";
import { parseMessage, isFinancialMessage, type ParsedRecord } from "./parsing/parser.js";
import { createRecord } from "./record/creator.js";
import { initDb, findDuplicate, getLastRecord, getMonthlySummary, claimInboundMessage, insertParserFeedback } from "./db.js";
import { encrypt, resolveDataKeyring } from "./encryption.js";
import { storeBlob } from "./walrus/client.js";
import { getRuntimeConfig } from "./config.js";
import {
  approvePendingAgentAction,
  createAgentPolicy,
  evaluateAgentTransaction,
  parsePolicyCommand,
  rejectPendingAgentAction,
  revokePolicy,
} from "./agent.js";
import { logger } from "./ops/logger.js";
import { DEFAULT_PARSER_CONFIDENCE_THRESHOLD } from "./parsing/calibration.js";

// Initialize SQLite database
initDb();

export const CONFIDENCE_THRESHOLD = DEFAULT_PARSER_CONFIDENCE_THRESHOLD;

type Reply = (...content: [ContentBuilder, ...ContentBuilder[]]) => Promise<void>;

// State for duplicate confirmations
let pendingRecord: { rawText: string; parsed: ParsedRecord } | null = null;
let pendingLowConfidenceRecord: {
  rawText: string;
  parsed: ParsedRecord;
  messageId: string;
  platform: string;
  senderId: string | null;
} | null = null;

function recordParserFeedback(args: {
  pending: NonNullable<typeof pendingLowConfidenceRecord>;
  outcome: "confirmed" | "rejected";
  recordObjectId?: string | null;
}) {
  insertParserFeedback({
    platform: args.pending.platform,
    messageId: args.pending.messageId,
    senderId: args.pending.senderId,
    rawText: args.pending.rawText,
    parsedSummary: args.pending.parsed.summary,
    recordType: args.pending.parsed.recordType,
    confidence: args.pending.parsed.confidence,
    parserSource: args.pending.parsed.parserSource ?? null,
    outcome: args.outcome,
    recordObjectId: args.recordObjectId ?? null,
  });
}

export async function handleMessage(reply: Reply, message: Message): Promise<void> {
  const firstContent = message.content[0];

  if (!firstContent || firstContent.type !== "plain_text") {
    await reply(text("Media records coming soon — send text or a bank alert for now."));
    return;
  }

  const raw = firstContent.text.trim();
  const isNewDelivery = claimInboundMessage({
    platform: message.platform,
    messageId: message.id,
    senderId: message.sender.id ?? null,
  });
  if (!isNewDelivery) {
    return;
  }

  const config = getRuntimeConfig();

  // 1. Handle pending agent action approval/rejection.
  const approvalMatch = raw.match(/\b(?:approve|execute)\s+(action_[a-f0-9]+)\b/i);
  if (approvalMatch?.[1]) {
    const actionId = approvalMatch[1];
    await reply(text("Approving pending agent action..."));
    try {
      const { log, record } = await approvePendingAgentAction({
        ownerAddress: config.suiOwnerAddress,
        actionId,
        approvedBy: "operator",
      });
      await reply((text as any)(
        `Agent action approved and executed.\n` +
        `Reason: ${log.reason}\n` +
        `Action: ${log.actionId}\n` +
        `Payment Tx: ${log.txDigest ?? "none"}\n` +
        `Verify: ${record?.verifyUrl ?? "pending"}`
      ));
    } catch (err) {
      logger.error("agent_action_approval_failed", { actionId, messageId: message.id, platform: message.platform }, err);
      await reply(text("Failed to approve pending agent action. Please try again."));
    }
    return;
  }

  const rejectionMatch = raw.match(/\b(?:reject|deny)\s+(action_[a-f0-9]+)(?:\s+(.+))?$/i);
  if (rejectionMatch?.[1]) {
    const actionId = rejectionMatch[1];
    await reply(text("Rejecting pending agent action..."));
    try {
      const log = await rejectPendingAgentAction({
        ownerAddress: config.suiOwnerAddress,
        actionId,
        rejectedBy: "operator",
        reason: rejectionMatch[2]?.trim(),
      });
      await reply((text as any)(
        `Agent action rejected.\n` +
        `Reason: ${log.reason}\n` +
        `Action: ${log.actionId}`
      ));
    } catch (err) {
      logger.error("agent_action_rejection_failed", { actionId, messageId: message.id, platform: message.platform }, err);
      await reply(text("Failed to reject pending agent action. Please try again."));
    }
    return;
  }

  // 2. Handle agent policy creation.
  const policyDraft = parsePolicyCommand(raw, config.suiOwnerAddress);
  if (policyDraft) {
    await reply(text("Creating agent policy..."));
    try {
      const policy = await createAgentPolicy(policyDraft);
      const cap = `N${policy.maxAmountNgn.toLocaleString("en-NG")}`;
      const party = policy.counterparty ? ` for ${policy.counterparty}` : "";
      const category = policy.category ? ` (${policy.category})` : "";
      await reply((text as any)(
        `Agent policy created.\n` +
        `Policy: ${policy.policyId}\n` +
        `On-chain: ${policy.onChainPolicyId ?? "pending"}\n` +
        `Agent: ${policy.agentId}\n` +
        `Scope: up to ${cap}${party}${category}\n` +
        `Status: active`
      ));
    } catch (err) {
      logger.error("agent_policy_creation_failed", { messageId: message.id, platform: message.platform }, err);
      await reply(text("Failed to create agent policy. Please try again."));
    }
    return;
  }

  // 3. Handle agent policy revocation.
  const revokeMatch = raw.match(/\b(?:revoke|disable|cancel)\s+([a-zA-Z0-9_-]+(?:\s+agent)?|policy_[a-f0-9]+)\b/i);
  if (revokeMatch?.[1]) {
    const id = revokeMatch[1].toLowerCase().replace(/\s+/g, "-");
    await reply(text("Revoking agent policy..."));
    try {
      const revoked = await revokePolicy(id);
      if (!revoked) {
        await reply(text(`No active agent policy found for ${id}.`));
        return;
      }

      await reply(text(`Agent policy revoked.\nPolicy: ${revoked.policyId}\nOn-chain: ${revoked.onChainPolicyId ?? "unknown"}\nAgent: ${revoked.agentId}`));
    } catch (err) {
      logger.error("agent_policy_revocation_failed", { policyOrAgentId: id, messageId: message.id, platform: message.platform }, err);
      await reply(text("Failed to revoke agent policy. Please try again."));
    }
    return;
  }

  // 4. Handle agent transaction proposals/invoices.
  if (/\b(agent|invoice|execute|autonomous)\b/i.test(raw) && /\b(?:N|₦|NGN)?\s*[\d,]+\s*(?:k|thousand)?\b/i.test(raw)) {
    await reply(text("Checking agent policy..."));
    try {
      const { log, record } = await evaluateAgentTransaction({
        ownerAddress: config.suiOwnerAddress,
        rawText: raw,
        agentId: raw.match(/\b([a-zA-Z][\w-]*-agent|[a-zA-Z][\w-]*\s+agent)\b/i)?.[1]?.toLowerCase().replace(/\s+/g, "-"),
      });

      if (log.status === "rejected") {
        await reply(text(`Agent action rejected.\nReason: ${log.reason}\nAction: ${log.actionId}`));
        return;
      }

      if (log.status === "pending_approval") {
        await reply((text as any)(
          `Agent action requires approval.\n` +
          `Reason: ${log.reason}\n` +
          `Action: ${log.actionId}\n` +
          `Policy: ${log.policyId}`
        ));
        return;
      }

      await reply((text as any)(
        `Agent action approved and recorded.\n` +
        `Reason: ${log.reason}\n` +
        `Action: ${log.actionId}\n` +
        `Policy: ${log.policyId}\n` +
        `Verify: ${record?.verifyUrl ?? "pending"}`
      ));
    } catch (err) {
      logger.error("agent_action_evaluation_failed", { messageId: message.id, platform: message.platform }, err);
      await reply(text("Failed to evaluate agent action. Please try again."));
    }
    return;
  }

  // 5. Handle pending low-confidence parser confirmation.
  if (pendingLowConfidenceRecord) {
    if (/^(?:yes|confirm|save|y)\b/i.test(raw)) {
      await reply(text("Saving confirmed record..."));
      const pending = pendingLowConfidenceRecord;
      try {
        const record = await createRecord({
          ownerAddress: config.suiOwnerAddress,
          rawText: pending.rawText,
          parsed: pending.parsed,
        });
        recordParserFeedback({ pending, outcome: "confirmed", recordObjectId: record.objectId });
        pendingLowConfidenceRecord = null;
        await reply((text as any)(`Record saved successfully.\n${record.summary}\nVerify: ${record.verifyUrl}`));
      } catch (err) {
        logger.error("low_confidence_record_save_failed", { messageId: message.id, platform: message.platform }, err);
        await reply(text("Failed to save the confirmed record. Please try again."));
      }
      return;
    }

    if (/^(?:no|cancel|reject|n|stop)\b/i.test(raw)) {
      recordParserFeedback({ pending: pendingLowConfidenceRecord, outcome: "rejected" });
      pendingLowConfidenceRecord = null;
      await reply(text("Cancelled. The parsed record was not saved."));
      return;
    }
  }

  // 6. Handle pending duplicate confirmation
  if (pendingRecord) {
    if (/^(?:yes|confirm|save|save\s+anyway|y)\b/i.test(raw)) {
      await reply(text("Saving transaction..."));
      try {
        const record = await createRecord({
          ownerAddress: config.suiOwnerAddress,
          rawText: pendingRecord.rawText,
          parsed: pendingRecord.parsed,
        });
        const amount = record.summary;
        pendingRecord = null;
        await reply((text as any)(`Record saved successfully.\n${amount}\nVerify: ${record.verifyUrl}`));
      } catch (err) {
        logger.error("pending_record_save_failed", { messageId: message.id, platform: message.platform }, err);
        await reply(text("Failed to save the record. Please try again."));
      }
      return;
    } else if (/^(?:no|cancel|n|stop)\b/i.test(raw)) {
      pendingRecord = null;
      await reply(text("Cancelled. The duplicate record was not saved."));
      return;
    }
  }

  // 7. Handle Monthly Report
  if (/\b(?:report|summary|stats|analytics)\b/i.test(raw)) {
    await reply(text("Compiling financial summary..."));
    
    // Default to current month/year
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    
    try {
      const summary = getMonthlySummary(yearMonth);
      
      if (summary.records.length === 0) {
        await reply(text(`No records found for ${yearMonth}.`));
        return;
      }

      // Format markdown report
      let reportMarkdown = `# Financial Ledger Report - ${yearMonth}\n\n`;
      reportMarkdown += `**Total Cash In:** N${summary.cashIn.toLocaleString("en-NG")}\n`;
      reportMarkdown += `**Total Cash Out:** N${summary.cashOut.toLocaleString("en-NG")}\n`;
      reportMarkdown += `**Net Flow:** N${(summary.cashIn - summary.cashOut).toLocaleString("en-NG")}\n\n`;
      reportMarkdown += `## Top Counterparties\n`;
      for (const cp of summary.topCounterparties) {
        reportMarkdown += `- ${cp.name}: N${cp.total.toLocaleString("en-NG")}\n`;
      }
      reportMarkdown += `\n## Transaction Logs\n`;
      reportMarkdown += `| Date | Type | Description | Amount | Link |\n`;
      reportMarkdown += `| --- | --- | --- | --- | --- |\n`;
      for (const r of summary.records) {
        const dateStr = new Date(r.createdAtMs).toLocaleDateString();
        const amtStr = r.amountNgn ? `N${r.amountNgn.toLocaleString("en-NG")}` : "-";
        reportMarkdown += `| ${dateStr} | ${r.recordType} | ${r.purpose || "unspecified"} | ${amtStr} | [Sui Object](https://suiscan.xyz/testnet/object/${r.objectId}) |\n`;
      }

      // Encrypt report and save to Walrus
      const encrypted = encrypt(reportMarkdown, resolveDataKeyring(config.suiPrivateKey));
      const encryptedBytes = new TextEncoder().encode(JSON.stringify(encrypted));
      const { blobId } = await storeBlob(encryptedBytes);

      const briefSummary = `📈 Financial Memory Summary (${yearMonth}):\n` +
        `• Total In: N${summary.cashIn.toLocaleString("en-NG")}\n` +
        `• Total Out: N${summary.cashOut.toLocaleString("en-NG")}\n` +
        `• Net: N${(summary.cashIn - summary.cashOut).toLocaleString("en-NG")}\n` +
        `• Active Entries: ${summary.records.length}\n` +
        `• Encrypted Audit Link: https://walrus-explorer.com/blob/${blobId}`;

      await reply((text as any)(briefSummary));
    } catch (err) {
      logger.error("monthly_report_generation_failed", { messageId: message.id, platform: message.platform }, err);
      await reply(text("Failed to generate report. Please try again."));
    }
    return;
  }

  // 8. Handle Corrections
  if (/^(?:correction|change|update)\b/i.test(raw)) {
    const lastRecord = getLastRecord();
    if (!lastRecord) {
      await reply(text("No previous transactions found to correct."));
      return;
    }

    await reply(text("Processing correction..."));

    // Extract everything after the keyword "correction:" or "change:" or "update:"
    const cleanRaw = raw.replace(/^(?:correction|change|update)[:\s]*/i, "");
    
    try {
      // Parse the correction content
      const correctionParsed = await parseMessage(cleanRaw);
      
      // Merge with last record values if fields are missing in correction parsing
      const mergedParsed: ParsedRecord = {
        recordType: correctionParsed.recordType || (lastRecord.recordType as any),
        amountNgn: correctionParsed.amountNgn !== null ? correctionParsed.amountNgn : lastRecord.amountNgn,
        amountMist: correctionParsed.amountMist,
        currency: correctionParsed.currency,
        counterparty: correctionParsed.counterparty || lastRecord.counterparty,
        recipientAddress: correctionParsed.recipientAddress,
        purpose: correctionParsed.purpose || lastRecord.purpose,
        confidence: 0.95,
        summary: `[Correction] ${correctionParsed.summary}`,
      };

      const record = await createRecord({
        ownerAddress: config.suiOwnerAddress,
        rawText: cleanRaw,
        parsed: mergedParsed,
        parentObjectId: lastRecord.objectId,
      });

      await reply(
        (text as any)(
          `📝 Correction saved & linked!\n` +
          `• Amended Original Record: ${lastRecord.objectId}\n` +
          `• New Record: ${record.summary}\n` +
          `• Verify: ${record.verifyUrl}`
        )
      );
    } catch (err) {
      logger.error("correction_save_failed", { messageId: message.id, platform: message.platform }, err);
      await reply(text("Failed to save the correction. Please try again."));
    }
    return;
  }

  // 9. Regular Financial Transaction Handler
  if (!isFinancialMessage(raw)) {
    return;
  }

  await reply(text("Processing..."));

  let parsed: ParsedRecord;
  try {
    parsed = await parseMessage(raw);
  } catch {
    await reply(text("Could not parse that. Try sending the text of your bank alert."));
    return;
  }

  if (parsed.confidence < CONFIDENCE_THRESHOLD) {
    pendingLowConfidenceRecord = {
      rawText: raw,
      parsed,
      messageId: message.id,
      platform: message.platform,
      senderId: message.sender.id ?? null,
    };
    await reply(
      text(`Not sure I understood that. I think it's: "${parsed.summary}". Reply "yes" to confirm or resend with more detail.`)
    );
    return;
  }

  // Check for potential duplicate transactions in the last 48 hours
  const duplicate = findDuplicate(parsed.amountNgn, parsed.counterparty, parsed.purpose);
  if (duplicate) {
    pendingRecord = { rawText: raw, parsed };
    await reply(
      (text as any)(
        `⚠️ Possible Duplicate: You recorded a similar transaction recently:\n` +
        `• "${duplicate.recordType}: N${duplicate.amountNgn?.toLocaleString("en-NG")} to ${duplicate.counterparty || "unknown"}"\n\n` +
        `Reply "confirm" to save anyway, or "cancel".`
      )
    );
    return;
  }

  // No duplicate found: proceed with creation
  try {
    const record = await createRecord({
      ownerAddress: config.suiOwnerAddress,
      rawText: raw,
      parsed,
    });
    const amount = parsed.amountNgn != null ? `\nAmount: N${parsed.amountNgn.toLocaleString("en-NG")}` : "";
    const party = parsed.counterparty ? `\nParty: ${parsed.counterparty}` : "";
    await reply((text as any)(`Record saved.\n${parsed.summary}${amount}${party}\nVerify: ${record.verifyUrl}`));
  } catch (err) {
    logger.error("record_creation_failed", { messageId: message.id, platform: message.platform }, err);
    await reply(text("Failed to save the record. Please try again."));
  }
}
