/**
 * #415 — the meter and the preview must measure one string.
 *
 * The composer showed a segment count for the RAW draft and, one line below, a
 * preview of the SUBSTITUTED text that actually sends. Merge fields make those
 * different, so the only pre-send cost disclosure this product has was
 * answering about a string the customer never receives.
 *
 * It never overbilled — server-side metering measures the real sent text — but
 * it misinformed, silently and repeatedly. An owner who builds a saved reply
 * around {business_name} sees the same wrong number every time they send, for
 * the life of the template.
 *
 * Both cases below are ones a reviewer would not notice by reading, which is
 * presumably how this survived. Same assertions exist in Kotlin and Swift.
 */
import { applyMergeFields, estimateSegments } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { segmentMeter } from "./segment-meter";

/** What the composer now meters. */
function meterFor(
  draft: string,
  values: { contactName?: string | null; businessName?: string | null },
) {
  return segmentMeter(applyMergeFields(draft, values), false);
}

describe("#415 — the meter measures the merged message", () => {
  it("crosses the 160-character boundary that {business_name} hides", () => {
    // "{business_name}" is 15 characters. The real one is 34.
    //
    // Worth knowing while reading this: `{` and `}` are GSM-7 EXTENDED
    // characters and cost TWO septets each, so the token is 17 septets rather
    // than 15 — one more way the raw draft is not the message.
    const business = "Wilson & Sons Plumbing and Heating";
    const draft = `Hi, this is {business_name}. ${"x".repeat(120)}`;

    expect(estimateSegments(draft).segments).toBe(1);

    const merged = applyMergeFields(draft, { businessName: business });
    expect(merged.length).toBeGreaterThan(160);

    // The meter used to say 1. It now agrees with what actually sends.
    expect(meterFor(draft, { businessName: business }).segments).toBe(2);
  });

  it("catches the encoding flip a name can cause", () => {
    // THE CASE THAT IS NOT A ROUNDING ERROR. One character outside GSM-7 flips
    // the WHOLE message to UCS-2, and per-part capacity falls from 160 to 70 —
    // so a draft the meter called one part sends as three.
    //
    // WHICH characters do it is unintuitive, and worth pinning rather than
    // reasoning about. GSM-7 carries plenty of accents: "Ménard", "Café",
    // "Français", "Müller" and "Ståhl" all stay GSM-7, so #415's own example
    // does NOT flip. What flips is the typographic apostrophe every phone
    // keyboard produces, and uppercase accented letters, which the lowercase
    // set does not imply.
    const business = "O’Brien Heating"; // U+2019, not an ASCII quote
    const draft = `Hi, this is {business_name}. ${"x".repeat(120)}`;

    const raw = estimateSegments(draft);
    expect(raw.encoding).toBe("GSM-7");
    expect(raw.segments).toBe(1);

    const metered = meterFor(draft, { businessName: business });
    expect(metered.encoding).toBe("UCS-2");
    expect(metered.segments).toBeGreaterThan(1);
  });

  it("pins which names flip, because the rule is not guessable", () => {
    // Lowercase ç is GSM-7 and uppercase Ç is not; lowercase á is GSM-7 and
    // uppercase Á is not. Nobody would predict that, so it is asserted.
    const flips = (business: string) =>
      meterFor("Hi from {business_name}", { businessName: business }).encoding;

    expect(flips("Ménard Plomberie")).toBe("GSM-7");
    expect(flips("Café Ståhl")).toBe("GSM-7");
    expect(flips("O’Brien Heating")).toBe("UCS-2");
    expect(flips("Çelik Isıtma")).toBe("UCS-2");
    expect(flips("Ángel Fontanería")).toBe("UCS-2");
  });

  it("leaves a draft with no merge fields exactly as it was", () => {
    // The fix must not move the number for the ordinary case, which is most
    // messages. Substitution returns a token-free string byte-for-byte.
    const draft = "On our way, about twenty minutes out.";
    expect(meterFor(draft, { businessName: "Anything" })).toEqual(
      segmentMeter(draft, false),
    );
  });

  it("counts a dropped token as the shorter message it becomes", () => {
    // Substitution can SHORTEN too: an unresolvable token is dropped cleanly,
    // so the raw count is not even a reliable floor. Metering the merged text
    // is the only thing that is right in both directions.
    const draft = `Hi {first_name}, ${"x".repeat(150)}`;
    expect(estimateSegments(draft).segments).toBe(2);
    expect(meterFor(draft, { contactName: null }).segments).toBe(1);
  });
});
