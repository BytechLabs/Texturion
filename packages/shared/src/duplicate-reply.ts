/**
 * #408 — two techs answering the same customer, thirty seconds apart.
 *
 * A customer texts "Can you come Tuesday?". Two techs get the notification,
 * both open the thread, both type, and the customer receives "Yes, 9am works"
 * followed by "Sorry, we're booked Tuesday". From the same business.
 *
 * That is the exact confusion a shared inbox exists to eliminate, recreated
 * inside the tool — with the added cost that the customer now watches the crew
 * disagree with itself.
 *
 * ---------------------------------------------------------------------------
 * THE PRODUCT CREATES THIS RACE ON PURPOSE, AND THAT IS STILL RIGHT.
 *
 * An unassigned inbound notifies EVERY active member, which is correct for
 * "never miss a lead" and is the whole of #388's argument. Most new threads
 * are unassigned, so the default path for a new customer is: tell everyone.
 * The window between "everyone is told" and "somebody claims it" is exactly
 * the window both replies get written in, and it is worst on a spike day when
 * every thread is new and the whole crew is in the inbox.
 *
 * ---------------------------------------------------------------------------
 * SO THIS WARNS, IT DOES NOT BLOCK.
 *
 * A duplicate reply is genuinely better than no reply. Anything that
 * discourages a tech from answering works against the point of the product and
 * against the five-minute window that decides the job. The confirmation exists
 * so nobody sends INTO a colleague's answer without knowing it is there — not
 * to make them hesitate.
 *
 * WHAT IT COMPARES, AND WHY THAT SHAPE. Not "was there a recent reply" — the
 * question is whether a teammate answered AFTER this draft was begun. A reply
 * from before you started typing is context you already had; one that landed
 * while you were typing is the one you have not seen. That also means a draft
 * left overnight and sent in the morning warns correctly, which a
 * recency-window rule would miss.
 */

export interface DuplicateReplyInput {
  /**
   * When this draft began — the moment the composer first held text. Null when
   * unknown (a draft restored from storage after a reload), which never warns:
   * a warning we cannot justify is worse than none, because the first false
   * one teaches people to dismiss the true ones.
   */
  draftStartedAt: string | null;
  /** When the newest outbound from ANYBODY landed in this thread. */
  lastOutboundAt: string | null;
  /** Who sent it. Null for an automatic send (away reply, missed-call text). */
  lastOutboundByUserId: string | null;
  /** The person about to send. */
  meUserId: string;
}

export interface DuplicateReplyWarning {
  /** Whether to ask before sending. */
  warn: boolean;
  /**
   * Whose reply it was, when a person sent it. Null means the product sent it
   * — an away reply or a missed-call text-back — which still warrants the
   * warning, because the customer has still just received something.
   */
  byUserId: string | null;
}

const NO_WARNING: DuplicateReplyWarning = { warn: false, byUserId: null };

/**
 * Should we ask before this send?
 *
 * Yes when somebody OTHER than the sender put an outbound into this thread at
 * or after the moment the draft began.
 */
export function duplicateReplyWarning(
  input: DuplicateReplyInput,
): DuplicateReplyWarning {
  const { draftStartedAt, lastOutboundAt, lastOutboundByUserId, meUserId } = input;
  if (draftStartedAt === null || lastOutboundAt === null) return NO_WARNING;

  // Your own send is not a collision. Sending twice in a row is a thing people
  // do deliberately — a correction, a second thought, an address after a time
  // — and warning about it would fire on the most ordinary action there is.
  if (lastOutboundByUserId === meUserId) return NO_WARNING;

  const started = Date.parse(draftStartedAt);
  const landed = Date.parse(lastOutboundAt);
  // An unparseable timestamp is a bug somewhere upstream, and the safe
  // direction is silence: this feature must never stand between a tech and a
  // waiting customer on the strength of a date it could not read.
  if (Number.isNaN(started) || Number.isNaN(landed)) return NO_WARNING;

  if (landed < started) return NO_WARNING;
  return { warn: true, byUserId: lastOutboundByUserId };
}

/**
 * The sentence the confirmation opens with.
 *
 * Names the person when we know them, because "Sam replied" is a fact somebody
 * can act on — they can ask Sam — and "someone replied" is not. An automatic
 * send says so plainly rather than borrowing a name it does not have.
 */
export function duplicateReplyPrompt(
  who: string | null,
  secondsAgo: number,
): string {
  const when =
    secondsAgo < 60
      ? "just now"
      : secondsAgo < 3600
        ? `${Math.floor(secondsAgo / 60)} minute${Math.floor(secondsAgo / 60) === 1 ? "" : "s"} ago`
        : secondsAgo < 86_400
          ? `${Math.floor(secondsAgo / 3600)} hour${Math.floor(secondsAgo / 3600) === 1 ? "" : "s"} ago`
          : "since you started writing";
  const actor = who?.trim() || "An automatic reply went out";
  return who?.trim()
    ? `${actor} replied ${when}.`
    : `${actor} ${when}.`;
}
