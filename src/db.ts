import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { getOptionalConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store database inside the workspace unless LEDGER_DB_PATH is provided.
const dbPath = getOptionalConfig().databasePath ?? path.resolve(__dirname, "../ledger.db");
const db = new Database(dbPath);

export interface DbRecord {
  objectId: string;
  walrusBlobId: string;
  contentHash: string;
  recordType: string;
  actorType: "human" | "agent";
  actorId: string | null;
  amountNgn: number | null;
  amountMist: number | null;
  currency: "NGN" | "SUI";
  counterparty: string | null;
  recipientAddress: string | null;
  purpose: string | null;
  createdAtMs: number;
  parentObjectId: string | null;
  linkedPolicyId: string | null;
  txDigest: string | null;
}

export interface AgentPolicy {
  policyId: string;
  onChainPolicyId: string | null;
  ownerAddress: string;
  agentId: string;
  counterparty: string | null;
  category: string | null;
  maxAmountNgn: number;
  approvalThresholdNgn: number | null;
  expiresAtMs: number | null;
  revokedAtMs: number | null;
  createdAtMs: number;
}

export interface AgentActionLog {
  actionId: string;
  onChainActionId: string | null;
  policyId: string | null;
  agentId: string;
  counterparty: string | null;
  recipientAddress: string | null;
  category: string | null;
  amountNgn: number | null;
  amountMist: number | null;
  currency: "NGN" | "SUI";
  proposedText: string;
  status: "approved" | "rejected" | "executed" | "failed" | "pending_approval";
  reason: string;
  idempotencyKey: string;
  txDigest: string | null;
  onChainTxDigest: string | null;
  approvalOnChainActionId: string | null;
  approvalOnChainTxDigest: string | null;
  approvedBy: string | null;
  approvedAtMs: number | null;
  balanceBeforeMist: number | null;
  balanceAfterMist: number | null;
  reconciledRecordObjectId: string | null;
  reconciledAtMs: number | null;
  createdAtMs: number;
}

export interface ProcessedMessage {
  messageKey: string;
  platform: string;
  messageId: string;
  senderId: string | null;
  processedAtMs: number;
}

export interface ProviderOffset {
  providerKey: string;
  platform: string;
  spaceId: string;
  cursor: string;
  messageId: string;
  messageTimestampMs: number | null;
  updatedAtMs: number;
}

export interface ParserFeedback {
  feedbackId: string;
  platform: string;
  messageId: string;
  senderId: string | null;
  rawText: string;
  parsedSummary: string;
  recordType: string;
  confidence: number;
  parserSource: string | null;
  outcome: "confirmed" | "rejected";
  recordObjectId: string | null;
  createdAtMs: number;
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      objectId TEXT PRIMARY KEY,
      walrusBlobId TEXT NOT NULL,
      contentHash TEXT NOT NULL,
      recordType TEXT NOT NULL,
      actorType TEXT NOT NULL DEFAULT 'human',
      actorId TEXT,
      amountNgn REAL,
      amountMist REAL,
      currency TEXT NOT NULL DEFAULT 'NGN',
      counterparty TEXT,
      recipientAddress TEXT,
      purpose TEXT,
      createdAtMs INTEGER NOT NULL,
      parentObjectId TEXT,
      linkedPolicyId TEXT,
      txDigest TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_policies (
      policyId TEXT PRIMARY KEY,
      onChainPolicyId TEXT,
      ownerAddress TEXT NOT NULL,
      agentId TEXT NOT NULL,
      counterparty TEXT,
      category TEXT,
      maxAmountNgn REAL NOT NULL,
      approvalThresholdNgn REAL,
      expiresAtMs INTEGER,
      revokedAtMs INTEGER,
      createdAtMs INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_action_logs (
      actionId TEXT PRIMARY KEY,
      onChainActionId TEXT,
      policyId TEXT,
      agentId TEXT NOT NULL,
      counterparty TEXT,
      recipientAddress TEXT,
      category TEXT,
      amountNgn REAL,
      amountMist REAL,
      currency TEXT NOT NULL DEFAULT 'NGN',
      proposedText TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      idempotencyKey TEXT,
      txDigest TEXT,
      onChainTxDigest TEXT,
      approvalOnChainActionId TEXT,
      approvalOnChainTxDigest TEXT,
      approvedBy TEXT,
      approvedAtMs INTEGER,
      balanceBeforeMist REAL,
      balanceAfterMist REAL,
      reconciledRecordObjectId TEXT,
      reconciledAtMs INTEGER,
      createdAtMs INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      messageKey TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      messageId TEXT NOT NULL,
      senderId TEXT,
      processedAtMs INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_offsets (
      providerKey TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      spaceId TEXT NOT NULL,
      cursor TEXT NOT NULL,
      messageId TEXT NOT NULL,
      messageTimestampMs INTEGER,
      updatedAtMs INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parser_feedback (
      feedbackId TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      messageId TEXT NOT NULL,
      senderId TEXT,
      rawText TEXT NOT NULL,
      parsedSummary TEXT NOT NULL,
      recordType TEXT NOT NULL,
      confidence REAL NOT NULL,
      parserSource TEXT,
      outcome TEXT NOT NULL,
      recordObjectId TEXT,
      createdAtMs INTEGER NOT NULL
    );
  `);
  addColumnIfMissing("records", "actorType", "TEXT NOT NULL DEFAULT 'human'");
  addColumnIfMissing("records", "actorId", "TEXT");
  addColumnIfMissing("records", "amountMist", "REAL");
  addColumnIfMissing("records", "currency", "TEXT NOT NULL DEFAULT 'NGN'");
  addColumnIfMissing("records", "recipientAddress", "TEXT");
  addColumnIfMissing("records", "linkedPolicyId", "TEXT");
  addColumnIfMissing("records", "txDigest", "TEXT");
  addColumnIfMissing("agent_policies", "onChainPolicyId", "TEXT");
  addColumnIfMissing("agent_action_logs", "onChainActionId", "TEXT");
  addColumnIfMissing("agent_action_logs", "recipientAddress", "TEXT");
  addColumnIfMissing("agent_action_logs", "amountMist", "REAL");
  addColumnIfMissing("agent_action_logs", "currency", "TEXT NOT NULL DEFAULT 'NGN'");
  addColumnIfMissing("agent_action_logs", "idempotencyKey", "TEXT");
  addColumnIfMissing("agent_action_logs", "onChainTxDigest", "TEXT");
  addColumnIfMissing("agent_action_logs", "approvalOnChainActionId", "TEXT");
  addColumnIfMissing("agent_action_logs", "approvalOnChainTxDigest", "TEXT");
  addColumnIfMissing("agent_action_logs", "approvedBy", "TEXT");
  addColumnIfMissing("agent_action_logs", "approvedAtMs", "INTEGER");
  addColumnIfMissing("agent_action_logs", "balanceBeforeMist", "REAL");
  addColumnIfMissing("agent_action_logs", "balanceAfterMist", "REAL");
  addColumnIfMissing("agent_action_logs", "reconciledRecordObjectId", "TEXT");
  addColumnIfMissing("agent_action_logs", "reconciledAtMs", "INTEGER");
  db.exec("DROP INDEX IF EXISTS idx_agent_action_logs_idempotency");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_action_logs_idempotency_guarded
    ON agent_action_logs(idempotencyKey)
    WHERE idempotencyKey IS NOT NULL AND status IN ('approved', 'executed', 'pending_approval')
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_messages_platform_message
    ON processed_messages(platform, messageId)
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_offsets_platform_space
    ON provider_offsets(platform, spaceId)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_parser_feedback_created
    ON parser_feedback(createdAtMs DESC)
  `);
}

export function resetDbForTests() {
  if (process.env["LEDGER_MOCK"] !== "true") {
    throw new Error("resetDbForTests can only run when LEDGER_MOCK=true");
  }

  db.exec(`
    DROP TABLE IF EXISTS records;
    DROP TABLE IF EXISTS agent_policies;
    DROP TABLE IF EXISTS agent_action_logs;
    DROP TABLE IF EXISTS processed_messages;
    DROP TABLE IF EXISTS provider_offsets;
    DROP TABLE IF EXISTS parser_feedback;
  `);
  initDb();
}

function providerKey(platform: string, spaceId: string): string {
  return `${platform.trim()}:${spaceId.trim()}`;
}

export function upsertProviderOffset(args: {
  platform: string;
  spaceId: string;
  cursor: string;
  messageId: string;
  messageTimestampMs?: number | null;
  updatedAtMs?: number;
}) {
  const platform = args.platform.trim();
  const spaceId = args.spaceId.trim();
  const cursor = args.cursor.trim();
  const messageId = args.messageId.trim();
  if (!platform || !spaceId || !cursor || !messageId) {
    throw new Error("Provider offsets require platform, spaceId, cursor, and messageId");
  }

  db.prepare(`
    INSERT INTO provider_offsets (
      providerKey, platform, spaceId, cursor, messageId, messageTimestampMs, updatedAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(providerKey) DO UPDATE SET
      cursor = excluded.cursor,
      messageId = excluded.messageId,
      messageTimestampMs = excluded.messageTimestampMs,
      updatedAtMs = excluded.updatedAtMs
  `).run(
    providerKey(platform, spaceId),
    platform,
    spaceId,
    cursor,
    messageId,
    args.messageTimestampMs ?? null,
    args.updatedAtMs ?? Date.now(),
  );
}

export function getProviderOffset(platform: string, spaceId: string): ProviderOffset | undefined {
  return db.prepare("SELECT * FROM provider_offsets WHERE providerKey = ?")
    .get(providerKey(platform, spaceId)) as ProviderOffset | undefined;
}

export function listProviderOffsets(): ProviderOffset[] {
  return db.prepare("SELECT * FROM provider_offsets ORDER BY platform, spaceId")
    .all() as ProviderOffset[];
}

export function insertParserFeedback(feedback: Omit<ParserFeedback, "feedbackId" | "createdAtMs"> & {
  feedbackId?: string;
  createdAtMs?: number;
}) {
  const feedbackId = feedback.feedbackId ?? `feedback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  db.prepare(`
    INSERT INTO parser_feedback (
      feedbackId, platform, messageId, senderId, rawText, parsedSummary, recordType, confidence,
      parserSource, outcome, recordObjectId, createdAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    feedbackId,
    feedback.platform,
    feedback.messageId,
    feedback.senderId,
    feedback.rawText,
    feedback.parsedSummary,
    feedback.recordType,
    feedback.confidence,
    feedback.parserSource,
    feedback.outcome,
    feedback.recordObjectId,
    feedback.createdAtMs ?? Date.now(),
  );
}

export function getParserFeedback(limit = 50): ParserFeedback[] {
  return db.prepare(`
    SELECT * FROM parser_feedback
    ORDER BY createdAtMs DESC
    LIMIT ?
  `).all(limit) as ParserFeedback[];
}

export function claimInboundMessage(args: {
  platform: string;
  messageId: string;
  senderId: string | null;
  processedAtMs?: number;
}): boolean {
  const platform = args.platform.trim();
  const messageId = args.messageId.trim();
  if (!platform || !messageId) return true;

  const messageKey = `${platform}:${messageId}`;
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO processed_messages (messageKey, platform, messageId, senderId, processedAtMs)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(messageKey, platform, messageId, args.senderId, args.processedAtMs ?? Date.now());
  return result.changes === 1;
}

export function getProcessedMessage(messageKey: string): ProcessedMessage | undefined {
  return db.prepare("SELECT * FROM processed_messages WHERE messageKey = ?")
    .get(messageKey) as ProcessedMessage | undefined;
}

export function insertRecord(record: DbRecord) {
  const stmt = db.prepare(`
    INSERT INTO records (
      objectId, walrusBlobId, contentHash, recordType, actorType, actorId, amountNgn, amountMist, currency,
      counterparty, recipientAddress, purpose, createdAtMs, parentObjectId, linkedPolicyId, txDigest
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    record.objectId,
    record.walrusBlobId,
    record.contentHash,
    record.recordType,
    record.actorType,
    record.actorId,
    record.amountNgn,
    record.amountMist,
    record.currency,
    record.counterparty,
    record.recipientAddress,
    record.purpose,
    record.createdAtMs,
    record.parentObjectId,
    record.linkedPolicyId,
    record.txDigest
  );
}

export function getRecord(objectId: string): DbRecord | undefined {
  const stmt = db.prepare("SELECT * FROM records WHERE objectId = ?");
  return stmt.get(objectId) as DbRecord | undefined;
}

export function findDuplicate(
  amountNgn: number | null,
  counterparty: string | null,
  purpose: string | null,
  maxAgeMs = 172800000 // 48 hours in ms
): DbRecord | undefined {
  if (amountNgn === null && counterparty === null && purpose === null) return undefined;

  const since = Date.now() - maxAgeMs;
  const stmt = db.prepare(`
    SELECT * FROM records 
    WHERE createdAtMs >= ? 
      AND amountNgn IS ? 
      AND counterparty IS ? 
      AND purpose IS ?
    ORDER BY createdAtMs DESC 
    LIMIT 1
  `);
  return stmt.get(since, amountNgn, counterparty, purpose) as DbRecord | undefined;
}

export function getLastRecord(): DbRecord | undefined {
  const stmt = db.prepare("SELECT * FROM records ORDER BY createdAtMs DESC LIMIT 1");
  return stmt.get() as DbRecord | undefined;
}

export function insertAgentPolicy(policy: AgentPolicy) {
  const stmt = db.prepare(`
    INSERT INTO agent_policies (
      policyId, onChainPolicyId, ownerAddress, agentId, counterparty, category, maxAmountNgn, approvalThresholdNgn,
      expiresAtMs, revokedAtMs, createdAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    policy.policyId,
    policy.onChainPolicyId,
    policy.ownerAddress,
    policy.agentId,
    policy.counterparty,
    policy.category,
    policy.maxAmountNgn,
    policy.approvalThresholdNgn,
    policy.expiresAtMs,
    policy.revokedAtMs,
    policy.createdAtMs,
  );
}

export function revokeAgentPolicy(agentIdOrPolicyId: string, nowMs = Date.now()): AgentPolicy | undefined {
  const policy = findActivePolicy({ agentIdOrPolicyId, nowMs });
  if (!policy) return undefined;

  db.prepare("UPDATE agent_policies SET revokedAtMs = ? WHERE policyId = ?").run(nowMs, policy.policyId);
  return { ...policy, revokedAtMs: nowMs };
}

export function revokeAgentPolicyByPolicyId(policyId: string, nowMs = Date.now()): AgentPolicy | undefined {
  const policy = findActivePolicy({ agentIdOrPolicyId: policyId, nowMs });
  if (!policy) return undefined;

  db.prepare("UPDATE agent_policies SET revokedAtMs = ? WHERE policyId = ?").run(nowMs, policy.policyId);
  return { ...policy, revokedAtMs: nowMs };
}

export function updateAgentPolicyOnChainId(policyId: string, onChainPolicyId: string) {
  db.prepare("UPDATE agent_policies SET onChainPolicyId = ? WHERE policyId = ?").run(onChainPolicyId, policyId);
}

export function findActivePolicy(args: {
  agentIdOrPolicyId?: string;
  counterparty?: string | null;
  category?: string | null;
  nowMs?: number;
}): AgentPolicy | undefined {
  return findActivePolicies(args)[0];
}

export function findActivePolicies(args: {
  agentIdOrPolicyId?: string;
  counterparty?: string | null;
  category?: string | null;
  nowMs?: number;
}): AgentPolicy[] {
  const nowMs = args.nowMs ?? Date.now();
  const policies = db.prepare(`
    SELECT * FROM agent_policies
    WHERE revokedAtMs IS NULL
      AND (expiresAtMs IS NULL OR expiresAtMs >= ?)
    ORDER BY createdAtMs DESC
  `).all(nowMs) as AgentPolicy[];

  return policies.filter(policy => {
    if (args.agentIdOrPolicyId && policy.agentId !== args.agentIdOrPolicyId && policy.policyId !== args.agentIdOrPolicyId) {
      return false;
    }

    if (args.counterparty && policy.counterparty && policy.counterparty.toLowerCase() !== args.counterparty.toLowerCase()) {
      return false;
    }

    if (args.category && policy.category && policy.category.toLowerCase() !== args.category.toLowerCase()) {
      return false;
    }

    return true;
  });
}

export function insertAgentActionLog(log: AgentActionLog) {
  const stmt = db.prepare(`
    INSERT INTO agent_action_logs (
      actionId, onChainActionId, policyId, agentId, counterparty, recipientAddress, category, amountNgn,
      amountMist, currency, proposedText, status, reason, idempotencyKey, txDigest, onChainTxDigest,
      approvalOnChainActionId, approvalOnChainTxDigest, approvedBy, approvedAtMs, balanceBeforeMist,
      balanceAfterMist, reconciledRecordObjectId, reconciledAtMs, createdAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    log.actionId,
    log.onChainActionId,
    log.policyId,
    log.agentId,
    log.counterparty,
    log.recipientAddress,
    log.category,
    log.amountNgn,
    log.amountMist,
    log.currency,
    log.proposedText,
    log.status,
    log.reason,
    log.idempotencyKey,
    log.txDigest,
    log.onChainTxDigest,
    log.approvalOnChainActionId,
    log.approvalOnChainTxDigest,
    log.approvedBy,
    log.approvedAtMs,
    log.balanceBeforeMist,
    log.balanceAfterMist,
    log.reconciledRecordObjectId,
    log.reconciledAtMs,
    log.createdAtMs,
  );
}

export function getAgentActionLog(actionId: string): AgentActionLog | undefined {
  return db.prepare("SELECT * FROM agent_action_logs WHERE actionId = ? LIMIT 1")
    .get(actionId) as AgentActionLog | undefined;
}

export function findAgentActionByIdempotencyKey(idempotencyKey: string): AgentActionLog | undefined {
  return db.prepare("SELECT * FROM agent_action_logs WHERE idempotencyKey = ? LIMIT 1")
    .get(idempotencyKey) as AgentActionLog | undefined;
}

export function sumExecutedAgentSpend(args: {
  policyId: string;
  currency: "NGN" | "SUI";
  sinceMs: number;
}): number {
  const amountColumn = args.currency === "SUI" ? "amountMist" : "amountNgn";
  const result = db.prepare(`
    SELECT COALESCE(SUM(${amountColumn}), 0) AS total
    FROM agent_action_logs
    WHERE policyId = ?
      AND currency = ?
      AND status = 'executed'
      AND createdAtMs >= ?
  `).get(args.policyId, args.currency, args.sinceMs) as { total: number | null };
  return result.total ?? 0;
}

export function updateAgentActionOnChainId(actionId: string, onChainActionId: string, onChainTxDigest: string | null) {
  db.prepare(`
    UPDATE agent_action_logs
    SET onChainActionId = ?, onChainTxDigest = ?, txDigest = COALESCE(txDigest, ?)
    WHERE actionId = ?
  `).run(onChainActionId, onChainTxDigest, onChainTxDigest, actionId);
}

export function updateAgentActionAfterApproval(args: {
  actionId: string;
  status: "executed" | "rejected" | "failed";
  reason: string;
  txDigest: string | null;
  approvalOnChainActionId: string | null;
  approvalOnChainTxDigest: string | null;
  approvedBy: string | null;
  approvedAtMs: number | null;
  balanceBeforeMist: number | null;
  balanceAfterMist: number | null;
}): AgentActionLog | undefined {
  db.prepare(`
    UPDATE agent_action_logs
    SET status = ?,
        reason = ?,
        txDigest = ?,
        approvalOnChainActionId = ?,
        approvalOnChainTxDigest = ?,
        approvedBy = ?,
        approvedAtMs = ?,
        balanceBeforeMist = ?,
        balanceAfterMist = ?
    WHERE actionId = ?
  `).run(
    args.status,
    args.reason,
    args.txDigest,
    args.approvalOnChainActionId,
    args.approvalOnChainTxDigest,
    args.approvedBy,
    args.approvedAtMs,
    args.balanceBeforeMist,
    args.balanceAfterMist,
    args.actionId,
  );
  return getAgentActionLog(args.actionId);
} 

export function getAgentActionLogs(limit = 20): AgentActionLog[] {
  return db.prepare(`
    SELECT * FROM agent_action_logs
    ORDER BY createdAtMs DESC
    LIMIT ?
  `).all(limit) as AgentActionLog[];
}

export function updateAgentActionReconciledRecord(args: {
  actionId: string;
  reconciledRecordObjectId: string;
  reconciledAtMs?: number;
}): AgentActionLog | undefined {
  db.prepare(`
    UPDATE agent_action_logs
    SET reconciledRecordObjectId = ?,
        reconciledAtMs = ?
    WHERE actionId = ?
  `).run(args.reconciledRecordObjectId, args.reconciledAtMs ?? Date.now(), args.actionId);
  return getAgentActionLog(args.actionId);
}

export function getMonthlySummary(yearMonth: string) {
  // yearMonth expected as "YYYY-MM"
  const startMs = new Date(`${yearMonth}-01T00:00:00Z`).getTime();
  
  // Calculate end of the month
  const year = parseInt(yearMonth.split("-")[0]!, 10);
  const month = parseInt(yearMonth.split("-")[1]!, 10);
  const endMs = new Date(year, month, 1).getTime(); // Starts at 00:00:00 on the 1st of the next month

  const recordsStmt = db.prepare(`
    SELECT * FROM records 
    WHERE createdAtMs >= ? AND createdAtMs < ?
    ORDER BY createdAtMs ASC
  `);
  const records = recordsStmt.all(startMs, endMs) as DbRecord[];

  let cashIn = 0;
  let cashOut = 0;
  const counterparties: Record<string, number> = {};

  for (const r of records) {
    if (r.amountNgn) {
      if (r.recordType === "payment_in") {
        cashIn += r.amountNgn;
      } else if (r.recordType === "payment_out") {
        cashOut += r.amountNgn;
      }

      if (r.counterparty) {
        counterparties[r.counterparty] = (counterparties[r.counterparty] || 0) + r.amountNgn;
      }
    }
  }

  const topCounterparties = Object.entries(counterparties)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, total]) => ({ name, total }));

  return {
    records,
    cashIn,
    cashOut,
    topCounterparties,
  };
}
