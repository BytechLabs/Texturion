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

/**
 * #460 — the product's list is a DEFAULT, not the law.
 *
 * The founder's objection was that the product assumes a trade, and the sharpest
 * version of that is the word itself: an owner whose customers would naturally
 * text "HELP" (taken — carrier keyword), "ASAP", "NOW" or a word in their own
 * language had no way to be listening for it. #453 already proved owners write
 * their own words into the away message, because it exists to warn them when the
 * word they chose is one nothing watches for. That warning was the product
 * telling an owner to change their words to suit our list, when the list was the
 * easier thing to change.
 *
 * NULL means the product list rather than "none", the same contract
 * `away_message` and `mctb_message` use. A stored copy of the defaults would
 * freeze whatever the list was the day a workspace signed up.
 */
export function effectiveEmergencyKeywords(
  custom: readonly string[] | null | undefined,
): readonly string[] {
  const cleaned = (custom ?? [])
    .map((word) => word.trim().toUpperCase())
    .filter((word) => isValidEmergencyKeyword(word));
  // Deduplicated, because the same word twice would report a keyword count
  // nobody typed and reads as a bug on the settings screen.
  const unique = [...new Set(cleaned)];
  return unique.length > 0 ? unique : EMERGENCY_KEYWORDS;
}

/**
 * The same rule as the `companies_emergency_keywords_ck` CHECK, so a client can
 * refuse a keyword before the round trip and say why.
 *
 * Single word, 2–15 characters, A–Z and digits only. Not arbitrary: the matcher
 * below splits an inbound on whitespace and punctuation and upper-cases the
 * first token, so a keyword with a space, a hyphen or a lowercase letter could
 * never match anything. Accepting one would be storing a setting that silently
 * does nothing — the exact failure #414 exists to prevent.
 */
export function isValidEmergencyKeyword(word: string): boolean {
  return /^[A-Z0-9]{2,15}$/.test(word);
}

/**
 * Why a keyword was refused, in the owner's terms, or null when it is fine.
 *
 * Returned as copy rather than a code because all three clients must say the
 * same thing, and "invalid keyword" tells somebody nothing about what to type
 * instead.
 */
export function emergencyKeywordError(raw: string): string | null {
  const word = raw.trim().toUpperCase();
  if (word.length === 0) return "Type a word first.";
  if (/\s/.test(raw.trim())) {
    return "One word only — customers text a single word, so a phrase would never match.";
  }
  if (!/^[A-Z0-9]+$/.test(word)) {
    return "Letters and numbers only. Punctuation is stripped from what customers send.";
  }
  if (word.length < 2) return "Too short — use at least 2 characters.";
  if (word.length > 15) return "Too long — 15 characters at most.";
  if (CARRIER_SET.has(word)) {
    return `${word} is answered by the phone carrier before it reaches us, so it can't be an emergency word.`;
  }
  return null;
}

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
export function isEmergencyKeyword(
  body: string,
  /**
   * #460: the workspace's own list. Defaults to the product's so every existing
   * caller keeps the behaviour it was written against — the callers that matter
   * (the inbound handler, the settings screens) pass the resolved list.
   */
  keywords: readonly string[] = EMERGENCY_KEYWORDS,
): boolean {
  const first = body
    .trim()
    .split(/[\s,.!?:;-]+/, 1)[0]
    ?.toUpperCase();
  if (first === undefined) return false;
  return keywords === EMERGENCY_KEYWORDS
    ? KEYWORD_SET.has(first)
    : keywords.includes(first);
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
export function mentionsEmergencyKeyword(
  copy: string,
  keywords: readonly string[] = EMERGENCY_KEYWORDS,
): boolean {
  return keywords.some((keyword) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(copy),
  );
}

/**
 * The words a reply instruction may legitimately name that are NOT ours: the
 * §5/D3 reserved keywords. "Reply STOP to unsubscribe" is required compliance
 * copy, and warning an owner that STOP is unrecognised would be both wrong and
 * the fastest way to teach them to ignore this warning.
 *
 * RESERVED, not carrier-answered, and the two stopped being the same list on
 * 2026-08-04. Every entry here but one is answered by Telnyx at the network
 * before we see it; `ARRET` is answered by us, because Telnyx's opt-out set is
 * English-only and a French-speaking customer's opt-out would otherwise arrive
 * as an ordinary message (#228). What this list is FOR is unchanged either way:
 * these are the words an owner may safely tell customers to send, because
 * something is listening for each of them.
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
  "ARRET",
  "ARRÊT",
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
export function unrecognizedReplyKeyword(
  copy: string,
  keywords: readonly string[] = EMERGENCY_KEYWORDS,
): string | null {
  for (const match of copy.matchAll(REPLY_INSTRUCTION)) {
    const word = match[1]?.toUpperCase();
    if (word === undefined) continue;
    // One we watch for, or one the carrier answers: both are handled. #460 makes
    // the first half per-workspace — an owner who added their own word must stop
    // being warned about it the moment they add it, or the warning teaches them
    // to ignore warnings.
    if (keywords.includes(word) || CARRIER_SET.has(word)) continue;
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
  /**
   * #460: the workspace's own words. Omitted means the product list, so a caller
   * that has not been taught about custom keywords yet still gets the old
   * answer rather than a wrong one.
   */
  keywords?: readonly string[];
}): AwayEmergencyNotice | null {
  const keywords = args.keywords ?? EMERGENCY_KEYWORDS;
  const invites = mentionsEmergencyKeyword(args.awayMessage, keywords);
  const unknown = unrecognizedReplyKeyword(args.awayMessage, keywords);

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
      // #460: names the workspace's OWN words rather than the product's four.
      // Telling an owner who added ASAP to "use URGENT instead" would be the
      // product arguing with a setting it offers, and the fix is now theirs to
      // make in either direction — reword the message, or add the word.
      text:
        `Your away message tells customers to reply ${unknown}, which nothing ` +
        `watches for. Use ${listWords(keywords)} instead, add ${unknown} to your ` +
        "emergency words, or take the offer out of the message.",
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

/**
 * "URGENT, EMERGENCY, 911 or SOS" — an owner reads a list, not an array.
 *
 * Exported because three settings screens print this sentence and used to
 * hardcode the four product words into it. That copy became a lie the moment
 * #460 let a workspace choose its own, and a switch whose label names words
 * nothing watches for is the #414 defect wearing a different hat.
 */
export function emergencyWordList(words: readonly string[]): string {
  return listWords(words);
}

function listWords(words: readonly string[]): string {
  if (words.length === 0) return "nothing";
  if (words.length === 1) return words[0]!;
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]!}`;
}

/**
 * #460 — the emergency reply, split into the half that is the owner's and the
 * half that is ours.
 *
 * #414 ask 4 said this message must never promise a human: *"'We'll call you
 * shortly' sent by a robot to someone with a gas smell is worse than silence.
 * If we cannot guarantee a human, the honest response names the alternative."*
 * That reasoning is sound and it is a safety property, not a house style, so it
 * survives. What did NOT survive is the conclusion drawn from it — that the
 * whole message therefore had to be ours. The result was a plumber's sentence
 * ("you smell gas", "your utility's emergency line") auto-sent by locksmiths and
 * landscapers, which is what #460 objected to.
 *
 * So: the owner writes the body and says whatever is true of their business, and
 * the product appends {@link EMERGENCY_SAFETY_LINE}, which it will not let them
 * delete. An owner controls what is promised; they do not get to control whether
 * the alternative is named, because the person reading it may be in a burning
 * building and did not choose this vendor.
 *
 * Trade-neutral by construction. "If anyone is in danger, call 911" is true for
 * every trade in every market we sell to (911 is the emergency number in both
 * the US and Canada), which the old gas-and-utility wording was not.
 */
export const EMERGENCY_SAFETY_LINE = "If anyone is in danger, call 911.";

/**
 * The product default body. Says what actually happened — which is true, and is
 * NOT the same as "someone will call you" — and nothing about a trade.
 */
export const DEFAULT_EMERGENCY_MESSAGE =
  "Flagged as urgent - the whole team has been alerted now. Do not wait on us.";

/** The effective emergency reply body + whether it is owner-authored. */
export interface EffectiveEmergencyMessage {
  /** The owner's body, or the product default. Without the safety line. */
  message: string;
  /** True when the owner's own text is in effect. */
  custom: boolean;
}

/**
 * The same non-blank-wins rule as {@link effectiveAwayMessage} and
 * `effectiveMctbMessage`. Three auto-send surfaces resolving their copy three
 * different ways is how two of them drifted apart before.
 */
export function effectiveEmergencyMessage(
  ownerMessage: string | null | undefined,
  /**
   * #228 - the product default to fall back to, which is language-dependent.
   * The already-resolved sentence rather than a locale, so `locale.ts` can keep
   * reading this module's English constant without closing an import cycle.
   * Ignored when the owner wrote their own.
   */
  fallback: string = DEFAULT_EMERGENCY_MESSAGE,
): EffectiveEmergencyMessage {
  const trimmed = (ownerMessage ?? "").trim();
  return trimmed.length > 0
    ? { message: trimmed, custom: true }
    : { message: fallback, custom: false };
}

/**
 * What is actually sent: the effective body with the safety line appended.
 *
 * Appended rather than merged, and idempotent — an owner who pastes the safety
 * line into their own text (having seen it in the preview, which is exactly how
 * they would) must not receive it twice. Two copies of "call 911" in one message
 * reads as a broken robot at the moment the message most needs to be believed.
 */
export function emergencyReplyBody(
  ownerMessage: string | null | undefined,
): string {
  const body = effectiveEmergencyMessage(ownerMessage).message;
  return body.includes(EMERGENCY_SAFETY_LINE)
    ? body
    : `${body} ${EMERGENCY_SAFETY_LINE}`;
}
