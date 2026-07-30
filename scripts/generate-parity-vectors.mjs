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
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { estimateSegments } from "../packages/shared/src/segments.ts";
import { isUsCaDestination, lookupAreaCode } from "../packages/shared/src/nanp.ts";

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

const FILES = {
  "segments.json": segmentVectors,
  "nanp.json": nanpVectors,
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
