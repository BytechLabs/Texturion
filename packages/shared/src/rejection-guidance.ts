/**
 * #352 — a carrier rejection, said in words the customer can act on.
 *
 * `docs/DESIGN.md` G7 already requires this and has since before the product
 * shipped: the registration surface must carry *"rejection reason in plain
 * language + 'Fix and resubmit' form"*. What shipped was the reason, raw. Every
 * client renders the same sentence — *"The carrier registry rejected this:
 * {reason}. Fix the details below and resubmit."* — where `{reason}` is a string
 * written by TCR or a carrier for registration professionals.
 *
 * So a sole trader who registered as "Dave's Plumbing" while the CRA holds
 * "D. Chen Holdings Ltd" is told `BRAND_LEGAL_NAME_MISMATCH` and shown a form
 * with seventeen fields. They have already paid, already waited days, and have
 * now been told no. The two things they do next are resubmit the same details,
 * or stop.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE IS G10's, NOT AN INVENTION.
 *
 *   *"Errors: what happened + what to do, one sentence each."*
 *
 * So every entry is exactly that: `what` names the objection, `fix` names the
 * one thing to change. Nothing here is longer than two sentences, because this
 * is read by somebody who has just been rejected and is deciding whether to
 * bother.
 *
 * ---------------------------------------------------------------------------
 * AN UNKNOWN REASON FALLS THROUGH HONESTLY, AND THAT IS A FEATURE.
 *
 * `explainRejection` returns null rather than a generic sentence when it does
 * not recognise a reason. The clients then show the carrier's own words. #352 is
 * explicit that this is the better failure: *"showing the raw reason with an
 * offer to get help is better than a generic message that hides it."*
 *
 * A catalogue that pretends to understand everything is worse than one that
 * covers the common cases and says so, because the customer cannot tell which
 * kind of answer they are reading.
 *
 * ---------------------------------------------------------------------------
 * ONE MECHANISM, TWO CATALOGUES, WHICH #352 ASKED FOR BY NAME.
 *
 * *"#319 makes the identical argument for port rejections... These two should
 * share a translation approach rather than each inventing one."* Port rejections
 * are rendered raw today in exactly the same way, so the port catalogue lives
 * here beside the registration one rather than being reinvented later.
 *
 * Matching is on distinctive substrings, case-insensitively, because carriers
 * are not consistent: the same objection arrives as `EIN_MISMATCH`, as
 * "Tax ID does not match", and as prose with a ticket number in it. Order
 * matters — the first match wins, so narrower patterns are listed first.
 *
 * THE REASON IS NORMALISED FIRST, and it is not a nicety. The obvious spelling
 * of these patterns is a word-boundary regex, and `\bein\b` does NOT match
 * `EIN_MISMATCH` — an underscore is a word character, so there is no boundary
 * between them. Every coded reason a carrier sends is underscore-separated, so
 * the obvious version silently matches nothing and the catalogue is dead while
 * looking correct. Punctuation is collapsed to spaces up front instead, which
 * also lets the patterns be plain substrings: no regex to hand-port to Kotlin
 * and Swift, where `\b` is a backspace escape rather than a boundary.
 */

/**
 * What the customer is told, and where to send them.
 *
 * #228: KEYS, not sentences. This catalogue is a module-level constant built
 * before any reader exists, so a sentence written here could only ever be
 * written in one language — and the reader of this particular screen has just
 * been refused by a carrier and is deciding whether to bother trying again.
 * Whichever client renders it is the one that knows their language.
 */
export interface RejectionGuidance {
  /** Catalogue key for what the carrier objected to. One sentence, G10. */
  whatKey: RejectionMessageKey;
  /** Catalogue key for the one thing to change. One sentence, G10. */
  fixKey: RejectionMessageKey;
  /**
   * The form field to take them to, or null when the fix is not a single
   * field (a duplicate brand, a number that is not portable). Null is a real
   * answer: pointing at a field that cannot fix it is worse than not pointing.
   */
  field: string | null;
}

interface CatalogueEntry {
  /** Catalogue key for what the carrier objected to. */
  whatKey: string;
  /** Catalogue key for the one thing to change. */
  fixKey: string;
  /**
   * The form field to take them to, or null when the fix is not a single
   * field (a duplicate brand, a number that is not portable). Null is a real
   * answer: pointing at a field that cannot fix it is worse than not pointing.
   */
  field: string | null;
  /**
   * Distinctive phrases; any one appearing in the normalised reason wins.
   *
   * These stay English and are NOT catalogue keys. They match text a carrier
   * wrote, and a carrier writes `BRAND_LEGAL_NAME_MISMATCH` in English to
   * everybody. Translating them would break the matching in exactly the
   * language it was meant to serve.
   */
  match: readonly string[];
}

/**
 * Every key these catalogues can name, derived from the catalogues themselves.
 *
 * The web's `t()` takes a key drawn from its own catalogue, so this union is
 * what makes `tsc` prove the two agree. A `string` here would compile and
 * then show `domain.rejectRegEinWhat` to somebody who has just been refused
 * by a carrier — the one screen where a broken string is least recoverable,
 * because the reader is already deciding whether to give up.
 *
 * Derived rather than written out, so adding an entry cannot forget to widen
 * it.
 */
export type RejectionMessageKey =
  | (typeof REGISTRATION)[number]["whatKey"]
  | (typeof REGISTRATION)[number]["fixKey"]
  | (typeof PORT)[number]["whatKey"]
  | (typeof PORT)[number]["fixKey"]
  | (typeof RESUBMISSION_WAIT_KEY)[keyof typeof RESUBMISSION_WAIT_KEY];

/**
 * Lower-case, collapse every run of non-alphanumerics to a single space, and
 * pad with spaces so a phrase can be tested as a whole-word substring.
 *
 *   "BRAND_LEGAL_NAME_MISMATCH"  ->  " brand legal name mismatch "
 *   "Rejected (ref 88213): EIN"  ->  " rejected ref 88213 ein "
 */
function normalise(reason: string): string {
  return ` ${reason.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * 10DLC brand and campaign rejections, from TCR and the carriers.
 *
 * Field keys are the `name` attributes on the registration fix form, so a
 * client can focus the input without a second mapping table in between.
 */
const REGISTRATION = [
  {
    match: ["ein", "tax id", "taxid", "federal tax"],
    whatKey: "domain.rejectRegEinWhat",
    fixKey: "domain.rejectRegEinFix",
    field: "ein",
  },
  {
    // Before the generic name patterns: this one is about the LEGAL name
    // disagreeing with a registry, which is the single most common rejection
    // for a sole trader and the one whose fix is least obvious.
    match: ["legal name", "business name", "brand name", "company name", "name mismatch"],
    whatKey: "domain.rejectRegNameWhat",
    fixKey: "domain.rejectRegNameFix",
    field: "companyName",
  },
  {
    match: ["address", "street", "postal", "zip", "city", "state", "province"],
    whatKey: "domain.rejectRegAddressWhat",
    fixKey: "domain.rejectRegAddressFix",
    field: "street",
  },
  {
    match: ["website", "web site", "url", "domain", "landing page"],
    whatKey: "domain.rejectRegWebsiteWhat",
    fixKey: "domain.rejectRegWebsiteFix",
    field: "website",
  },
  {
    match: ["opt in", "optin", "consent", "cta", "call to action", "disclosure", "message flow"],
    whatKey: "domain.rejectRegConsentWhat",
    fixKey: "domain.rejectRegConsentFix",
    field: "messageFlow",
  },
  {
    match: ["sample", "example message", "content"],
    whatKey: "domain.rejectRegSampleWhat",
    fixKey: "domain.rejectRegSampleFix",
    field: "sample1",
  },
  {
    match: ["use case", "usecase", "vertical", "campaign type", "industry"],
    whatKey: "domain.rejectRegUseCaseWhat",
    fixKey: "domain.rejectRegUseCaseFix",
    field: "vertical",
  },
  {
    match: ["duplicate", "already registered", "already exists"],
    whatKey: "domain.rejectRegDuplicateWhat",
    // Deliberately no field: no amount of editing this form fixes a brand
    // registered elsewhere. Sending them round the form again would waste
    // another wait.
    fixKey: "domain.rejectRegDuplicateFix",
    field: null,
  },
  {
    match: ["entity type", "sole prop", "sole proprietor", "organization type", "non profit", "nonprofit"],
    whatKey: "domain.rejectRegEntityWhat",
    fixKey: "domain.rejectRegEntityFix",
    field: "companyName",
  },
  {
    match: ["contact", "email", "phone number", "unreachable"],
    whatKey: "domain.rejectRegContactWhat",
    fixKey: "domain.rejectRegContactFix",
    field: "email",
  },
] as const satisfies readonly CatalogueEntry[];

/**
 * Port-in rejections, from the losing carrier.
 *
 * Almost all of these are one field disagreeing with the old provider's records,
 * which is why they are so worth translating: `ACCOUNT_NUMBER_MISMATCH` sounds
 * fatal and is a ten-minute correction from last month's bill.
 */
const PORT = [
  {
    match: ["account number", "acct no", "acct num"],
    whatKey: "domain.rejectPortAccountWhat",
    fixKey: "domain.rejectPortAccountFix",
    field: "account_number",
  },
  {
    match: ["pin", "passcode", "password", "security code"],
    whatKey: "domain.rejectPortPinWhat",
    fixKey: "domain.rejectPortPinFix",
    field: "account_number",
  },
  {
    match: ["authorized person", "auth person", "signature", "loa", "letter of auth"],
    whatKey: "domain.rejectPortAuthWhat",
    fixKey: "domain.rejectPortAuthFix",
    field: "auth_person_name",
  },
  {
    match: ["entity name", "account holder", "name mismatch", "customer name"],
    whatKey: "domain.rejectPortEntityWhat",
    fixKey: "domain.rejectPortEntityFix",
    field: "entity_name",
  },
  {
    match: ["address", "service address", "street", "zip", "postal", "locality"],
    whatKey: "domain.rejectPortAddressWhat",
    fixKey: "domain.rejectPortAddressFix",
    field: "service_street",
  },
  {
    match: ["pending order", "in progress", "another port"],
    whatKey: "domain.rejectPortPendingWhat",
    fixKey: "domain.rejectPortPendingFix",
    field: null,
  },
  {
    match: ["not found", "invalid number", "not active", "disconnected", "unportable", "not portable"],
    whatKey: "domain.rejectPortInactiveWhat",
    fixKey: "domain.rejectPortInactiveFix",
    field: null,
  },
] as const satisfies readonly CatalogueEntry[];

const CATALOGUES = { registration: REGISTRATION, port: PORT } as const;

/** Which set of reasons to read the string against. */
export type RejectionDomain = keyof typeof CATALOGUES;

/**
 * Translate a carrier rejection, or return null when we do not recognise it.
 *
 * Null is the honest answer and the clients depend on it: they show the
 * carrier's own words plus an offer of help, rather than a generic sentence
 * that hides the only concrete thing the customer was given.
 */
export function explainRejection(
  domain: RejectionDomain,
  reason: string | null | undefined,
): RejectionGuidance | null {
  if (typeof reason !== "string") return null;
  const text = reason.trim();
  if (text.length === 0) return null;
  const normalised = normalise(text);
  for (const entry of CATALOGUES[domain]) {
    if (entry.match.some((phrase) => normalised.includes(` ${phrase} `))) {
      return { whatKey: entry.whatKey, fixKey: entry.fixKey, field: entry.field };
    }
  }
  return null;
}

/**
 * How long a resubmission takes, stated because #352 says its absence is where
 * people give up: *"A second wait of unknown length after a rejection, with no
 * stated ceiling, is where people give up."*
 *
 * Deliberately a range and deliberately vague at the top end — the carriers do
 * not commit to a time, and inventing a precise one we cannot hold would be a
 * worse promise than an honest range.
 */
export const RESUBMISSION_WAIT_KEY = {
  registration: "domain.resubmitWaitRegistration",
  port: "domain.resubmitWaitPort",
} as const;

/**
 * After this many attempts, the customer needs a person rather than another
 * form (#352: *"a customer who needs a person, not another email"*).
 *
 * Two, not three. The second rejection is the one that says the customer cannot
 * see what is wrong from what they have been told — a third attempt on their own
 * is unlikely to differ, and by then they have waited through three carrier
 * reviews.
 */
export const REJECTIONS_BEFORE_HELP = 2;

/** Whether this registration has been rejected often enough to need a person. */
export function needsHumanHelp(submissionCount: number | null | undefined): boolean {
  return typeof submissionCount === "number" && submissionCount >= REJECTIONS_BEFORE_HELP;
}
