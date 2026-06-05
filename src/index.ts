import "dotenv/config";
import { Spectrum } from "spectrum-ts";
import { terminal } from "spectrum-ts/providers/terminal";
import { imessage } from "spectrum-ts/providers/imessage";
import { handleMessage } from "./handler.js";
import { logger } from "./ops/logger.js";
import { checkpointMessageOffset } from "./provider-offsets.js";

const app = await Spectrum({
  projectId: process.env["PHOTON_PROJECT_ID"]!,
  projectSecret: process.env["PHOTON_PROJECT_SECRET"]!,
  providers: [
    terminal.config(),
    imessage.config(),
    // whatsapp.config() — add when WhatsApp Business credentials are ready
  ],
});

logger.info("ledger_runtime_started", { providers: ["terminal", "imessage"] });

for await (const [space, message] of app.messages) {
  const reply = app.send.bind(app, space);
  handleMessage(reply, message)
    .catch(err => {
      logger.error("message_handler_unhandled_error", {
        platform: message.platform,
        messageId: message.id,
        senderId: message.sender.id,
      }, err);
    })
    .finally(() => {
      try {
        checkpointMessageOffset(message);
      } catch (err) {
        logger.error("provider_offset_checkpoint_failed", {
          platform: message.platform,
          messageId: message.id,
          spaceId: message.space.id,
        }, err);
      }
    });
}
