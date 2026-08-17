/**
 * #297 — how loud, per member, per category.
 *
 * The push layer already solves DUPLICATION: one collapse key coalesces the
 * same subject across three platforms. It does nothing about VOLUME. A crew of
 * six on a busy Tuesday generates a continuous stream, and the only control a
 * member has is an on/off switch — so the predictable outcome is the one that
 * ends every notification system: people turn them off, the emergency stops
 * arriving too, and the product silently stops working for that person while
 * looking perfectly healthy in our metrics.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 *
 * "Batching must never become a way to miss the call that mattered — that is
 * the failure mode that would make this feature worse than the problem."
 *
 * So urgency is not a category and not a preference. It is a property of the
 * EVENT, decided by the code that raises it, and it beats every setting below.
 * `decideDelivery` returns "send" for an urgent event before it has looked at
 * anything else, and that ordering is the feature.
 */
import type { Locale } from "./locale";

/**
 * The categories, in the words a member would use.
 *
 * Not the `kind` discriminators the clients branch on for channel routing —
 * those are structural and there are eleven of them. Somebody choosing how
 * loud their phone is does not think in `conversation_bulk`; they think "texts
 * on my jobs" and "texts on anybody's".
 */
export const NOTIFICATION_CATEGORIES = [
  "messages_mine",
  "messages_all",
  "mentions",
  "assignments",
  "missed_calls",
  "voicemails",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * How a category arrives.
 *
 * `summary` is not `off`. Off already exists, and the difference matters: a
 * member who turns a category off learns nothing about it ever, while summary
 * means "not now, but tell me at the end of the day". The whole point of this
 * issue is that there was no middle setting.
 */
export const DELIVERY_MODES = ["immediate", "batched", "summary"] as const;

export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/**
 * What happens to one event for one member.
 *
 * `send` now, `queue` for the next batch, `hold` for the daily summary. Never
 * "drop" — this module cannot make something disappear, because a member who
 * chose a quieter setting did not choose to lose things, and a decision
 * function that CAN silently discard is one bug away from doing it.
 */
export type DeliveryDecision = "send" | "queue" | "hold";

/** The default for a member who has never touched any of this. */
export const DEFAULT_DELIVERY: Record<NotificationCategory, DeliveryMode> = {
  // Somebody's own jobs stay immediate. This is the traffic they are paid to
  // answer, and quietening it by default would be us deciding they care less
  // about their work than they do.
  messages_mine: "immediate",
  // Everybody else's is where the volume actually comes from on a crew of six,
  // and it is the setting a new workspace would want if anybody asked them.
  // Still immediate by default, because CHANGING what existing members receive
  // without them asking is the one thing a notification change must not do —
  // the batched option is offered, not applied.
  messages_all: "immediate",
  mentions: "immediate",
  assignments: "immediate",
  missed_calls: "immediate",
  voicemails: "immediate",
};

/** How long a batch waits, when a member picks batching. */
export const BATCH_WINDOW_CHOICES = [5, 15, 30, 60] as const;

export type BatchWindowMinutes = (typeof BATCH_WINDOW_CHOICES)[number];

export const DEFAULT_BATCH_WINDOW: BatchWindowMinutes = 15;

/**
 * Decide what to do with one event.
 *
 * URGENCY IS CHECKED FIRST AND UNCONDITIONALLY. Everything else in this file is
 * a preference; this is the promise that makes the preferences safe to offer.
 *
 * An unknown mode sends. A member's settings are data, and data can be older
 * than the code reading it — a value this build has never heard of must not
 * silently swallow somebody's missed call.
 */
export function decideDelivery(input: {
  mode: DeliveryMode | string | null | undefined;
  /**
   * Decided by the code raising the event, never by a setting. An on-call page
   * (#244), an escalation, an emergency keyword — the same signal that already
   * overrides quiet hours.
   */
  urgent: boolean;
}): DeliveryDecision {
  if (input.urgent) return "send";
  if (input.mode === "batched") return "queue";
  if (input.mode === "summary") return "hold";
  return "send";
}

/**
 * #228 — the vocabulary both digests are assembled from, in each language.
 *
 * ONE table for the batch digest and the daily summary, because they are the
 * same kind of sentence: a count of what piled up, composed by the server into
 * a push body. The assembly stays in the functions below — a table that
 * returned finished sentences would have to know about the " · " join and the
 * zero branches, which are structure rather than copy.
 *
 * Every clause takes PLAIN NUMBERS rather than the caller's input object, so
 * nothing in here has to know that `summaryLine` reads its counts off a field
 * called `waiting`.
 */
interface DigestCopy {
  oneMessage: string;
  manyMessages(messages: number): string;
  /** `m` is the message clause above, already built. */
  acrossConversations(m: string, conversations: number): string;
  onePersonWaiting: string;
  manyPeopleWaiting(waiting: number): string;
  oneTaskDue: string;
  manyTasksDue(tasks: number): string;
  nothingWaiting: string;
}

const EN: DigestCopy = {
  oneMessage: "1 new message",
  manyMessages: (messages) => `${messages} new messages`,
  acrossConversations: (m, conversations) =>
    `${m} across ${conversations} conversations`,
  onePersonWaiting: "1 person is waiting on you",
  manyPeopleWaiting: (waiting) => `${waiting} people are waiting on you`,
  oneTaskDue: "1 task is due",
  manyTasksDue: (tasks) => `${tasks} tasks are due`,
  nothingWaiting: "Nothing is waiting. Nice day.",
};

const FR_CA: DigestCopy = {
  oneMessage: "1 nouveau message",
  // Plural agreement rides the adjective, so one form covers every count >= 2.
  // Neither language has a zero branch: a digest never fires empty.
  manyMessages: (messages) => `${messages} nouveaux messages`,
  // "dans" rather than "réparties sur": shorter on a lock screen, and
  // "conversation" is already the house term the inbox uses.
  acrossConversations: (m, conversations) =>
    `${m} dans ${conversations} conversations`,
  onePersonWaiting: "1 personne attend après vous",
  manyPeopleWaiting: (waiting) => `${waiting} personnes attendent après vous`,
  // "Échéance" is the settled house term for a due date (tasks, For You, the
  // contact timeline), which is why this is not "1 tâche est due" — an
  // anglicism — and why it reads as a noun phrase: it sits after a " · ".
  oneTaskDue: "1 tâche arrive à échéance",
  // "à échéance" is invariable, so the same form covers every count >= 2.
  manyTasksDue: (tasks) => `${tasks} tâches arrivent à échéance`,
  // Warm rather than a "0 waiting, 0 due" readout, in both languages. This is
  // the one branch that carries its own periods — see `summaryLine`.
  nothingWaiting: "Rien n'attend après vous. Bonne journée.",
};

const DIGEST_COPY: Record<Locale, DigestCopy> = { en: EN, "fr-CA": FR_CA };

/**
 * The digest line, for a batch that has come due.
 *
 * "4 new messages across 3 conversations" is one useful notification instead of
 * four interruptions — and it says BOTH numbers because they answer different
 * questions. Four messages from one customer is a conversation; four across
 * four is a morning.
 */
export function digestLine(
  messages: number,
  conversations: number,
  locale: Locale,
): string {
  const copy = DIGEST_COPY[locale];
  const m = messages === 1 ? copy.oneMessage : copy.manyMessages(messages);
  if (conversations <= 1) return m;
  return copy.acrossConversations(m, conversations);
}

/**
 * What the settings screen says, in one place.
 *
 * #228: KEYS here, and SENTENCES above. `digestLine`, `summaryLine` and
 * `SUMMARY_TITLE` are composed by the server into a push notification body, so
 * a key there would reach a lock screen as its own name — they take the
 * reader's language instead and answer in it, which is the wire change rather
 * than the catalogue one. These two are read by a screen that has `t()` in
 * scope, so a key is the right shape for them.
 */
export const DELIVERY_COPY = {
  heading: "domain.deliveryHeading",
  /** The promise that makes batching safe to choose. */
  urgent_always: "domain.deliveryUrgentAlways",
  immediate: "domain.deliveryImmediate",
  batched: "domain.deliveryBatched",
  summary: "domain.deliverySummary",
  /** Said next to `summary`, because it is the one people misread as off. */
  summary_detail: "domain.deliverySummaryDetail",
} as const;

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  messages_mine: "domain.categoryMessagesMine",
  messages_all: "domain.categoryMessagesAll",
  mentions: "domain.categoryMentions",
  assignments: "domain.categoryAssignments",
  missed_calls: "domain.categoryMissedCalls",
  voicemails: "domain.categoryVoicemails",
};

/**
 * #297 — the daily summary, in the words an owner would use.
 *
 * "They want to know how the day went — what came in, what is still
 * unanswered, what is due tomorrow."
 *
 * IT LEADS WITH WHAT IS OWED, not with what happened. "12 texts came in" is a
 * statistic; "3 people are still waiting on you" is a to-do list, and the
 * second is the one worth opening the app for. A summary that led with volume
 * would be a report about a busy day rather than a prompt to finish it.
 */
export function summaryLine(
  input: {
    waiting: number;
    tasks: number;
  },
  locale: Locale,
): string {
  const copy = DIGEST_COPY[locale];
  const parts: string[] = [];
  if (input.waiting > 0) {
    parts.push(
      input.waiting === 1
        ? copy.onePersonWaiting
        : copy.manyPeopleWaiting(input.waiting),
    );
  }
  if (input.tasks > 0) {
    parts.push(input.tasks === 1 ? copy.oneTaskDue : copy.manyTasksDue(input.tasks));
  }
  // The quiet day is a real answer and it is the nicest one this product can
  // give. Saying nothing at all would read as a broken summary; saying "0
  // waiting, 0 due" reads like a spreadsheet.
  if (parts.length === 0) return copy.nothingWaiting;
  // The separator and the closing period are STRUCTURE, which is why neither
  // language's clauses carry terminal punctuation of their own.
  return `${parts.join(" · ")}.`;
}

/**
 * The title, which never changes within a language, so the notification is
 * recognisable.
 *
 * The French runs to 21 characters, well inside the ~40 an OS shows before it
 * truncates a title on a lock screen.
 */
export const SUMMARY_TITLE: Record<Locale, string> = {
  en: "Where things stand",
  "fr-CA": "Où en sont les choses",
};
