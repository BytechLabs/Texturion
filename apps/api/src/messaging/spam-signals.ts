/**
 * [#250] Does this inbound message look like a robotext?
 *
 * # The hard constraint, which shapes everything below
 *
 * **Every genuine new customer is an unknown sender with no prior outbound.**
 * That is the definition of a new lead. So any rule keying mainly on "we have
 * not heard from them before" eats exactly the messages that make our
 * customers money, and a misfiled customer is a lost job.
 *
 * The consequence: "unknown sender" is a PRECONDITION here, never a signal.
 * It only decides whether to look at all. What earns a score is evidence a
 * human customer would not produce — a sender that cannot be dialled, a URL
 * shortener, an unsubscribe footer, a body that reads like a broadcast.
 *
 * # What this does NOT do
 *
 * It never sets `is_spam`. That column is the human's, and keeping the two
 * apart is what makes "the machine was wrong" observable rather than an
 * argument. This writes a suspicion the crew can see and clear in one tap;
 * the only thing suspicion changes is whether we wake somebody's phone.
 *
 * Modelled on `looksLikeOptOut` in inbound.ts, which flags and lets a human
 * decide for the same reason.
 */

/** One reason a message scored, kept so the badge can say WHY. */
export interface SpamSignal {
  key: string;
  weight: number;
  why: string;
}

export interface SpamVerdict {
  score: number;
  signals: SpamSignal[];
  /** At or above the threshold: worth not waking somebody at 6am. */
  suspected: boolean;
}

/**
 * The score at which we stop pushing a notification.
 *
 * Deliberately high enough that one signal alone is never sufficient. A
 * shortener in a message from a real customer ("here's the photo <link>") is
 * common; a shortener AND a broadcast opener AND an unsubscribe footer is not.
 */
export const SPAM_SUSPECT_THRESHOLD = 3;

/**
 * A sender that cannot be a person's mobile.
 *
 * Shortcodes (5-6 digits) and alphanumeric sender IDs are provisioned for
 * bulk sending; a customer texting about a leaking tap has an E.164 mobile.
 * This is the single strongest non-content signal available without a model.
 */
function senderIsNotDialable(from: string): boolean {
  const trimmed = from.trim();
  if (trimmed === "") return false;
  // Alphanumeric sender ID: contains a letter anywhere.
  if (/[A-Za-z]/.test(trimmed)) return true;
  const digits = trimmed.replace(/\D/g, "");
  // A NANP number is 10 digits, or 11 with the country code. 5-6 is a
  // shortcode. Anything shorter than 7 cannot be dialled as a subscriber line.
  return digits.length > 0 && digits.length <= 6;
}

/** Link shorteners, which exist to hide a destination. */
const SHORTENER =
  /\b(?:bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|rb\.gy|cutt\.ly|shorturl\.at|tiny\.cc|rebrand\.ly)\b/i;

/**
 * The footer a compliant bulk sender is obliged to include, and which no
 * human types. Its PRESENCE is the signal — this is not opt-out handling,
 * which is `keywords.ts` and legally load-bearing.
 */
const BULK_FOOTER =
  /\b(?:reply\s+stop\s+to\s+(?:opt\s*out|unsubscribe|cancel)|text\s+stop\s+to\s+(?:opt\s*out|unsubscribe|cancel)|to\s+unsubscribe|msg\s*&\s*data\s+rates|std(?:\s+msg)?\s*&?\s*data\s+rates)\b/i;

/** Openers that address a list rather than a person. */
const BROADCAST_OPENER =
  /\b(?:limited\s+time\s+offer|act\s+now|claim\s+your|you(?:'ve|\s+have)\s+been\s+selected|congratulations[,!\s]+you|final\s+notice|exclusive\s+offer|risk[-\s]free|100%\s+free|click\s+here\s+now)\b/i;

/**
 * Impersonation shapes. Not "is this a bank" — that would flag a customer
 * mentioning their bank — but the specific combination of an authority claim
 * with an urgent instruction, which is what a phishing SMS is.
 */
const AUTHORITY_URGENCY =
  /\b(?:your\s+(?:account|package|parcel|delivery|payment|refund|card)\s+(?:has\s+been|is|was)\s+(?:suspended|locked|held|blocked|on\s+hold|pending)|verify\s+your\s+(?:identity|account|information)\s+(?:now|immediately)|update\s+your\s+(?:payment|billing)\s+(?:details|information)\s+(?:now|immediately))\b/i;

/**
 * Score one inbound message.
 *
 * `knownContact` and `hasPriorOutbound` are the preconditions: if either is
 * true this workspace has a relationship with the sender and we say nothing at
 * all, no matter how the body reads. A regular customer who forwards a
 * marketing text is not a spammer.
 */
export function scoreInboundSpam(args: {
  from: string;
  body: string | null | undefined;
  /** The sender is already a contact in this workspace. */
  knownContact: boolean;
  /** This workspace has texted this number before. */
  hasPriorOutbound: boolean;
}): SpamVerdict {
  // A relationship outranks every content signal there is.
  if (args.knownContact || args.hasPriorOutbound) {
    return { score: 0, signals: [], suspected: false };
  }
  return scoreContent(args.from, args.body);
}

/**
 * The content half, with no relationship input and therefore no database.
 *
 * Split out because it decides whether the relationship lookup is worth doing
 * at all. An ordinary customer text produces NO signals, so the caller can
 * answer "not spam" without asking the database anything — which is the
 * overwhelming majority of inbound, on the hot path of every message this
 * product receives.
 */
export function scoreContent(
  from: string,
  rawBody: string | null | undefined,
): SpamVerdict {
  const body = rawBody ?? "";
  const signals: SpamSignal[] = [];

  if (senderIsNotDialable(from)) {
    signals.push({
      key: "sender_not_dialable",
      weight: 2,
      why: "The sender is a shortcode or a name, not a phone somebody could call back.",
    });
  }
  if (SHORTENER.test(body)) {
    signals.push({
      key: "link_shortener",
      weight: 1,
      why: "It contains a shortened link, which hides where it goes.",
    });
  }
  if (BULK_FOOTER.test(body)) {
    signals.push({
      key: "bulk_footer",
      weight: 2,
      why: "It carries the unsubscribe footer a bulk sender is required to add.",
    });
  }
  if (BROADCAST_OPENER.test(body)) {
    signals.push({
      key: "broadcast_language",
      weight: 2,
      why: "It is written to a list rather than to a person.",
    });
  }
  if (AUTHORITY_URGENCY.test(body)) {
    signals.push({
      // Weight 2, not 3, and the difference is a real case: a customer who
      // forwards a scam to ask "is this you?" quotes the scam verbatim. At
      // weight 3 that question crossed the threshold on its own and their
      // phone stayed silent. No single signal may suspect — see the
      // corroboration test.
      key: "authority_urgency",
      weight: 2,
      why: "It claims an account problem and demands immediate action, the shape of a phishing text.",
    });
  }

  const score = signals.reduce((total, signal) => total + signal.weight, 0);
  return {
    score,
    signals,
    suspected: score >= SPAM_SUSPECT_THRESHOLD,
  };
}
