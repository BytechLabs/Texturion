/**
 * First-message sender identification (#393, D4) — the capability, off by default.
 *
 * D4 originally auto-appended `— {Business name}. Reply STOP to opt out` to the
 * first outbound message to a contact, and the owner had it removed in 2026-07
 * because on a message to somebody who just called you, a footer reads as
 * marketing. That decision stands and this module does not change it: the
 * setting behind this text is **off by default**, so no message anybody sends
 * today gains a footer.
 *
 * WHY THE CAPABILITY EXISTS ANYWAY, and why it is not waiting on the lawyer.
 * There are two independent reasons to want this text, and they were tangled
 * together in #393:
 *
 *  1. **Statutory** (CASL s.6(2) — identify the sender). Whether it is
 *     *required* is a legal question, tracked as L1, and nobody here can answer
 *     it. That question decides the DEFAULT, not whether the code exists.
 *  2. **Deliverability**, which is ours to reason about and changed on
 *     2026-07-29. #379 established there is no CA→CA registration to obtain and
 *     that Canadian carriers filter long-code A2P traffic at their own
 *     discretion — permanently, by their own statement. With registration off
 *     the table as a remedy, the levers left are toll-free (#329) and the
 *     content signals carriers actually score. An unidentified first message
 *     from an unrecognised long code is precisely what spam heuristics look for,
 *     so identification is one of the few things we can still do.
 *
 * So the code ships, defaulted off, and L1's answer flips a default instead of
 * commissioning a three-client build. The product already reaches for this text
 * when a stranger is on the receiving end — `DEFAULT_MCTB_MESSAGE` says "This is
 * {business_name}" for exactly that reason — which is the inconsistency #393
 * pointed at: the automated path identified and the human one did not.
 *
 * Shared so the API's send path and every client's composer preview render the
 * SAME string. Clients must never compose this themselves — the API hands them
 * the exact suffix (`company.first_message_identification_suffix`) so the
 * segment count a user sees matches the body that is actually billed.
 */

/**
 * The suffix. `{business_name}` is substituted at send time.
 *
 * The leading separator is part of the string: this is appended to a body the
 * user wrote, and that body does not end in a space.
 *
 * **The separator is a HYPHEN, not the em dash D4 wrote, and that is a cost
 * decision rather than a typographic one.** An em dash (U+2014) is outside the
 * GSM-7 alphabet, and one non-GSM character switches the WHOLE message to
 * UCS-2 — which carries 67 units per concatenated segment instead of 153. So
 * the em dash version does not add "about 40 characters"; it less than halves
 * the capacity of every segment of every message it touches. Measured: a
 * 150-character first message costs 1 segment bare, 2 with this suffix, and
 * **3** with the em dash version. Tripling the cost of the product's
 * highest-volume compliance surface to render one dash prettier is not a trade
 * worth making, and `mctb.ts` already established the no-em-dashes rule for the
 * same reason.
 *
 * Everything else is D4's wording, unchanged.
 */
export const IDENTIFICATION_SUFFIX_TEMPLATE =
  " - {business_name}. Reply STOP to opt out";

/**
 * The suffix for a given business, or null when there is no usable name to
 * identify with.
 *
 * A blank company name returns null rather than a malformed `" — . Reply STOP
 * to opt out"`. That failure mode matters: the whole point of the text is to say
 * WHO is writing, so a version that names nobody is worse than none — it adds
 * segments and satisfies neither the statute nor a spam filter.
 */
export function identificationSuffix(
  businessName: string | null | undefined,
): string | null {
  const name = (businessName ?? "").trim();
  if (name.length === 0) return null;
  return IDENTIFICATION_SUFFIX_TEMPLATE.replace("{business_name}", name);
}

/**
 * Append an ALREADY-RESOLVED suffix to a body, idempotently.
 *
 * This is the arm the CLIENTS use. They receive the exact suffix from the API
 * (`company.first_message_identification_suffix`) rather than composing it, so
 * a composer's segment count cannot drift from the body the server bills — but
 * they still need the same append rule, and one implementation of it.
 *
 * A null/blank suffix returns the body untouched, as does a body that already
 * ends with the suffix (a retry, a replay, or an owner whose own sign-off
 * happens to match).
 */
export function appendIdentificationSuffix(
  body: string,
  suffix: string | null | undefined,
): string {
  if (!suffix || suffix.trim().length === 0) return body;
  if (body.trimEnd().endsWith(suffix.trimStart())) return body;
  return `${body}${suffix}`;
}

/**
 * Append the identification suffix for a business to a message body.
 *
 * The SERVER arm: it resolves the suffix from the company name and appends it.
 * Returns the body unchanged when there is no usable name.
 */
export function appendIdentification(
  body: string,
  businessName: string | null | undefined,
): string {
  return appendIdentificationSuffix(body, identificationSuffix(businessName));
}

/**
 * The signature THIS send will carry, or null — the CLIENT-side twin of
 * {@link shouldIdentify}, returning the string rather than a boolean because
 * that is what a composer needs to append and meter.
 *
 * `companySuffix` is `company.first_message_identification_suffix` (already null
 * when signing is off). `alreadySignedAt` is the recipient's
 * `first_identification_sent_at` — pass null for a raw number with no contact
 * row, which has never been signed to and so counts as a first.
 *
 * Ported to Kotlin (`Signature.pending`) and Swift (`Signature.pending`); the
 * three must agree, because a client that answers differently shows a part count
 * the customer is not billed.
 */
export function pendingIdentificationSuffix(
  companySuffix: string | null | undefined,
  alreadySignedAt: string | null | undefined,
): string | null {
  if (!companySuffix || companySuffix.trim().length === 0) return null;
  return alreadySignedAt ? null : companySuffix;
}

/**
 * Whether THIS send should carry identification: the setting is on, and this
 * contact has not been identified to before.
 *
 * "Once per contact" is the rule D4 set and it is the right one — the text
 * exists so a stranger knows who is texting, and after the first message they
 * are no longer a stranger. Repeating it on every send would be the noise the
 * owner objected to.
 */
export function shouldIdentify(args: {
  /** `companies.first_message_identification`. */
  settingEnabled: boolean;
  /** `contacts.first_identification_sent_at` — non-null means already done. */
  alreadyIdentifiedAt: string | null | undefined;
}): boolean {
  return args.settingEnabled && !args.alreadyIdentifiedAt;
}
