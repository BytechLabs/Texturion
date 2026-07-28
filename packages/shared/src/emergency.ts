/**
 * #414 — the words the product told a homeowner to send.
 *
 * The default away message ships enabled and ends "For a no-heat or burst-pipe
 * emergency, reply URGENT and we'll call you." Nothing handled URGENT: it
 * threaded as an ordinary message, at normal push priority, on a phone
 * face-down on a bedside table.
 *
 * This lives in `shared` rather than in the API because two different things
 * need the SAME list and would otherwise drift apart in exactly the way that
 * caused the bug: the inbound handler decides whether a message IS an
 * emergency, and the settings screen decides whether an owner's away message
 * still INVITES one. A list that says URGENT on one side and not the other
 * re-creates the defect with extra steps.
 */
export const EMERGENCY_KEYWORDS = ["URGENT", "EMERGENCY", "911", "SOS"] as const;

const KEYWORD_SET: ReadonlySet<string> = new Set(EMERGENCY_KEYWORDS);

/**
 * True when an inbound reads as the emergency reply we asked for.
 *
 * Matched on the FIRST WORD, unlike the carrier STOP/HELP keywords. Those are
 * protocol — a subscriber sends exactly "STOP" — and an exact match is right
 * for them. This one is a frightened person at 11pm, who types "URGENT!!",
 * "Urgent - no heat", "URGENT house is freezing". An exact-match rule would
 * have caught none of those and kept none of the promise.
 *
 * Anchoring to the first word is what keeps it from firing on "it's not
 * urgent" or "call me when it's less urgent" — the reply we asked for leads
 * with the word, and a crew woken for nothing stops trusting the one that
 * matters.
 */
export function isEmergencyKeyword(body: string): boolean {
  const first = body
    .trim()
    .split(/[\s,.!?:;-]+/, 1)[0]
    ?.toUpperCase();
  return first !== undefined && KEYWORD_SET.has(first);
}

/**
 * True when a piece of OWNER-AUTHORED copy invites the emergency reply —
 * "reply URGENT and we'll call you" — anywhere in its text.
 *
 * Deliberately looser than {@link isEmergencyKeyword}: that one reads what a
 * customer sent and must not over-fire, this one reads what the owner wrote
 * and must not UNDER-fire. Missing an invitation here means the settings
 * screen quietly tells an owner their message is fine while it promises a
 * callback nothing will make — which is the whole defect.
 *
 * Word-boundary anchored, so "we respond urgently" is a tone rather than an
 * instruction. Hyphenated forms ("emergency-only pricing") DO match, which is
 * the right way to be wrong: the cost of an unnecessary warning is an owner
 * reading one extra sentence, and the cost of a missed one is the promise
 * this issue exists to keep.
 */
export function mentionsEmergencyKeyword(copy: string): boolean {
  return EMERGENCY_KEYWORDS.some((keyword) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(copy),
  );
}

/**
 * The words a reply instruction may legitimately name that are NOT ours: the
 * §5/D3 carrier keywords, which Telnyx answers at the network before we see
 * them. "Reply STOP to unsubscribe" is required compliance copy, and warning an
 * owner that STOP is unrecognised would be both wrong and the fastest way to
 * teach them to ignore this warning.
 *
 * Mirrors `STOP_KEYWORDS ∪ START_KEYWORDS ∪ HELP_KEYWORDS` in the API's
 * `keywords.ts`. That file stays the canonical source for the OPT-OUT path —
 * carrier truth is not something to move around casually — so a test there
 * asserts these two lists still agree, and fails the build if a keyword is
 * added on one side only.
 */
export const CARRIER_REPLY_KEYWORDS: readonly string[] = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "START",
  "UNSTOP",
  "YES",
  "HELP",
  "INFO",
] as const;

const CARRIER_SET: ReadonlySet<string> = new Set(CARRIER_REPLY_KEYWORDS);

/**
 * Owners capitalise the word they want sent back — "reply URGENT", "text ASAP".
 * The verb is matched case-insensitively (some owners write the whole message
 * in caps); the WORD's capitalisation is checked separately below, because it
 * is the only thing distinguishing a keyword instruction from a sentence that
 * merely contains the word "reply".
 */
const REPLY_INSTRUCTION =
  /\b(?:reply|replying|text|respond|send)\s+(?:back\s+)?(?:with\s+)?["'“‘]?([A-Za-z0-9]{2,15})\b/gi;

/**
 * #453 — the word an owner told customers to send that nothing is listening for.
 *
 * `mentionsEmergencyKeyword` answers "does this copy invite an emergency reply
 * we RECOGNISE?". It cannot answer the question #453 is actually about, because
 * an owner who writes "reply ASAP and we'll ring you straight back" trips no
 * keyword at all — so a screen built only on that function tells them nobody
 * has been told anything, while their customers have been told to send ASAP.
 * That is #414's defect with a reassuring message on top.
 *
 * Returns the offending word so the surface can NAME it. "Your message asks
 * customers to reply ASAP" is actionable; "your message may mention replying"
 * is a puzzle, and an owner who cannot see what is wrong changes nothing.
 *
 * Deliberately allowed to over-fire on an ALL-CAPS message ("WE WILL REPLY
 * MONDAY" reports MONDAY). Per the issue, the cost of an unnecessary warning is
 * an owner reading one extra sentence; the cost of a missed one is a homeowner
 * texting a word into the void on the coldest night of the year.
 */
export function unrecognizedReplyKeyword(copy: string): string | null {
  for (const match of copy.matchAll(REPLY_INSTRUCTION)) {
    const word = match[1]?.toUpperCase();
    if (word === undefined) continue;
    // One we watch for, or one the carrier answers: both are handled.
    if (KEYWORD_SET.has(word) || CARRIER_SET.has(word)) continue;
    // Must READ as a keyword: all-caps in the original, letters only. This is
    // what keeps "reply within 24 hours" and "we'll reply Monday" out of it.
    if (match[1] !== word || !/^[A-Z]{2,}$/.test(word)) continue;
    return word;
  }
  return null;
}

/** What the away-reply screen should say about the emergency path, if anything. */
export interface AwayEmergencyNotice {
  /** `warn` earns amber and an announcement; `hint` is a quiet aside. */
  tone: "warn" | "hint";
  text: string;
}

/**
 * #453 — the single decision every client renders, so all three say the SAME
 * thing.
 *
 * The copy lives here rather than in three settings screens for the reason the
 * whole feature exists: a warning that says one thing on web and another on
 * iOS is a warning nobody can act on, and three hand-written strings drift the
 * moment one is edited. Clients supply the state and render the result; only
 * the tone-to-colour mapping is platform-specific.
 *
 * Order matters, and it is "what is most broken" rather than "what is easiest
 * to explain":
 *   1. The switch is OFF while the copy invites a reply — nothing works, and
 *      no rewording fixes it. Said first, whatever word they used.
 *   2. The switch is ON but the word is one we do not watch — the #453 case.
 *      Names the word, because an owner cannot fix what we will not quote.
 *   3. The switch is ON and nothing invites it — a quiet aside, not a warning:
 *      an owner may simply not offer emergency service, which is what the
 *      switch is for.
 */
export function awayEmergencyNotice(args: {
  emergencyEnabled: boolean;
  awayMessage: string;
}): AwayEmergencyNotice | null {
  const invites = mentionsEmergencyKeyword(args.awayMessage);
  const unknown = unrecognizedReplyKeyword(args.awayMessage);

  if (!args.emergencyEnabled) {
    if (!invites && unknown === null) return null;
    return {
      tone: "warn",
      text:
        "Your away message tells customers to reply for an emergency, but nothing " +
        "will treat that reply as one. Turn this back on, or take the offer out of " +
        "the message.",
    };
  }

  if (unknown !== null) {
    return {
      tone: "warn",
      text:
        `Your away message tells customers to reply ${unknown}, which nothing ` +
        "watches for. Use URGENT, EMERGENCY, 911 or SOS instead, or take the offer " +
        "out of the message.",
    };
  }

  if (!invites) {
    return {
      tone: "hint",
      text:
        "Nobody has been told they can. Mention it in your away message if you " +
        "want customers to know.",
    };
  }

  return null;
}
