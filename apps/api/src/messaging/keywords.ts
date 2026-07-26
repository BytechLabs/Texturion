/**
 * The §5 / D3 standalone opt-out / opt-in / help keyword lists — the single
 * canonical source used by BOTH the inbound opt-out handler (inbound.ts) and the
 * shared auto-send guard (auto-send.ts). Telnyx auto-handles STOP/HELP/START
 * (profile-scoped, D3); no app auto-reply may fire ON one of these keywords
 * (FEATURE-GAPS Step 0b: "never fire on a STOP/HELP message").
 *
 * Matching is a case-insensitive exact match of the TRIMMED body — no Telnyx
 * payload flag is relied on.
 */
export const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);

export const START_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);

export const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

/**
 * #414 — the words the product told a homeowner to send.
 *
 * The default away message, shipped enabled and kept by most owners, says:
 * "For a no-heat or burst-pipe emergency, reply URGENT and we'll call you."
 * Nothing handled URGENT. It threaded as an ordinary message, at normal push
 * priority, on a phone face-down on a bedside table.
 *
 * That promise is the PRODUCT's, not the owner's — the homeowner never agreed
 * to anything with us and had no way to know it was unimplemented.
 */
export const EMERGENCY_KEYWORDS = new Set([
  "URGENT",
  "EMERGENCY",
  "911",
  "SOS",
]);

/**
 * True when an inbound reads as the emergency reply we asked for.
 *
 * Matched on the FIRST WORD rather than the whole body, unlike the carrier
 * keywords above. Those are protocol — a subscriber sends exactly "STOP" — and
 * an exact match is right for them. This one is a frightened person at 11pm,
 * who types "URGENT!!", "Urgent - no heat", "URGENT house is freezing". An
 * exact-match rule would have caught none of those and kept none of the
 * promise.
 *
 * Anchoring to the first word is what keeps it from firing on "it's not
 * urgent" or "call me when it's less urgent" — the reply we asked for leads
 * with the word.
 */
export function isEmergencyKeyword(body: string): boolean {
  const first = body
    .trim()
    .split(/[\s,.!?:;-]+/, 1)[0]
    ?.toUpperCase();
  return first !== undefined && EMERGENCY_KEYWORDS.has(first);
}

/**
 * True when the inbound body is a standalone STOP/START/HELP-family keyword
 * (Telnyx handles these; the guard must not auto-reply on them, and the
 * after-hours branch must not treat one as a normal "first inbound").
 */
export function isCarrierKeyword(body: string): boolean {
  const keyword = body.trim().toUpperCase();
  return (
    STOP_KEYWORDS.has(keyword) ||
    START_KEYWORDS.has(keyword) ||
    HELP_KEYWORDS.has(keyword)
  );
}

/**
 * #414: an emergency must never draw the ordinary away reply.
 *
 * Without this, someone who did exactly what we asked gets "we're out of the
 * office right now and will reply first thing. For a no-heat or burst-pipe
 * emergency, reply URGENT and we'll call you" — the same instruction, again,
 * in answer to having followed it. A robot telling a person with a gas smell
 * to wait until morning is worse than saying nothing.
 */
export function suppressesAutoReply(body: string): boolean {
  return isCarrierKeyword(body) || isEmergencyKeyword(body);
}
