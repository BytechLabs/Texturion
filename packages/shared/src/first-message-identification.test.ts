import { describe, expect, it } from "vitest";

import {
  IDENTIFICATION_SUFFIX_TEMPLATE,
  appendIdentification,
  identificationSuffix,
  shouldIdentify,
} from "./first-message-identification";
import { estimateSegments } from "./segments";

describe("identificationSuffix", () => {
  it("names the business, in D4's wording", () => {
    expect(identificationSuffix("Mike's Plumbing")).toBe(
      " - Mike's Plumbing. Reply STOP to opt out",
    );
  });

  it("trims a padded name", () => {
    expect(identificationSuffix("  Bright Sparks  ")).toBe(
      " - Bright Sparks. Reply STOP to opt out",
    );
  });

  it("stays inside GSM-7 — one non-GSM char would reprice every segment", () => {
    // An em dash (D4's original separator) is outside GSM-7, and a single
    // non-GSM character switches the WHOLE message to UCS-2: 67 units per
    // concatenated segment instead of 153. That turns a 150-char first message
    // from 2 segments into 3. The separator is a hyphen for that reason.
    const suffix = identificationSuffix("Mike's Plumbing") as string;
    expect(suffix).not.toMatch(/[—–]/);
    // Every character must be plain ASCII, which GSM-7 covers.
    expect(suffix).toMatch(/^[\x20-\x7E]+$/);
  });

  it("returns null rather than identifying nobody", () => {
    // A footer that names no business adds segments and satisfies neither the
    // statute nor a spam filter, so it must never be produced.
    for (const blank of [null, undefined, "", "   "]) {
      expect(identificationSuffix(blank)).toBeNull();
    }
  });

  it("keeps the token in the template so the substitution is visible", () => {
    expect(IDENTIFICATION_SUFFIX_TEMPLATE).toContain("{business_name}");
  });
});

describe("appendIdentification", () => {
  it("appends to the body the user wrote", () => {
    expect(appendIdentification("On my way", "Mike's Plumbing")).toBe(
      "On my way - Mike's Plumbing. Reply STOP to opt out",
    );
  });

  it("leaves the body alone when there is no name to identify with", () => {
    expect(appendIdentification("On my way", "  ")).toBe("On my way");
  });

  it("never double-appends", () => {
    // Matters for a retry or a replay: the body already persisted carries the
    // suffix, and appending again would bill a second copy.
    const once = appendIdentification("On my way", "Mike's Plumbing");
    expect(appendIdentification(once, "Mike's Plumbing")).toBe(once);
  });

  it("recognises an owner's identical hand-typed sign-off", () => {
    const typed = "On my way - Mike's Plumbing. Reply STOP to opt out";
    expect(appendIdentification(typed, "Mike's Plumbing")).toBe(typed);
  });

  it("still appends when a DIFFERENT business is named in the body", () => {
    const body = "Referred by - Other Co. Reply STOP to opt out";
    expect(appendIdentification(body, "Mike's Plumbing")).toBe(
      `${body} - Mike's Plumbing. Reply STOP to opt out`,
    );
  });
});

describe("segment cost of identifying", () => {
  it("costs one extra segment on a long body, not two", () => {
    // The regression this pins: with an em dash the same message costs 3
    // segments instead of 2, because the encoding switch halves every
    // segment's capacity. Measured through the real estimator, so the
    // guarantee cannot rot if the separator is edited back.
    const body = "x".repeat(150);
    expect(estimateSegments(body).segments).toBe(1);
    expect(estimateSegments(body).encoding).toBe("GSM-7");

    const identified = appendIdentification(body, "Acme Plumbing");
    expect(estimateSegments(identified).encoding).toBe("GSM-7");
    expect(estimateSegments(identified).segments).toBe(2);

    const emDashVersion = `${body} — Acme Plumbing. Reply STOP to opt out`;
    expect(estimateSegments(emDashVersion).encoding).toBe("UCS-2");
    expect(estimateSegments(emDashVersion).segments).toBe(3);
  });

  it("adds nothing when the suffix does not apply", () => {
    const body = "x".repeat(150);
    expect(estimateSegments(appendIdentification(body, null)).segments).toBe(1);
  });
});

describe("shouldIdentify", () => {
  it("is off unless the owner enabled it — D4's reversal is the default", () => {
    expect(
      shouldIdentify({ settingEnabled: false, alreadyIdentifiedAt: null }),
    ).toBe(false);
  });

  it("identifies a contact who has never been identified to", () => {
    expect(
      shouldIdentify({ settingEnabled: true, alreadyIdentifiedAt: null }),
    ).toBe(true);
    expect(
      shouldIdentify({ settingEnabled: true, alreadyIdentifiedAt: undefined }),
    ).toBe(true);
  });

  it("is once per contact — a stranger only once", () => {
    expect(
      shouldIdentify({
        settingEnabled: true,
        alreadyIdentifiedAt: "2026-07-29T12:00:00Z",
      }),
    ).toBe(false);
  });
});
