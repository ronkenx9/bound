import type { Message } from "spectrum-ts";
import { upsertProviderOffset } from "./db.js";

type CheckpointableMessage = Pick<Message, "id" | "platform" | "timestamp"> & {
  space: { id: string };
  cursor?: string;
  providerCursor?: string;
  checkpointCursor?: string;
};

function messageCursor(message: CheckpointableMessage): string {
  return message.providerCursor ?? message.checkpointCursor ?? message.cursor ?? message.id;
}

export function checkpointMessageOffset(message: CheckpointableMessage, nowMs = Date.now()) {
  upsertProviderOffset({
    platform: message.platform,
    spaceId: message.space.id,
    cursor: messageCursor(message),
    messageId: message.id,
    messageTimestampMs: message.timestamp?.getTime() ?? null,
    updatedAtMs: nowMs,
  });
}
