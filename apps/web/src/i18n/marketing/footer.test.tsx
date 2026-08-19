/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Footer } from "@/components/marketing/footer";

import { footerEn, footerFr } from "./footer";

/**
 * D138 — the marketing chrome, in the language the ROUTE is serving.
 *
 * ## The two halves, and why the English one is the important one
 *
 * This commit moves 35 labels out of the component and into a catalogue. That
 * is a refactor of every string in the site's footer, and the failure it could
 * cause is not a missing translation — it is an English page that quietly
 * changed. So the English assertions here are not ceremony: they are the check
 * that a change made FOR French readers cost English ones nothing.
 *
 * ## Why the locale is a prop rather than a context
 *
 * The footer is a server component with no interactivity in it. A context would
 * mean a client boundary around a list of links, and the layout already knows
 * the language — it is serving either `/` or `/fr`.
 */

// Without this, renders stack in one document and the French assertions see
// English left behind by the English ones — vitest does not auto-register it.
afterEach(cleanup);

describe("the marketing footer, in English", () => {
  it("renders the same labels it always did", () => {
    render(<Footer />);
    // Spot-checked across all four columns rather than snapshotted: a snapshot
    // of this footer would fail on a class name and teach somebody to update it
    // without reading what changed.
    for (const label of [
      "Shared inbox",
      "Lou, your assistant",
      "HVAC",
      "Loonext vs Heymarket",
      "Terms of service",
      "Sub-processors",
      "Contact us",
    ]) {
      expect(screen.getByText(label), `${label} is gone from the footer`).toBeTruthy();
    }
  });

  it("still says the brand line and the sign-off", () => {
    render(<Footer />);
    expect(screen.getByText("The shared line for your crew.")).toBeTruthy();
    expect(screen.getByText("Month to month. No sales calls, ever.")).toBeTruthy();
  });

  it("substitutes the year rather than printing the placeholder", () => {
    // `{year}` is the one interpolation in this catalogue, and a placeholder
    // reaching a page is the failure mode that put `{amount}` in front of a
    // customer once already.
    render(<Footer />);
    const year = new Date().getFullYear();
    expect(screen.getByText(`© ${year} Loonext. All rights reserved.`)).toBeTruthy();
    expect(document.body.textContent).not.toContain("{year}");
  });
});

describe("the marketing footer, in French", () => {
  it("renders French labels", () => {
    render(<Footer locale="fr-CA" />);
    for (const label of [
      "Boîte de réception partagée",
      "Plombiers",
      "Politique de confidentialité",
      "Nous joindre",
    ]) {
      expect(screen.getByText(label), `${label} is missing`).toBeTruthy();
    }
  });

  it("leaves no English label behind", () => {
    // The half-translated failure this whole decision exists to prevent: a
    // footer with four French columns and one English one reads as broken in a
    // way an all-English footer does not.
    render(<Footer locale="fr-CA" />);
    // Exact node text, not a substring of the page: "Comparer" CONTAINS
    // "Compare" and "Blogue" contains "Blog", so a substring search reports two
    // correct translations as failures. That was this check's first version.
    const englishOnly = (Object.keys(footerEn) as (keyof typeof footerEn)[]).filter(
      (key) =>
        footerEn[key] !== footerFr[key] &&
        screen.queryAllByText(footerEn[key]).length > 0,
    );
    expect(englishOnly, "these are still in English on the French footer").toEqual([]);
  });

  it("substitutes the year in French too", () => {
    render(<Footer locale="fr-CA" />);
    const year = new Date().getFullYear();
    expect(screen.getByText(`© ${year} Loonext. Tous droits réservés.`)).toBeTruthy();
  });

  it("does not translate a name somebody has to type or search for", () => {
    // Loonext, Lou, Heymarket, Quo and HVAC stay. A name that changes with the
    // reader's language is a name that cannot be quoted in a support email.
    render(<Footer locale="fr-CA" />);
    expect(screen.getByText("Lou, votre adjoint")).toBeTruthy();
    expect(screen.getByText("Loonext vs Heymarket")).toBeTruthy();
    expect(screen.getByText("HVAC")).toBeTruthy();
  });
});

describe("the two catalogues", () => {
  it("carry the same keys, which the type already guarantees at build time", () => {
    // Belt and braces on the one thing tsc cannot see: a build where the two
    // halves were edited in separate deploys.
    expect(Object.keys(footerFr).sort()).toEqual(Object.keys(footerEn).sort());
  });

  it("actually differ, so a copied English half cannot pass", () => {
    const identical = (Object.keys(footerEn) as (keyof typeof footerEn)[]).filter(
      (key) => footerEn[key] === footerFr[key],
    );
    // The names above are the legitimate exceptions, and naming them here means
    // a NEW identical pair fails rather than joining a silent list.
    expect(identical.sort()).toEqual(
      ["compareHeymarket", "compareQuo", "contacts", "hvac", "salons"].sort(),
    );
  });
});
