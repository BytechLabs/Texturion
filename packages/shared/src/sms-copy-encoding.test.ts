/**
 * #228 - every automated message this product sends must fit in GSM-7.
 *
 * # The rule, and why it is about money
 *
 * `first-message-identification.ts` works this out in full for one string: an
 * em dash (U+2014) is outside the GSM-7 alphabet, and ONE character outside it
 * switches the whole message to UCS-2, which carries 67 units per concatenated
 * segment instead of 153. It does not add a few characters of overhead; it less
 * than halves the capacity of every segment of every message it touches, and
 * segments are what the carrier bills.
 *
 * That reasoning was written down, agreed, and then enforced by nobody. Three
 * automated bodies picked up an em dash anyway, and each is a send the product
 * makes on its own, at volume, without anybody reading it first:
 *
 *   appointment-reminders.ts  the 2-hour reminder, sent per appointment
 *   job-ratings.ts            the rating ask, sent per completed job
 *   on-my-way.ts              the arrival text, sent per visit
 *
 * # Why this is #228's foundation and not a tidy-up
 *
 * The reason to fix it now rather than eventually is French. The GSM-7 basic
 * alphabet contains `è é ù ì ò ç à É` and the German umlauts, which is enough
 * to make French look safe. It does NOT contain the circumflex vowels
 * (`â ê î ô û`), `ë ï`, the ligature `œ`, the guillemets `« »`, the typographic
 * apostrophe `’`, or any accented capital except `É`. So ordinary fr-CA copy -
 * "s'il vous plaît", "bientôt", "vous êtes", "À bientôt" - doubles the cost of
 * the message it appears in, silently, and nobody notices because the message
 * still sends.
 *
 * Translating first and discovering that afterwards is the expensive order to
 * do this in. The guard goes in before the copy does.
 *
 * # What it does not claim
 *
 * Only the TEMPLATES are ours. `{business_name}` is substituted at send time
 * with something a customer typed, and a business called "Café Noël" forces
 * UCS-2 on its own messages no matter what is written here. That is not a
 * defect and cannot be guarded; what can be guarded is that we never spend the
 * budget before the substitution happens.
 *
 * Nor is this about the three clients agreeing. They already did:
 * `on-my-way-parity.test.ts` compared web, Android and iOS and found them
 * identical, which is how the same em dash survived in all three at once.
 * Parity was never the missing check. Nothing was asking what the agreed
 * sentence costs to deliver.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_REMINDER_RULES } from "./appointment-reminders.js";
import { DEFAULT_AWAY_MESSAGE } from "./away.js";
import { DEFAULT_EMERGENCY_MESSAGE } from "./emergency.js";
import { IDENTIFICATION_SUFFIX_TEMPLATE } from "./first-message-identification.js";
import { RATING_ASK_BODY } from "./job-ratings.js";
import { DEFAULT_MCTB_MESSAGE } from "./mctb.js";
import { onMyWayText } from "./on-my-way.js";
import { estimateSegments } from "./segments.js";

/**
 * Every string this product can put into an SMS without a person composing it.
 *
 * A roster rather than a source scan, because the question "is this string
 * customer-bound" is not answerable from its shape: `SATISFACTION_COPY` and
 * `ON_CALL_COPY` are in-app labels that live beside these and never reach a
 * carrier. Adding an automated send means adding a line here, which is the
 * moment somebody has to ask what it costs to deliver.
 */
const AUTOMATED_BODIES: readonly [string, string][] = [
  ["away.DEFAULT_AWAY_MESSAGE", DEFAULT_AWAY_MESSAGE],
  ["emergency.DEFAULT_EMERGENCY_MESSAGE", DEFAULT_EMERGENCY_MESSAGE],
  ["mctb.DEFAULT_MCTB_MESSAGE", DEFAULT_MCTB_MESSAGE],
  ["job-ratings.RATING_ASK_BODY", RATING_ASK_BODY],
  ["first-message-identification.IDENTIFICATION_SUFFIX_TEMPLATE", IDENTIFICATION_SUFFIX_TEMPLATE],
  ["on-my-way.onMyWayText", onMyWayText(20)],
  ...DEFAULT_REMINDER_RULES.map(
    (rule) =>
      [`appointment-reminders.DEFAULT_REMINDER_RULES[${rule.offset_minutes}m]`, rule.body] as [
        string,
        string,
      ],
  ),
];

describe("#228 automated SMS copy stays inside GSM-7", () => {
  it.each(AUTOMATED_BODIES)("%s is GSM-7 encodable", (label, body) => {
    const estimate = estimateSegments(body);
    // Name the offending characters. "This string is UCS-2" sends the reader
    // hunting through a sentence that looks entirely ordinary, because the
    // character that did it is a dash.
    const offenders = [...body].filter((char) => estimateSegments(char).encoding === "UCS-2");
    expect(
      estimate.encoding,
      `${label} forces UCS-2 on every segment because of ${JSON.stringify(offenders)}. ` +
        "That halves segment capacity (153 units to 67) on a message the product " +
        "sends by itself, at volume. Use the GSM-7 equivalent: a hyphen for a dash, " +
        "a straight apostrophe for a curly one.",
    ).toBe("GSM-7");
  });

  it("the roster is not empty, so a bad import cannot make this vacuous", () => {
    expect(AUTOMATED_BODIES.length).toBeGreaterThanOrEqual(8);
    for (const [label, body] of AUTOMATED_BODIES) {
      expect(body, `${label} resolved to an empty string`).not.toHaveLength(0);
    }
  });

  it("catches the character class that broke this, so the guard is not decorative", () => {
    // Proof by construction rather than by having watched it fail once: these
    // are the exact characters ordinary fr-CA copy reaches for, and each must
    // be refused. If GSM7_BASIC ever gains one of them this test says so
    // instead of quietly widening what is allowed.
    for (const char of ["—", "’", "â", "ê", "î", "ô", "û", "«", "À"]) {
      expect(
        estimateSegments(`ok ${char}`).encoding,
        `${JSON.stringify(char)} is being treated as GSM-7, which it is not`,
      ).toBe("UCS-2");
    }
    // And the accented characters French CAN use, so the guard is not simply
    // refusing every accent and calling that safety.
    for (const char of ["è", "é", "ù", "ì", "ò", "ç", "à", "É"]) {
      expect(
        estimateSegments(`ok ${char}`).encoding,
        `${JSON.stringify(char)} is in the GSM-7 basic alphabet and should be allowed`,
      ).toBe("GSM-7");
    }
  });
});
