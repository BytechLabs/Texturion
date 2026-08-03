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
 * The digest line, for a batch that has come due.
 *
 * "4 new messages across 3 conversations" is one useful notification instead of
 * four interruptions — and it says BOTH numbers because they answer different
 * questions. Four messages from one customer is a conversation; four across
 * four is a morning.
 */
export function digestLine(messages: number, conversations: number): string {
  const m = messages === 1 ? "1 new message" : `${messages} new messages`;
  if (conversations <= 1) return m;
  return `${m} across ${conversations} conversations`;
}

/** What the settings screen says, in one place. */
export const DELIVERY_COPY = {
  heading: "How much we tell you",
  /** The promise that makes batching safe to choose. */
  urgent_always:
    "An emergency, a page while you are on call, or an alert nobody picked " +
    "up always arrives straight away, whatever you choose here.",
  immediate: "Straight away",
  batched: "Grouped up",
  summary: "Once a day",
  /** Said next to `summary`, because it is the one people misread as off. */
  summary_detail: "Held for your daily summary, not discarded.",
} as const;

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  messages_mine: "Texts on my jobs",
  messages_all: "Texts on anyone's jobs",
  mentions: "When somebody @s me",
  assignments: "Work handed to me",
  missed_calls: "Missed calls",
  voicemails: "Voicemails",
};
