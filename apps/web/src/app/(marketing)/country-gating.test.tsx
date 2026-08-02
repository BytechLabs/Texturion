/**
 * Country-gating regression guard for the shared marketing surfaces that were
 * missed in the first country split (owner ruling v1: a US visitor sees only
 * the US story, a Canadian only the CA story, and nothing pairs the two).
 *
 * Each page is rendered under the site-wide provider pinned to a country, and
 * we assert the country-specific onboarding/pricing copy that used to render
 * unconditionally now appears in its own mode only: the US carrier wait / the
 * one-time registration fee for a US visitor, the same-day / no-registration
 * story for a Canadian, never both. Deliberately NOT asserted: the comparison
 * ledgers' one-time-registration-fee methodology notes (compare page-data.ts),
 * which are factual competitor-comparison data that legitimately state both.
 *
 * #328 — WHAT THIS FILE IS AND IS NOT. It guards GATING: which story renders in
 * which mode. It is not the currency guard. Since the fee figure and the plan
 * price follow the visitor's country now, an assertion written as a literal
 * would be checking the price book by accident, badly, from the wrong file —
 * and would have to be re-typed every time a figure moved. So the few money
 * strings below are derived from the shared book, and the prose anchors that
 * carry no money are matched WITHOUT one. That each page shows the right
 * currency is asserted where the copy lives, in the pages' own colocated tests.
 */

import { formatMoney, PLAN_PRICE_CENTS, US_REGISTRATION_FEE_CENTS } from "@loonext/shared";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-golos-mock", className: "font-golos-mock" }),
}));

import { CountryProvider } from "@/components/marketing/country";

import SharedInboxPage from "@/app/(marketing)/features/shared-inbox/page";
import TemplatesPage from "@/app/(marketing)/features/templates-and-tags/page";
// #242: /status is now an async server component (it reads the live incident
// line from KV), and this sweep renders synchronously. The country gating lives
// entirely in the content component, so that is what gets rendered here — the
// async shell only fetches the feed.
import { StatusContent } from "@/components/marketing/status-content";
import { EMPTY_STATUS_FEED } from "@/lib/marketing/status-feed";
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

/**
 * The registration fee as each country's visitor sees it.
 *
 * Both are needed for the negative assertions. A Canadian must not be shown the
 * US fee in EITHER currency: not the USD figure (a leaked literal) and not the
 * CAD one (a fee sentence that escaped its CountryOnly and got localised on the
 * way out, which is the subtler and more convincing failure).
 *
 * The "one-time " prefix on every match is load-bearing: the fee and the
 * Starter plan price are the same number in both currencies, so a bare figure
 * would match the plan price and the negative assertions would fail against
 * correct copy.
 */
const USD_FEE = formatMoney(US_REGISTRATION_FEE_CENTS.usd, "usd");
const CAD_FEE = formatMoney(US_REGISTRATION_FEE_CENTS.cad, "cad");

/** Plan + one-time fee: the "your first month" total, in each currency. */
const USD_FIRST_MONTH = formatMoney(
  PLAN_PRICE_CENTS.usd.starter + US_REGISTRATION_FEE_CENTS.usd,
  "usd",
);
const CAD_FIRST_MONTH = formatMoney(
  PLAN_PRICE_CENTS.cad.starter + US_REGISTRATION_FEE_CENTS.cad,
  "cad",
);

/** A Canadian sees no US first-month arithmetic, in either currency. */
function expectNoUsFeeStory(html: string) {
  expect(html).not.toContain(`one-time ${USD_FEE}`);
  expect(html).not.toContain(`one-time ${CAD_FEE}`);
  expect(html).not.toContain(USD_FIRST_MONTH);
  expect(html).not.toContain(CAD_FIRST_MONTH);
  expect(html).not.toContain("including the registration fee");
}

describe("sweep verify: each newly-gated surface is clean in both modes", () => {
  it("shared-inbox", () => {
    const u = us(<SharedInboxPage />);
    expect(u).toContain(`US shops also pay a one-time ${USD_FEE}`);
    expect(u).toContain("including the registration fee");
    expect(u).not.toContain("from your first month on");

    const c = ca(<SharedInboxPage />);
    expect(c).toContain("from your first month on");
    expectNoUsFeeStory(c);
  });

  it("templates-and-tags", () => {
    const u = us(<TemplatesPage />);
    expect(u).toContain(`US shops pay a one-time ${USD_FEE}`);
    expect(u).toContain("including the registration fee");
    expect(u).not.toContain("from your first month on");

    const c = ca(<TemplatesPage />);
    expect(c).toContain("from your first month on");
    expectNoUsFeeStory(c);
  });

  it("status", () => {
    const u = us(<StatusContent feed={EMPTY_STATUS_FEED} />);
    expect(u).toContain("carrier approval");
    expect(u).not.toContain("no registration to wait on");

    const c = ca(<StatusContent feed={EMPTY_STATUS_FEED} />);
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
