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

/** What the customer is told, and where to send them. */
export interface RejectionGuidance {
  /** What the carrier objected to. One sentence, G10. */
  what: string;
  /** The one thing to change. One sentence, G10. */
  fix: string;
  /**
   * The form field to take them to, or null when the fix is not a single
   * field (a duplicate brand, a number that is not portable). Null is a real
   * answer: pointing at a field that cannot fix it is worse than not pointing.
   */
  field: string | null;
}

interface CatalogueEntry extends RejectionGuidance {
  /** Distinctive phrases; any one appearing in the normalised reason wins. */
  match: string[];
}

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
const REGISTRATION: CatalogueEntry[] = [
  {
    match: ["ein", "tax id", "taxid", "federal tax"],
    what: "The tax ID you gave does not match what the government registry holds for your business.",
    fix: "Check the EIN or business number on a tax document and enter it exactly, digits only.",
    field: "ein",
  },
  {
    // Before the generic name patterns: this one is about the LEGAL name
    // disagreeing with a registry, which is the single most common rejection
    // for a sole trader and the one whose fix is least obvious.
    match: ["legal name", "business name", "brand name", "company name", "name mismatch"],
    what: "The business name you gave does not match the one on your government registration.",
    fix: "Use the exact legal name from your registration paperwork, including any Ltd, Inc or LLC — the name customers see is set separately.",
    field: "companyName",
  },
  {
    match: ["address", "street", "postal", "zip", "city", "state", "province"],
    what: "The business address does not match the one on your government registration.",
    fix: "Enter the registered business address rather than a mailing or job-site address.",
    field: "street",
  },
  {
    match: ["website", "web site", "url", "domain", "landing page"],
    what: "The carrier could not confirm your business from the website you gave.",
    fix: "Give a website that names your business and describes what you do, and make sure it loads publicly.",
    field: "website",
  },
  {
    match: ["opt in", "optin", "consent", "cta", "call to action", "disclosure", "message flow"],
    what: "The carrier was not satisfied that customers agree to be texted before you text them.",
    fix: "Describe exactly where a customer gives you their number and what they are told at that moment.",
    field: "messageFlow",
  },
  {
    match: ["sample", "example message", "content"],
    what: "The sample texts did not show the carrier what you actually send.",
    fix: "Use real messages you would send a customer, and include your business name in each one.",
    field: "sample1",
  },
  {
    match: ["use case", "usecase", "vertical", "campaign type", "industry"],
    what: "The use case you picked does not match what your samples and website describe.",
    fix: "Pick the category that matches the texts you actually send to customers.",
    field: "vertical",
  },
  {
    match: ["duplicate", "already registered", "already exists"],
    what: "This business is already registered with the carriers, most likely by a provider you used before.",
    // Deliberately no field: no amount of editing this form fixes a brand
    // registered elsewhere. Sending them round the form again would waste
    // another wait.
    fix: "Reply to us and we will get the existing registration released or transferred — this is not something the form can fix.",
    field: null,
  },
  {
    match: ["entity type", "sole prop", "sole proprietor", "organization type", "non profit", "nonprofit"],
    what: "The business type you chose does not match how your business is registered.",
    fix: "Choose the type that matches your paperwork — a sole trader and a limited company are registered differently.",
    field: "companyName",
  },
  {
    match: ["contact", "email", "phone number", "unreachable"],
    what: "The carrier could not reach the contact details on the registration.",
    fix: "Give a business email and phone number that reach a person and are not auto-replied.",
    field: "email",
  },
];

/**
 * Port-in rejections, from the losing carrier.
 *
 * Almost all of these are one field disagreeing with the old provider's records,
 * which is why they are so worth translating: `ACCOUNT_NUMBER_MISMATCH` sounds
 * fatal and is a ten-minute correction from last month's bill.
 */
const PORT: CatalogueEntry[] = [
  {
    match: ["account number", "acct no", "acct num"],
    what: "The account number does not match the one your current provider has on file.",
    fix: "Copy it from a recent bill from that provider — it is usually not the phone number itself.",
    field: "account_number",
  },
  {
    match: ["pin", "passcode", "password", "security code"],
    what: "The transfer PIN was missing or wrong.",
    fix: "Ask your current provider for a port-out PIN — most will only give it to the account holder, and it often expires within a few days.",
    field: "account_number",
  },
  {
    match: ["authorized person", "auth person", "signature", "loa", "letter of auth"],
    what: "The person named on the request is not authorised on the account.",
    fix: "Use the name of the person your current provider has as the account holder, spelled the same way.",
    field: "auth_person_name",
  },
  {
    match: ["entity name", "account holder", "name mismatch", "customer name"],
    what: "The account holder name does not match your current provider's records.",
    fix: "Use the name exactly as it appears on the bill, including any Ltd, Inc or LLC.",
    field: "entity_name",
  },
  {
    match: ["address", "service address", "street", "zip", "postal", "locality"],
    what: "The service address does not match the one your current provider has on file.",
    fix: "Use the address on the bill for this line, even if the business has since moved.",
    field: "service_street",
  },
  {
    match: ["pending order", "in progress", "another port"],
    what: "Your current provider has another change in progress on this line.",
    fix: "Ask them to cancel or finish it, then tell us and we will resubmit.",
    field: null,
  },
  {
    match: ["not found", "invalid number", "not active", "disconnected", "unportable", "not portable"],
    what: "Your current provider says this number is not active on the account we asked about.",
    fix: "Check the number is still in service and on the account you gave us — a number already cancelled cannot be moved.",
    field: null,
  },
];

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
      return { what: entry.what, fix: entry.fix, field: entry.field };
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
export const RESUBMISSION_WAIT = {
  registration: "Most resubmissions are decided within a business day or two.",
  port: "Most resubmitted transfers are accepted within a few business days.",
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
