#!/usr/bin/env node
/**
 * [#376] Generate the cases all three clients must agree on.
 *
 *   node scripts/generate-parity-vectors.mjs          # write
 *   node scripts/generate-parity-vectors.mjs --check  # fail if stale (CI)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * `packages/shared` is shared by two of four clients. Kotlin and Swift cannot
 * import TypeScript, so Android and iOS reimplement every rule they need — each
 * one exists three times, and the test strategy pins the copies in parallel by
 * hand rather than deriving them.
 *
 * #376 names that as the root cause behind #338's parity drift, and it is right:
 * a rule change needs three edits and nothing enforces the third. The 35-gap
 * audit, the #257–#273 defect batch and #268's "iOS fix never ported" are all
 * symptoms.
 *
 * #376's devil's advocate is also right that three implementations of a
 * hundred-line rule is not obviously wrong — native clients want native idiom,
 * and codegen across three toolchains would be heavier than the problem. So the
 * action is the narrow one it identifies: **nothing currently tells you the
 * other two copies exist**, and nothing checks that they agree.
 *
 * This generates the CASES, not the code. Three implementations stay; they are
 * asserted against identical inputs, so a divergence is a failing build rather
 * than a founder noticing a wrong number on a screen.
 *
 * ---------------------------------------------------------------------------
 * WHICH RULES, AND WHY ONLY THESE.
 *
 * #376's first acceptance is a written list of what must be identical. It is
 * here rather than in a document, because a list that is not the input to
 * anything drifts from what is actually checked.
 *
 *   segments  What a customer is BILLED and what the composer promises. A
 *             divergence charges differently from the server, or tells someone
 *             a message is one part when it bills as two. Encoding choice is
 *             the subtle half: one non-GSM character silently cuts capacity
 *             from 160 to 70.
 *
 *   nanp      Destination VALIDITY and the quiet-hours clock (#292). A
 *             divergence blocks a real number, permits an unreachable one, or
 *             texts somebody at 3am because a client put their area code in the
 *             wrong timezone.
 *
 * DELIBERATELY NOT INCLUDED, and each for a stated reason rather than by
 * omission:
 *
 *   merge-fields, mms, send-failures  These matter, and they are the obvious
 *             next entries. They are left out of the FIRST pass on purpose:
 *             a vector file nobody reads is worse than none, and the two above
 *             are the ones where a divergence costs money or wakes somebody up.
 *             Adding a rule here is a function and a list entry.
 *
 *   business-hours display, error copy  Presentation. A platform is allowed to
 *             phrase things its own way, and forcing character-identical copy
 *             across three clients would be pinning the wrong thing.
 *
 *   rejections  ADDED for #352, and carefully: it pins which FIELD a carrier
 *             rejection sends the customer to, and whether the reason was
 *             recognised at all — never the wording. The exclusion above still
 *             holds; the copy is free and the routing is not. A client that
 *             focuses the wrong field walks somebody through re-entering the
 *             one thing that was already right, then charges them another
 *             multi-day carrier review for it.
 *
 *             It earned its place by failing first. The obvious spelling of the
 *             matcher is a word-boundary regex, and `\bein\b` does not match
 *             `EIN_MISMATCH` — an underscore is a word character. Every coded
 *             reason a carrier sends is underscore-separated, so the whole
 *             catalogue matched NOTHING while reading as correct. That is the
 *             precise failure a hand-port repeats, in a language where `\b` is
 *             a backspace escape rather than a boundary.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { estimateSegments } from "../packages/shared/src/segments.ts";
import { isUsCaDestination, lookupAreaCode } from "../packages/shared/src/nanp.ts";
import { explainRejection } from "../packages/shared/src/rejection-guidance.ts";
import { avatarInitials } from "../packages/shared/src/avatar-initials.ts";
import { prepaidConversionCopy } from "../packages/shared/src/prepaid-conversion-copy.ts";
import { lastCompleteMonth } from "../packages/shared/src/usage-export.ts";
import {
  paymentAmountProblem,
  paymentRequestCancellable,
  paymentRequestLabel,
  paymentRequestState,
  payoutReadiness,
} from "../packages/shared/src/payments.ts";

const OUT_DIR = join("packages", "shared", "vectors");

/**
 * The segment inputs. Chosen to cover every boundary the three implementations
 * could disagree on rather than to be representative traffic — a vector set of
 * ordinary messages proves nothing, because ordinary messages are the case
 * everybody gets right.
 */
const SEGMENT_INPUTS = [
  "",
  "hi",
  // Exactly the single-segment GSM-7 ceiling, and one past it. The one-past
  // case also crosses into concatenation, where capacity drops to 153.
  "a".repeat(160),
  "a".repeat(161),
  "a".repeat(306),
  "a".repeat(307),
  // GSM-7 extension characters cost TWO septets. A client counting them as one
  // under-reports the bill by a segment at the boundary.
  "€".repeat(80),
  `${"a".repeat(159)}€`,
  // One non-GSM character drops the whole message to UCS-2 and capacity to 70.
  // This is the divergence that would be least visible and cost the most.
  "café",
  "e".repeat(70),
  "é".repeat(70),
  "é".repeat(71),
  // An emoji is a surrogate PAIR: two UTF-16 code units, not one character.
  "👍",
  "👍".repeat(35),
  "👍".repeat(36),
  // Newlines and the GSM-7 escape set inside otherwise plain text.
  "line one\nline two",
  "50% off {} [] ~ | ^",
];

/**
 * The NANP inputs. Real area codes across several timezones, plus every shape
 * of malformed input a client might handle differently.
 */
const NANP_INPUTS = [
  "+14155550123", // 415 California
  "+12125550123", // 212 New York
  "+13065550123", // 306 Saskatchewan, which does not observe DST
  "+16135550123", // 613 Ontario
  "+19075550123", // 907 Alaska
  "+18085550123", // 808 Hawaii
  "+17875550123", // 787 Puerto Rico
  "+18005550123", // toll-free
  "+15555550123", // 555, not a real area code
  "+447700900123", // UK, outside the NANP
  "+1415555012", // one digit short
  "+141555501234", // one digit long
  "4155550123", // no plus
  "",
  "not a number",
];

function segmentVectors() {
  return SEGMENT_INPUTS.map((text) => ({
    // The text itself, so a failure names the input rather than an index.
    text,
    ...estimateSegments(text),
  }));
}

function nanpVectors() {
  return NANP_INPUTS.map((e164) => {
    const entry = lookupAreaCode(e164);
    return {
      e164,
      is_us_ca: isUsCaDestination(e164),
      // Null for anything the lookup does not recognise, which is itself a
      // case worth pinning: a client that invented a timezone here would text
      // somebody at the wrong hour.
      timezone: entry?.timezone ?? null,
      // COUNTRY, not `region`. The TypeScript entry also carries a US state or
      // Canadian province, and both mobile ports deliberately carry a narrower
      // `NanpEntry { country, timezone }` because nothing on a phone renders a
      // state. Pinning `region` would fail two implementations for a field they
      // correctly do not have.
      //
      // The rule this taught, worth more than the fix: vectors pin the SHARED
      // contract, not the richest implementation's. A vector file that asserts
      // one client's extras is a vector file that has to be argued with instead
      // of trusted.
      country: entry?.country ?? null,
    };
  });
}

/**
 * Rejection reasons, in the shapes carriers actually send: coded and
 * underscore-separated, as prose, wrapped in a ticket reference, and a few
 * nobody has a mapping for. The unrecognised ones matter most — a client that
 * invented guidance there would hide the only concrete thing the customer was
 * given.
 */
const REJECTION_INPUTS = [
  ["registration", "BRAND_LEGAL_NAME_MISMATCH"],
  ["registration", "EIN_MISMATCH"],
  ["registration", "The Tax ID provided does not match IRS records."],
  ["registration", "Rejected (ref 88213): federal tax id could not be verified"],
  ["registration", "CAMPAIGN_OPT_IN_INSUFFICIENT"],
  ["registration", "WEBSITE_UNVERIFIED"],
  ["registration", "SAMPLE_MESSAGE_CONTENT_MISMATCH"],
  ["registration", "USE_CASE_MISMATCH"],
  ["registration", "ADDRESS_MISMATCH"],
  ["registration", "ENTITY_TYPE_MISMATCH"],
  ["registration", "CONTACT_UNREACHABLE"],
  // Recognised, and deliberately routed to NO field: no edit to this form
  // releases a brand somebody else registered.
  ["registration", "DUPLICATE_BRAND"],
  ["registration", "TCR-9911 anomaly, see portal"],
  ["port", "ACCOUNT_NUMBER_MISMATCH"],
  ["port", "Invalid port-out PIN supplied"],
  ["port", "LOA_SIGNATURE_INVALID"],
  ["port", "ENTITY_NAME_MISMATCH"],
  ["port", "SERVICE_ADDRESS_MISMATCH"],
  ["port", "PENDING_ORDER_EXISTS"],
  ["port", "NUMBER_NOT_ACTIVE"],
  ["port", "SPI_REJECT_47"],
  // A port reason read against the registration catalogue must NOT resolve.
  // Being told to check a phone bill would send somebody hunting the wrong
  // document entirely.
  ["registration", "ACCOUNT_NUMBER_MISMATCH"],
  ["port", "CAMPAIGN_OPT_IN_INSUFFICIENT"],
  ["registration", ""],
];

function rejectionVectors() {
  return REJECTION_INPUTS.map(([domain, reason]) => {
    const guidance = explainRejection(domain, reason);
    return {
      domain,
      reason,
      // Whether we claim to understand it. The clients branch on this to decide
      // between translated guidance and the carrier's own words.
      recognised: guidance !== null,
      // WHERE it sends them. Null is a real answer and is pinned as one.
      field: guidance?.field ?? null,
    };
  });
}

/**
 * #582 — the two letters in an avatar.
 *
 * It earned a place here the way `rejections` did: by having been wrong. The rule
 * existed FIVE times and the five disagreed — two of them on one screen, so one
 * contact was two people at a glance, and both phones showed `(5` for every unnamed
 * contact because the badge is handed a formatted phone number and they took its
 * first character. There is one implementation now, and these are what hold the two
 * hand-ports to it.
 *
 * Chosen for the boundaries a reimplementation gets wrong rather than for typical
 * names: a middle name (first-plus-LAST, the case that differed), a name that is
 * really a phone number, a leading digit, punctuation-only words, and characters
 * outside the basic plane — where indexing by code unit returns half a character.
 */
const AVATAR_INITIALS_INPUTS = [
  "Sam Founder",
  // The disagreement that was visible on one screen.
  "Ana Maria Rojas",
  "Maria de los Angeles Cruz",
  // An unnamed contact shows as its formatted number. `(5` is not initials.
  "(415) 555-0134",
  "+1 415 555 0134",
  "",
  "   ",
  "--",
  "Cher",
  "X",
  // A business is allowed to start with a digit.
  "4th Street Deli",
  "24 Hour Plumbing",
  "Jean - Rojas",
  // A letter built from a surrogate pair must survive whole.
  "\u{1D49C}lice Rojas",
  // An emoji is neither letter nor digit: the word is skipped and the name wins.
  "\u{1F642} Rojas",
  "Ana\u{1F642} Rojas",
  // Precomposed, then DECOMPOSED. Both must answer the same on all three clients.
  "\u00C9mile Zola",
  "E\u0301mile Zola",
  "ana rojas",
];

/**
 * #583/D131 — every plan pairing, with and without a figure.
 *
 * The pairings are the whole space (two plans, either direction, plus the
 * same-plan cases the route refuses but the copy must still compose), and the
 * amount is passed pre-formatted so a client's own money formatting is not
 * retested here — it has its own vectors.
 *
 * The null case is the one worth having: a row written before the conversion
 * columns existed sends no figure, and the sentences must then promise no number
 * rather than an empty one. "puts  back on your account" shipped once in a
 * neighbouring feature for exactly this reason.
 */
const PREPAID_COPY_INPUTS = [
  ["starter", "pro", "$217.50"],
  ["pro", "starter", "$592.50"],
  ["starter", "pro", "CA$298"],
  ["pro", "starter", "US$1,090"],
  ["starter", "starter", "$29"],
  ["pro", "pro", "$79"],
  ["starter", "pro", null],
  ["pro", "starter", null],
];

function prepaidConversionCopyVectors() {
  return PREPAID_COPY_INPUTS.map(([fromPlan, toPlan, credit]) => ({
    from_plan: fromPlan,
    to_plan: toPlan,
    credit,
    ...prepaidConversionCopy(fromPlan, toPlan, credit),
  }));
}

/**
 * #595 — the period the usage export offers by default.
 *
 * Chosen for what three calendar implementations disagree about, not for typical
 * months: the year boundary, a 30-day month, February in a common year, a leap
 * year, and both century rules. Kotlin has `YearMonth.lengthOfMonth` and Swift has
 * `Calendar.range(of:in:for:)`, so the ports will almost certainly be right — and
 * "almost certainly" is what a vector file is for.
 */
const LAST_COMPLETE_MONTH_INPUTS = [
  [2026, 8],
  [2026, 1],
  [2026, 5],
  [2026, 3],
  [2024, 3],
  [2100, 3],
  [2000, 3],
  [2026, 12],
  [2026, 10],
];

function lastCompleteMonthVectors() {
  return LAST_COMPLETE_MONTH_INPUTS.map(([year, month]) => ({
    year,
    month,
    ...lastCompleteMonth(year, month),
  }));
}

function avatarInitialsVectors() {
  return AVATAR_INITIALS_INPUTS.map((name) => ({
    name,
    initials: avatarInitials(name),
  }));
}

/**
 * #224 — the six-state answer a payment request shows, and the bounds on the
 * amount.
 *
 * This meets the bar the header sets for inclusion — "a divergence costs money
 * or wakes somebody up" — more directly than anything already here. The state is
 * DERIVED from four fields with a precedence order, and the two cases that
 * decide it are both ones a reimplementation gets wrong by writing the obvious
 * switch: a request that was cancelled and then paid anyway must read PAID (the
 * money is real, and reading it as cancelled is how a customer is chased for a
 * bill they settled), and a request that was refunded AFTER being disputed must
 * read DISPUTED (a chargeback needs somebody; a refund does not).
 *
 * The amount bounds are here for the same reason the segment ceiling is: a
 * client that disagrees about the floor mints a link Stripe will refuse, and one
 * that disagrees about the ceiling lets a missed decimal turn $450 into $45,000
 * on somebody else's card.
 *
 * Readiness is included and the COPY is not, per the header's standing rule:
 * which of five states an account is in decides whether a control appears at
 * all; the sentence beside it is presentation and each platform may phrase it.
 */
const PAYMENT_STATE_INPUTS = [
  { status: "requested" },
  { status: "paid" },
  { status: "cancelled" },
  { status: "expired" },
  { status: "requested", paid_at: "2026-08-01T00:00:00Z" },
  // Cancelled, then paid anyway. Reads PAID.
  { status: "cancelled", paid_at: "2026-08-01T00:00:00Z" },
  // Expired, then paid anyway. Same reasoning.
  { status: "expired", paid_at: "2026-08-01T00:00:00Z" },
  { status: "paid", paid_at: "2026-08-01T00:00:00Z", refunded_at: "2026-08-02T00:00:00Z" },
  { status: "paid", paid_at: "2026-08-01T00:00:00Z", disputed_at: "2026-08-02T00:00:00Z" },
  // Disputed AND refunded. Reads DISPUTED.
  {
    status: "paid",
    paid_at: "2026-08-01T00:00:00Z",
    refunded_at: "2026-08-03T00:00:00Z",
    disputed_at: "2026-08-02T00:00:00Z",
  },
];

const PAYMENT_AMOUNT_INPUTS = [
  0, 1, 99, 100, 101, 25_000, 2_499_999, 2_500_000, 2_500_001, 100_000_000, 1000.5, -500,
];

const PAYOUT_ACCOUNT_INPUTS = [
  null,
  { connected: false, charges_enabled: false, details_submitted: false },
  { connected: true, charges_enabled: false, details_submitted: false },
  { connected: true, charges_enabled: false, details_submitted: true },
  {
    connected: true,
    charges_enabled: false,
    details_submitted: true,
    disabled_reason: "requirements.past_due",
  },
  { connected: true, charges_enabled: true, details_submitted: true },
  // Charges on despite a disabled reason. Stripe decides, and it says yes.
  {
    connected: true,
    charges_enabled: true,
    details_submitted: true,
    disabled_reason: "requirements.pending_verification",
  },
];

function paymentVectors() {
  return [
    ...PAYMENT_STATE_INPUTS.map((row) => ({
      kind: "state",
      row,
      state: paymentRequestState(row),
      label: paymentRequestLabel(paymentRequestState(row)),
      cancellable: paymentRequestCancellable(row),
    })),
    ...PAYMENT_AMOUNT_INPUTS.map((cents) => ({
      kind: "amount",
      cents,
      // Null is a real answer — it means the amount is chargeable.
      problem: paymentAmountProblem(cents),
    })),
    ...PAYOUT_ACCOUNT_INPUTS.map((account) => ({
      kind: "readiness",
      account,
      readiness: payoutReadiness(account),
    })),
  ];
}

const FILES = {
  "segments.json": segmentVectors,
  "nanp.json": nanpVectors,
  "rejections.json": rejectionVectors,
  "avatar-initials.json": avatarInitialsVectors,
  "prepaid-conversion-copy.json": prepaidConversionCopyVectors,
  "last-complete-month.json": lastCompleteMonthVectors,
  "payments.json": paymentVectors,
};

const check = process.argv.includes("--check");
let stale = 0;

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of Object.entries(FILES)) {
  const path = join(OUT_DIR, name);
  const body = `${JSON.stringify(build(), null, 2)}\n`;
  if (!check) {
    writeFileSync(path, body);
    console.log(`  wrote ${path} (${build().length} cases)`);
    continue;
  }
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = "";
  }
  // Compared by hash rather than by string so the message says WHICH file,
  // not a thousand lines of diff.
  const same =
    createHash("sha256").update(current).digest("hex") ===
    createHash("sha256").update(body).digest("hex");
  if (!same) {
    stale += 1;
    console.error(
      `  x ${path} is stale. A shared rule changed and the vectors did not.\n` +
        "    Run: node scripts/generate-parity-vectors.mjs\n" +
        "    Then make the Kotlin and Swift implementations agree with it.",
    );
  }
}

if (check) {
  if (stale > 0) {
    console.error(
      `\n${stale} stale vector file(s). #376: a shared rule exists three ` +
        "times, and this is the thing that notices when the copies disagree.\n",
    );
    process.exit(1);
  }
  console.log("Parity vectors are current.");
}
