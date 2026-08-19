/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConsentVisual } from "@/components/marketing/features/consent-visual";

import { consentVisualEn, consentVisualFr } from "./consent-visual";

/**
 * D138 — the consent illustration, in both languages.
 *
 * This is the first SHARED piece of page content translated, and it is worth
 * saying what that buys: `/canada` and `/features/compliance` both render it,
 * so the second of those two pages needs no work here at all. That is Rule
 * 10's claim about the first page being the expensive one, in evidence.
 */

afterEach(cleanup);

describe("the consent records", () => {
  it("read as they always did in English", () => {
    render(<ConsentVisual />);
    expect(screen.getByText(consentVisualEn.firstRecordLine)).toBeTruthy();
    expect(screen.getByText(consentVisualEn.secondRecordDetail)).toBeTruthy();
  });

  it("read in French when the route is French", () => {
    render(<ConsentVisual locale="fr-CA" />);
    expect(screen.getByText(consentVisualFr.firstRecordLine)).toBeTruthy();
    expect(screen.getByText(consentVisualFr.secondRecordDetail)).toBeTruthy();
  });

  it("writes the dates the way French Canadian writes them", () => {
    // Day first, month lowercase, and `juil.` abbreviated where `juin` is not.
    // "Jun 12" left in place is the tell that a date was pasted rather than
    // translated, and it is the detail a reader notices before the sentence.
    render(<ConsentVisual locale="fr-CA" />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("12 juin");
    expect(text).toContain("2 juil.");
    expect(text).not.toContain("Jun 12");
    expect(text).not.toContain("Jul 2");
  });

  it("leaves the names and the numbers alone in both", () => {
    // Karen, Priya and the Nguyen family are example people, and Quebec has
    // all three of those names in it. The numbers are 555 reservations in real
    // Canadian area codes, which is the whole point of them.
    for (const locale of ["en", "fr-CA"] as const) {
      cleanup();
      render(<ConsentVisual locale={locale} />);
      expect(screen.getByText("Karen M")).toBeTruthy();
      expect(screen.getByText("Nguyen family")).toBeTruthy();
      expect(screen.getByText("(416) 555-0187")).toBeTruthy();
    }
  });

  it("has no English sentence left on the French render", () => {
    render(<ConsentVisual locale="fr-CA" />);
    const text = document.body.textContent ?? "";
    const leftBehind = (Object.keys(consentVisualEn) as (keyof typeof consentVisualEn)[])
      .filter((key) => text.includes(consentVisualEn[key]));
    expect(leftBehind, "these records are still in English").toEqual([]);
  });
});
