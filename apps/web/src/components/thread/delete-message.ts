import type { Message } from "@/lib/api/types";

/**
 * #691 — which sentence follows deleting this message.
 *
 * A text that left for the customer cannot be unsent: deleting it removes it
 * from Loonext only, and the toast has to say so or the crew assumes the
 * customer no longer has an abusive or mistaken text. A failed send never
 * reached them, and a note never leaves the workspace, so neither carries that
 * caveat.
 */
export function deletedMessageKey(
  message: Pick<Message, "direction" | "status">,
): "trash.noteDeleted" | "trash.messageDeletedSent" | "trash.messageDeleted" {
  if (message.direction === "note") return "trash.noteDeleted";
  if (message.direction === "outbound" && message.status !== "failed") {
    return "trash.messageDeletedSent";
  }
  return "trash.messageDeleted";
}
