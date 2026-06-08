import { parseRecordMetadataFields } from "./sui/read.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const metadata = parseRecordMetadataFields({
  actor_type: "1",
  actor_id: Array.from(Buffer.from("fuel-agent", "utf8")),
  tx_digest: Array.from(Buffer.from("payment-digest", "utf8")),
  linked_policy_id: Array.from(Buffer.from("0xpolicy", "utf8")),
  action_status: 3,
});

assert(metadata.actorType === 1, "expected agent actor type");
assert(metadata.actorId === "fuel-agent", "expected decoded actor id");
assert(metadata.txDigest === "payment-digest", "expected decoded tx digest");
assert(metadata.linkedPolicyId === "0xpolicy", "expected decoded policy id");
assert(metadata.actionStatus === 3, "expected action status");

const base64Metadata = parseRecordMetadataFields({
  actor_type: 1,
  actor_id: Buffer.from("payment-agent", "utf8").toString("base64"),
  tx_digest: Buffer.from("payment-digest-2", "utf8").toString("base64"),
  linked_policy_id: Buffer.from("0xpolicy2", "utf8").toString("base64"),
  action_status: "4",
});

assert(base64Metadata.actorType === 1, "expected numeric actor type");
assert(base64Metadata.actorId === "payment-agent", "expected base64 decoded actor id");
assert(base64Metadata.txDigest === "payment-digest-2", "expected base64 decoded tx digest");
assert(base64Metadata.linkedPolicyId === "0xpolicy2", "expected base64 decoded policy id");
assert(base64Metadata.actionStatus === 4, "expected string action status");

console.log("Sui read tests passed.");
