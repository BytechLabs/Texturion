import type { MmsMediaKind } from "@loonext/shared";

/**
 * What to call an attachment in a one-line preview.
 *
 * Founder report (live device): a customer's voice message showed in the inbox
 * as "Photo". Every client was guessing a noun from a bare `has_attachments`
 * boolean. The list now reads the kind from the server
 * (api_list_conversations → last_message.attachment_kind), and this is the one
 * place that turns a kind + count into words, so the inbox can never again call
 * a voice message a photo.
 */
export function attachmentLabel(
  kind: MmsMediaKind | null,
  count: number,
): string {
  const n = Math.max(count, 1);
  const many = n > 1;
  switch (kind) {
    case "image":
      return many ? `${n} photos` : "Photo";
    case "audio":
      return many ? `${n} audio messages` : "Audio message";
    case "video":
      return many ? `${n} videos` : "Video";
    case "contact":
      return many ? `${n} contact cards` : "Contact card";
    case "calendar":
      return many ? `${n} calendar invites` : "Calendar invite";
    case "document":
      return many ? `${n} PDFs` : "PDF";
    case "text":
      return many ? `${n} text files` : "Text file";
    default:
      // Unknown kind, or a message carrying a MIXED set: the honest noun.
      return many ? `${n} attachments` : "Attachment";
  }
}

/**
 * The single kind shared by every attachment on a message, or null when they
 * disagree (a mixed set gets the neutral "attachments" wording). Mirrors the
 * SQL in migration 20260724080000 so a row rendered from the local thread cache
 * reads exactly like the same row rendered from the server snippet.
 */
export function sharedMediaKind(
  kinds: readonly MmsMediaKind[],
): MmsMediaKind | null {
  if (kinds.length === 0) return null;
  const first = kinds[0];
  return kinds.every((kind) => kind === first) ? first : null;
}
