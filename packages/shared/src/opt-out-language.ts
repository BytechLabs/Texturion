/**
 * #396 — a plain-English opt-out is legally binding, and only the keyword was
 * ever detected.
 *
 * Since April 2025 an opt-out must be honoured however it is phrased, not only
 * as STOP. Our own blog tells customers exactly that — *"treat any plain-English
 * opt-out exactly like STOP… Honor it the moment you see it"* — and the product
 * did not implement the advice it publishes.
 *
 * Everything that catches an opt-out today needs the literal keyword: Telnyx's
 * profile block matches an exact STOP, `stop_keyword` matches the same, and the
 * carrier reconciliation only ever learns from a 40300 that a keyword already
 * caused. So "please stop texting me" lands in the inbox as ordinary text and
 * the contact stays textable.
 *
 * WHY THIS MATTERS MORE IN A SHARED INBOX — which is the product's whole point.
 * With one operator, the person who READ it is the person who would send the
 * next message. With a crew, the tech who reads it at 4pm is not the one who
 * follows up at 9am, and nothing in the thread said anything.
 *
 * ── TWO DELIBERATE DESIGN CHOICES ──────────────────────────────────────────
 *
 * 1. THIS FLAGS. IT NEVER OPTS ANYONE OUT. An opt-out cannot be lifted by us by
 *    design — only the customer texting START clears it, because the record
 *    belongs to them. So a false positive would PERMANENTLY silence a paying
 *    customer's real lead, and neither they nor we could undo it. A missed
 *    opt-out is a TCPA violation; a wrong one is unrecoverable. The only safe
 *    posture is: detect, warn loudly, let a human decide.
 *
 * 2. NO MODEL. A classifier here would need the AI gate, a cap, an alert
 *    threshold, a timeout and the #389 disclosure question — and would return a
 *    different answer on a different day for a compliance boundary. These are
 *    fixed phrases people actually type. A deterministic matcher is auditable,
 *    free, instant, and can be reasoned about in a dispute, which a model
 *    cannot.
 */

/**
 * Phrases that read as a request to stop being contacted.
 *
 * Tuned for PRECISION over recall, because this warns a crew rather than
 * silencing a contact: the cost of missing one here is that the thread looks
 * ordinary (the status quo), and the cost of over-firing is a banner nobody
 * believes, which would make every real one invisible too.
 *
 * Each is matched against the whole message, lowercased, with punctuation
 * flattened — "STOP TEXTING ME!!!" and "stop texting me" are the same request.
 */
const OPT_OUT_PHRASES: readonly RegExp[] = [
  // Direct instructions to stop.
  /\bstop (texting|messaging|contacting|calling) (me|us)\b/,
  /\bdon'?t (text|message|contact|call) (me|us)( again)?\b/,
  /\bdo not (text|message|contact|call) (me|us)( again)?\b/,
  /\bno more (texts?|messages?|calls?)\b/,
  /\bquit (texting|messaging|contacting) (me|us)\b/,
  /\bleave me alone\b/,
  // List-removal language.
  /\b(take|remove) (me|us) off (your |the |this )?(list|mailing list|texts?)\b/,
  /\b(take|remove) (me|us) off\b/,
  /\bunsubscribe (me|us)?\b/,
  /\bopt (me |us )?out\b/,
  // "Never contact me on this number again" and its relatives.
  /\bnever (text|message|contact|call) (me|us)\b/,
  /\b(lose|delete) (my|this) number\b/,
  /\bwrong number\b/,
  // Consent withdrawn in as many words.
  /\bi (do not|don'?t) (want|wish) to (be )?(receive|get|be contacted)/,
  /\bi (do not|don'?t) want (any more|anymore|more) (texts?|messages?)\b/,
  /\bstop\b.{0,12}\bplease\b/,
  /\bplease\b.{0,12}\bstop\b/,
];

/**
 * Phrases that CONTAIN opt-out words but are not one, and would otherwise fire.
 *
 * Checked first. These are the ones that showed up when reading real trade
 * conversations in mind: a customer telling you to stop *doing something at the
 * job* is not withdrawing consent, and a banner there teaches the crew to
 * ignore the banner.
 */
const NOT_OPT_OUT: readonly RegExp[] = [
  // "stop by", "stop in", "stop at the shop" — an invitation, the opposite.
  /\bstop (by|in|at|over|round)\b/,
  // Talking about the keyword rather than using it.
  /\breply stop\b/,
  /\bsaid stop\b/,
  // "don't call me until", "don't text me before 9" — a timing instruction.
  /\bdon'?t (text|message|call) (me|us) (until|till|before|after|while)\b/,
  /\bdo not (text|message|call) (me|us) (until|till|before|after|while)\b/,
];

/**
 * A message that is EXACTLY a carrier keyword is already handled — Telnyx
 * blocks it at the profile and `stop_keyword` records it. This detector exists
 * only for what that path cannot see, so it stays out of the way rather than
 * raising a second, weaker signal about the same message.
 *
 * Mirrors the §5/D3 lists (`CARRIER_REPLY_KEYWORDS` in shared/emergency.ts);
 * the API's `keywords.test.ts` already fails the build if those two drift.
 */
const CARRIER_KEYWORDS = new Set([
  "stop", "stopall", "unsubscribe", "cancel", "end", "quit",
  "start", "unstop", "yes", "help", "info",
]);

/** Lowercase, flatten punctuation and collapse whitespace. */
function normalize(body: string): string {
  return body
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when an inbound message probably asks us to stop contacting them.
 *
 * "Probably" is the whole contract: this drives a WARNING, never an automatic
 * opt-out. See the module comment for why that asymmetry is not negotiable.
 */
export function looksLikeOptOut(body: string | null | undefined): boolean {
  const text = normalize(body ?? "");
  if (text.length === 0) return false;
  // Already caught by the carrier path — see CARRIER_KEYWORDS.
  if (CARRIER_KEYWORDS.has(text)) return false;
  if (NOT_OPT_OUT.some((pattern) => pattern.test(text))) return false;
  return OPT_OUT_PHRASES.some((pattern) => pattern.test(text));
}
