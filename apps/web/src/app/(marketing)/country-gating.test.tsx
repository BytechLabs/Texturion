/**
 * Country-gating regression guard for the shared marketing surfaces that were
 * missed in the first country split (owner ruling v1: a US visitor sees only
 * the US story, a Canadian only the CA story, and nothing pairs the two).
 *
 * Each page is rendered under the site-wide provider pinned to a country, and
 * we assert the country-specific onboarding/pricing copy that used to render
 * unconditionally now appears in its own mode only: the US carrier wait / the
 * one-time $29 registration fee for a US visitor, the same-day / no-registration
 * story for a Canadian, never both. Deliberately NOT asserted: the comparison
 * ledgers' one-time-registration-fee methodology notes (compare page-data.ts),
 * which are factual competitor-comparison data that legitimately state both.
 */

import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-golos-mock", className: "font-golos-mock" }),
}));

import { CountryProvider } from "@/components/marketing/country";

import SharedInboxPage from "@/app/(marketing)/features/shared-inbox/page";
import TemplatesPage from "@/app/(marketing)/features/templates-and-tags/page";
import StatusPage from "@/app/(marketing)/status/page";
import CompareIndexPage from "@/app/(marketing)/compare/page";
import HeymarketPage from "@/app/(marketing)/compare/heymarket/page";
import QuoPage from "@/app/(marketing)/compare/quo/page";
import PricingPage from "@/app/(marketing)/pricing/page";

const us = (node: ReactNode) =>
  renderToStaticMarkup(
    <CountryProvider initialCountry="us">{node}</CountryProvider>,
  );
const ca = (node: ReactNode) =>
  renderToStaticMarkup(
    <CountryProvider initialCountry="ca">{node}</CountryProvider>,
  );

describe("sweep verify: each newly-gated surface is clean in both modes", () => {
  it("shared-inbox", () => {
    const u = us(<SharedInboxPage />);
    expect(u).toContain("US shops also pay a one-time $29");
    expect(u).toContain("including the registration fee");
    expect(u).not.toContain("$29 is $29 from your first month on");

    const c = ca(<SharedInboxPage />);
    expect(c).toContain("$29 is $29 from your first month on");
    expect(c).not.toContain("one-time $29");
    expect(c).not.toContain("$58");
    expect(c).not.toContain("including the registration fee");
  });

  it("templates-and-tags", () => {
    const u = us(<TemplatesPage />);
    expect(u).toContain("US shops pay a one-time $29");
    expect(u).toContain("including the registration fee");
    expect(u).not.toContain("$29 is $29 from your first month on");

    const c = ca(<TemplatesPage />);
    expect(c).toContain("$29 is $29 from your first month on");
    expect(c).not.toContain("one-time $29");
    expect(c).not.toContain("$58");
    expect(c).not.toContain("including the registration fee");
  });

  it("status", () => {
    const u = us(<StatusPage />);
    expect(u).toContain("carrier approval");
    expect(u).not.toContain("no registration to wait on");

    const c = ca(<StatusPage />);
    expect(c).toContain("no registration to wait on");
    expect(c).not.toContain("carrier approval");
    expect(c).not.toContain("3 to 7");
  });

  it("compare index", () => {
    const u = us(<CompareIndexPage />);
    expect(u).toContain(
      "texting US numbers turns on once the phone companies approve you",
    );
    expect(u).toContain("registration fee included");
    expect(u).not.toContain(
      "Texting Canadian customers works the day you sign up, with no registration to wait on",
    );

    const c = ca(<CompareIndexPage />);
    expect(c).toContain(
      "Texting Canadian customers works the day you sign up, with no registration to wait on",
    );
    expect(c).not.toContain("registration fee included");
    expect(c).not.toContain("texting US numbers turns on once the phone");
  });

  it("compare/heymarket", () => {
    const u = us(<HeymarketPage />);
    expect(u).toContain("US texting turns on in 3 to 7 business days");
    expect(u).toContain("registration fee included");

    const c = ca(<HeymarketPage />);
    expect(c).toContain("Texting Canadian customers works the day you sign up");
    expect(c).not.toContain("US carrier registration applies at every provider");
    expect(c).not.toContain("US texting turns on in 3 to 7 business days");
    expect(c).not.toContain("registration fee included");
  });

  it("compare/quo", () => {
    const u = us(<QuoPage />);
    expect(u).toContain("rather one flat bill than per-user math");
    expect(u).toContain("registration fee included");

    const c = ca(<QuoPage />);
    expect(c).toContain(
      "Canadian texting works the day you sign up, with no registration wait",
    );
    expect(c).not.toContain("registration fee included");
    expect(c).not.toContain("rather one flat bill than per-user math");
  });

  it("pricing", () => {
    const u = us(<PricingPage />);
    expect(u).toContain("subscription and registration fee included");

    const c = ca(<PricingPage />);
    expect(c).toContain("the whole subscription included");
    expect(c).not.toContain("subscription and registration fee included");
  });
});
