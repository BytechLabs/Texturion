/**
 * #302 — who else is on this conversation right now.
 *
 * THE PROBLEM IS THE PRODUCT'S OWN SHAPE. The inbox is shared by design — that
 * is the pitch — but nothing in it knows two people may be looking at the same
 * thread. So on an ordinary Tuesday a customer gets two answers thirty seconds
 * apart, sometimes disagreeing about price. From the homeowner's side that is
 * not "a busy team", it is a business that does not know what it is doing,
 * which is the exact impression the product exists to prevent. The quieter
 * failure costs more: everyone assumes somebody else has it and nobody replies.
 *
 * WHAT THIS FILE IS. The rule, once, for all three clients: who counts as
 * present, when presence has gone stale, and what the crew is told. The
 * transport is Supabase Realtime presence on the number-scoped topic the
 * clients already join, which is why there is no new authorization surface —
 * a conversation belongs to exactly one phone number, and access to that number
 * is already the access boundary for the conversation (#106, D88).
 *
 * ADVISORY, NEVER A LOCK. #302 is explicit and right: locking a conversation is
 * worse than the collision. The person holding the lock walks into a basement
 * and the customer waits. Everything here informs; nothing here prevents.
 *
 * STALE PRESENCE IS WORSE THAN NONE. It tells somebody a colleague has this
 * when they shut the laptop ten minutes ago — which produces exactly the
 * nobody-replies failure the feature exists to fix. Hence the short TTLs below
 * and `presenceFor`'s refusal to report anything at all on an unhealthy
 * connection.
 */

/** One teammate's presence on one conversation, as broadcast. */
export interface PresenceEntry {
  /** Who. The presence key too, so one person on two devices collapses. */
  user_id: string;
  /** What the crew calls them. Empty is tolerated; the label falls back. */
  display_name: string;
  /** Which conversation they are looking at. */
  conversation_id: string;
  /**
   * When they last said so, epoch ms. Sent by the CLIENT, which is why
   * `presenceFor` treats a wildly future value as untrustworthy rather than as
   * permanently fresh — a phone with a wrong clock must not pin a ghost to a
   * thread forever.
   */
  at: number;
  /** Whether they are composing a reply right now. */
  typing?: boolean;
}

/**
 * How long a heartbeat is believed.
 *
 * Presence also disappears when the socket drops, so this is the backstop for
 * the case that has actually bitten twice (#215): a connection that goes quietly
 * dead while still looking open. 45s is long enough to survive a tab throttled
 * in the background and short enough that a closed laptop stops speaking for the
 * person who closed it.
 */
export const PRESENCE_TTL_MS = 45_000;

/** How often a client re-announces. Comfortably inside the TTL. */
export const PRESENCE_HEARTBEAT_MS = 15_000;

/**
 * How long "typing" survives its last keystroke.
 *
 * Deliberately short. A typing flag that outlives the typing is the stale-
 * presence failure in miniature, and the cost of it expiring early is only that
 * the label falls back to "also here", which is still true.
 */
export const TYPING_TTL_MS = 6_000;

/**
 * How often a client may re-announce typing. The keystroke rate is not the
 * broadcast rate: presence is chatty by nature and #251 has never measured this
 * fan-out, so the client sends at most one update per interval.
 */
export const TYPING_THROTTLE_MS = 2_000;

export interface Viewer {
  user_id: string;
  display_name: string;
  typing: boolean;
}

/**
 * Everyone ELSE on this conversation, freshest first, stale entries dropped.
 *
 * `healthy` is not a convenience flag. When the realtime connection is
 * degraded, the honest answer is "we do not know", and the honest RENDER of
 * that is nothing at all — showing the last known viewers would be asserting a
 * colleague is here on the strength of information we know we are no longer
 * receiving.
 */
export function presenceFor(
  entries: readonly PresenceEntry[],
  options: {
    conversationId: string;
    /** The viewer themselves, who is never their own collision. */
    selfUserId: string;
    now: number;
    healthy: boolean;
  },
): Viewer[] {
  if (!options.healthy) return [];

  const seen = new Map<string, { entry: PresenceEntry; typing: boolean }>();
  for (const entry of entries) {
    if (entry.conversation_id !== options.conversationId) continue;
    if (entry.user_id === options.selfUserId) continue;

    const age = options.now - entry.at;
    // A timestamp from the future is a clock we cannot trust. Tolerate a small
    // skew, and beyond that treat it as unusable rather than as eternally
    // fresh — the alternative pins a ghost to the thread until a reload.
    if (age < -PRESENCE_TTL_MS) continue;
    if (age > PRESENCE_TTL_MS) continue;

    // One person, two devices: the freshest entry wins, but typing on EITHER
    // counts. They are replying on their phone whether or not the laptop knows.
    const prior = seen.get(entry.user_id);
    const typing = (entry.typing === true && age <= TYPING_TTL_MS) || (prior?.typing ?? false);
    if (!prior || entry.at > prior.entry.at) {
      seen.set(entry.user_id, { entry, typing });
    } else if (typing !== prior.typing) {
      seen.set(entry.user_id, { entry: prior.entry, typing });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.entry.at - a.entry.at)
    .map(({ entry, typing }) => ({
      user_id: entry.user_id,
      display_name: entry.display_name.trim() || "A teammate",
      typing,
    }));
}

/**
 * The one line the crew reads.
 *
 * Typing outranks viewing, because "Sam is replying" is the single piece of
 * information that stops a second person mid-sentence — which is the whole
 * point. Past two names it counts rather than lists: a row of names is a wall,
 * and the actionable fact is only that somebody else is here.
 *
 * Returns null when there is nothing to say, so a caller renders nothing rather
 * than an empty strip that reserves space for an absence.
 */
export function presenceLabel(viewers: readonly Viewer[]): string | null {
  if (viewers.length === 0) return null;

  const typing = viewers.filter((viewer) => viewer.typing);
  if (typing.length === 1) return `${typing[0].display_name} is replying…`;
  if (typing.length === 2) {
    return `${typing[0].display_name} and ${typing[1].display_name} are replying…`;
  }
  if (typing.length > 2) return `${typing.length} people are replying…`;

  if (viewers.length === 1) return `${viewers[0].display_name} is also here`;
  if (viewers.length === 2) {
    return `${viewers[0].display_name} and ${viewers[1].display_name} are also here`;
  }
  return `${viewers.length} teammates are also here`;
}
