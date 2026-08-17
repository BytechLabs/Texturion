/**
 * #228 — what a thread alert says, in the language the reader chose.
 *
 * Three push sites share this table: a customer's text arriving
 * (`inbound.ts`), a teammate naming somebody in an internal note
 * (`mention.ts`), and work being handed over (`assignment.ts`). One table
 * rather than three because they share literals — the stand-in for a missing
 * profile is the same sentence in two of them, and the sentence that replaces
 * a withheld title is the same in two arms of a third. Two definitions of one
 * string in two files is a string that drifts, and a crew then reads two words
 * for the same person.
 *
 * A MISSING TRANSLATION IS A TYPE ERROR. Every locale implements the same
 * interface, so a string cannot be added in one language and forgotten in the
 * other — which is the whole reason the payload is composed per reader rather
 * than looked up by key.
 *
 * What is NOT in here: contact names, message snippets, note bodies and
 * member-typed task titles. Those are somebody else's words; they pass through
 * untranslated and arrive as ordinary parameters.
 */
import type { Locale } from "@loonext/shared";

interface ThreadPushCopy {
  /**
   * #414: the prefix that says WHAT before WHO, because a phone on a bedside
   * table shows one line. The contact's name rides through it untouched.
   */
  emergencyTitle(contactName: string): string;
  /** §8 snippet fallback for a media-only MMS. */
  snippetAttachment: string;
  /** §8 snippet fallback for an inbound carrying neither text nor media. */
  snippetMessage: string;
  /** #430: what stands in for the customer's words when content is off. */
  inboundWithheldBody: string;
  /** A teammate named you in a note. The author's name is theirs, not ours. */
  mentionTitle(authorName: string): string;
  /**
   * The stand-in when a profile row is gone or blank — substituted into
   * `mentionTitle` and into the three assignment titles alike.
   */
  teammateFallback: string;
  /** #430: what stands in for the note's own words when content is off. */
  mentionWithheldBody: string;
  /**
   * A whole selection handed over at once. The plural branch lives inside the
   * translation because "one vs many" is a rule of the language rather than of
   * the call site — French happening to break where English breaks is exactly
   * the coincidence a shared `noun` argument would have hidden.
   */
  assignBulkTitle(actorName: string, count: number): string;
  /** The bulk alert's body, and its withheld form: a count has nothing to hide. */
  assignBulkBody: string;
  /** A single task handed to one person. */
  assignTaskTitle(actorName: string): string;
  /** The task alert's body when the member typed no title. */
  taskTitleFallback: string;
  /** #430: what survives on both single-item arms when content is off. */
  assignWithheldBody: string;
  /** A single thread handed to one person. */
  assignConversationTitle(actorName: string): string;
}

const EN: ThreadPushCopy = {
  emergencyTitle: (contactName) => `EMERGENCY — ${contactName}`,
  snippetAttachment: "Sent an attachment",
  snippetMessage: "Sent a message",
  inboundWithheldBody: "Sent you a message",
  mentionTitle: (authorName) => `${authorName} mentioned you`,
  teammateFallback: "A teammate",
  mentionWithheldBody: "Mentioned you in a note",
  assignBulkTitle: (actorName, count) =>
    `${actorName} assigned you ${count} ${count === 1 ? "conversation" : "conversations"}`,
  assignBulkBody: "Open your inbox to see them",
  assignTaskTitle: (actorName) => `${actorName} assigned you a task`,
  taskTitleFallback: "A task",
  assignWithheldBody: "Open the app to see it",
  assignConversationTitle: (actorName) =>
    `${actorName} assigned you a conversation`,
};

const FR: ThreadPushCopy = {
  // URGENCE is two characters SHORTER than EMERGENCY, so the French title
  // truncates later than the English one — nothing to shorten here.
  emergencyTitle: (contactName) => `URGENCE — ${contactName}`,
  // "pièce jointe" is the settled house term (domain.ts sendFailureAttachment)
  // and stays as generic as the English: per #189 an MMS is not photos-only.
  snippetAttachment: "A envoyé une pièce jointe",
  snippetMessage: "A envoyé un message",
  // Subjectless like the English: the subject is the contact named in the title.
  inboundWithheldBody: "Vous a envoyé un message",
  // Active voice, unlike the passive bell-feed string (misc.ts notifMention):
  // that form has no room for the author, and knowing WHO wants you is the
  // whole point of a mention.
  mentionTitle: (authorName) => `${authorName} vous a mentionné`,
  // The shell/settings majority ("un coéquipier"); thread.ts and tasks.ts each
  // chose differently, so the term is contested and this file picks once.
  teammateFallback: "Un coéquipier",
  mentionWithheldBody: "Vous a mentionné dans une note",
  // "assigné" rather than "attribué": misc.ts already says "vous a été assigné"
  // for exactly these notifications. The participle takes no agreement here
  // because the direct object follows it.
  assignBulkTitle: (actorName, count) =>
    `${actorName} vous a assigné ${count} ${count === 1 ? "conversation" : "conversations"}`,
  // Bodies are not truncated at ~40 chars the way titles are, so the full
  // house phrase ("boîte de réception", shell.ts navInbox) fits.
  assignBulkBody: "Ouvrez votre boîte de réception pour les voir",
  assignTaskTitle: (actorName) => `${actorName} vous a assigné une tâche`,
  taskTitleFallback: "Une tâche",
  // "la" agrees with the two current referents, une tâche and une conversation.
  // A third arm with a masculine referent would need "pour le voir".
  assignWithheldBody: "Ouvrez l'application pour la voir",
  assignConversationTitle: (actorName) =>
    `${actorName} vous a assigné une conversation`,
};

export const THREAD_PUSH_COPY: Record<Locale, ThreadPushCopy> = {
  en: EN,
  "fr-CA": FR,
};
