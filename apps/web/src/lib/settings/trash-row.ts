import { formatPhone } from "@/lib/format/phone";
import type { Translate } from "@/i18n/provider";
import type { TrashRow } from "@/lib/api/trash";

/**
 * #691 — the words and the arithmetic of one Trash row, kept out of the
 * component so the two facts people act on (what is it, how long is left) are
 * tested rather than eyeballed.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days until the purge, rounded up, and 0 when less than a day remains:
 * "1 day left" must never mean "gone in an hour".
 */
export function daysLeft(purgeAfter: string, now: Date = new Date()): number {
  const remaining = new Date(purgeAfter).getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining < DAY_MS) return 0;
  return Math.ceil(remaining / DAY_MS);
}

export function daysLeftLabel(
  purgeAfter: string,
  t: Translate,
  now: Date = new Date(),
): string {
  const days = daysLeft(purgeAfter, now);
  if (days === 0) return t("trash.daysLeftToday");
  if (days === 1) return t("trash.daysLeftOne");
  return t("trash.daysLeftMany", { count: days });
}

export function kindLabel(row: TrashRow, t: Translate): string {
  switch (row.kind) {
    case "conversation":
      return t("trash.kindConversation");
    case "message":
      return row.message.direction === "note"
        ? t("trash.kindNote")
        : t("trash.kindMessage");
    case "call":
      return t("trash.kindCall");
    case "voicemail":
      return t("trash.kindVoicemail");
  }
}

function detailsOf(row: TrashRow) {
  switch (row.kind) {
    case "conversation":
      return row.conversation;
    case "message":
      return row.message;
    case "call":
      return row.call;
    case "voicemail":
      return row.voicemail;
  }
}

/** The customer, as a name when there is one and a number when there is not. */
export function whoLabel(row: TrashRow, t: Translate): string {
  const details = detailsOf(row);
  const name = details.contact_name?.trim();
  if (name) return name;
  if (details.contact_phone) return formatPhone(details.contact_phone);
  return t("trash.unknownContact");
}

/** The second line: what is inside, in a few words. */
export function detailLabel(row: TrashRow, t: Translate): string {
  switch (row.kind) {
    case "conversation": {
      const count = row.conversation.message_count;
      return count === 1
        ? t("trash.messageCountOne", { count })
        : t("trash.messageCountMany", { count });
    }
    case "message": {
      const snippet = row.message.snippet?.trim();
      return snippet ? snippet : t("trash.noSnippet");
    }
    case "call": {
      const { outcome, has_voicemail } = row.call;
      const base =
        outcome === "missed"
          ? t("trash.callOutcomeMissed")
          : outcome === "voicemail"
            ? t("trash.callOutcomeVoicemail")
            : t("trash.callOutcomeAnswered");
      return has_voicemail && outcome !== "voicemail"
        ? `${base} · ${t("trash.callWithVoicemail")}`
        : base;
    }
    case "voicemail":
      return row.voicemail.voicemail_seconds
        ? t("trash.voicemailLength", { seconds: row.voicemail.voicemail_seconds })
        : t("trash.kindVoicemail");
  }
}
