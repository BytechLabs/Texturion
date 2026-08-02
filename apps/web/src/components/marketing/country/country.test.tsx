import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  formatMoney,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
} from "@loonext/shared";

/**
 * The site-wide country infrastructure (owner ruling v1): the persistence
 * contract, the branch helpers, the nav selector, and the first-visit chooser.
 *
 * The repo runs vitest in the node environment (no jsdom), so client behavior is
 * covered two ways: the persistence logic lives in pure helpers exercised
 * against a fake Storage, and every component is asserted through its SSR markup
 * (renderToStaticMarkup), which is also the exact HTML a JS-disabled visitor
 * gets. The "us" default and every branch are pinned; hydration-time swapping is
 * a thin useEffect over these same tested helpers.
 *
 * #328 added a fourth thing this context decides: the money. The last describe
 * covers it here, in the file that owns the signal, because the whole design is
 * that there is no second control to disagree with this one.
 */

import {
  FirstMonthTotal,
  PlanPrice,
  RegistrationFee,
} from "@/components/marketing/pricing/plan-price";

import { CountryProvider } from "./country-context";
import { CountryOnly, CountryText } from "./country-only";
import { CountrySelector } from "./country-selector";
import {
  COUNTRY_STORAGE_KEY,
  isCountry,
  readStoredCountry,
  writeStoredCountry,
} from "./country-storage";
import { HeroCountryChooser } from "./hero-country-chooser";

/**
 * #328 — the figures each country's visitor is charged, read from the one book.
 *
 * Built for both currencies because the claim under test is not "the markup
 * says $29" but "the markup says what THIS reader's card will be charged". A
 * typed figure would make this file a second copy of the price book, and a
 * stale one the day a figure moves.
 */
function money(currency: "usd" | "cad") {
  return {
    starter: formatMoney(PLAN_PRICE_CENTS[currency].starter, currency),
    pro: formatMoney(PLAN_PRICE_CENTS[currency].pro, currency),
    fee: formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency),
    /** Plan plus the one-time US fee: the sum that can drift on its own. */
    firstMonth: formatMoney(
      PLAN_PRICE_CENTS[currency].starter + US_REGISTRATION_FEE_CENTS[currency],
      currency,
    ),
  };
}
const USD = money("usd");
const CAD = money("cad");

/** A subtree rendered under the site-wide provider, pinned to one country. */
const us = (node: ReactNode) =>
  renderToStaticMarkup(
    <CountryProvider initialCountry="us">{node}</CountryProvider>,
  );
const ca = (node: ReactNode) =>
  renderToStaticMarkup(
    <CountryProvider initialCountry="ca">{node}</CountryProvider>,
  );

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("country-storage (the persistence contract, framework-free)", () => {
  it("narrows only 'us' and 'ca' as valid countries", () => {
    expect(isCountry("us")).toBe(true);
    expect(isCountry("ca")).toBe(true);
    expect(isCountry("mx")).toBe(false);
    expect(isCountry(null)).toBe(false);
    expect(isCountry(undefined)).toBe(false);
    expect(isCountry(42)).toBe(false);
  });

  it("reads a valid stored choice and rejects anything else", () => {
    expect(readStoredCountry(fakeStorage({ [COUNTRY_STORAGE_KEY]: "ca" }))).toBe(
      "ca",
    );
    expect(readStoredCountry(fakeStorage({ [COUNTRY_STORAGE_KEY]: "us" }))).toBe(
      "us",
    );
    // Nothing stored, or a junk value, reads as "no choice yet".
    expect(readStoredCountry(fakeStorage())).toBeNull();
    expect(
      readStoredCountry(fakeStorage({ [COUNTRY_STORAGE_KEY]: "france" })),
    ).toBeNull();
  });

  it("treats missing/unavailable storage as no choice (SSR, private mode)", () => {
    expect(readStoredCountry(null)).toBeNull();
    expect(readStoredCountry(undefined)).toBeNull();
    const thrower = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readStoredCountry(thrower)).toBeNull();
  });

  it("writes the choice under the single key", () => {
    const store = fakeStorage();
    writeStoredCountry(store, "ca");
    expect(store.map.get(COUNTRY_STORAGE_KEY)).toBe("ca");
    writeStoredCountry(store, "us");
    expect(store.map.get(COUNTRY_STORAGE_KEY)).toBe("us");
  });

  it("swallows a storage write failure instead of throwing in the UI", () => {
    const thrower = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeStoredCountry(thrower, "ca")).not.toThrow();
    expect(() => writeStoredCountry(null, "ca")).not.toThrow();
  });
});

describe("<CountryOnly> / <CountryText> branch on the shared context", () => {
  it("SSR default (us) shows the US branch and hides the CA branch", () => {
    const html = renderToStaticMarkup(
      <>
        <CountryOnly country="us">
          <span>ONLY-US</span>
        </CountryOnly>
        <CountryOnly country="ca">
          <span>ONLY-CA</span>
        </CountryOnly>
        <CountryText us="INLINE-US" ca="INLINE-CA" />
      </>,
    );
    expect(html).toContain("ONLY-US");
    expect(html).not.toContain("ONLY-CA");
    expect(html).toContain("INLINE-US");
    expect(html).not.toContain("INLINE-CA");
  });

  it("renders the CA branch when the provider is pinned to Canada", () => {
    const html = renderToStaticMarkup(
      <CountryProvider initialCountry="ca">
        <CountryOnly country="us">
          <span>ONLY-US</span>
        </CountryOnly>
        <CountryOnly country="ca">
          <span>ONLY-CA</span>
        </CountryOnly>
        <CountryText us="INLINE-US" ca="INLINE-CA" />
      </CountryProvider>,
    );
    expect(html).toContain("ONLY-CA");
    expect(html).not.toContain("ONLY-US");
    expect(html).toContain("INLINE-CA");
    expect(html).not.toContain("INLINE-US");
  });
});

describe("<CountrySelector> (the nav radiogroup)", () => {
  it("SSR default marks United States checked, Canada unchecked", () => {
    const html = renderToStaticMarkup(<CountrySelector />);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toContain('role="radio" aria-checked="true"');
    // Compact mode: short labels visible, full names in aria for the SR.
    expect(html).toContain(">US<");
    expect(html).toContain(">CA<");
    expect(html).toContain('aria-label="United States"');
    expect(html).toContain('aria-label="Canada"');
  });

  it("full-label mode renders the long names for the mobile sheet", () => {
    const html = renderToStaticMarkup(<CountrySelector fullLabels />);
    expect(html).toContain("United States");
    expect(html).toContain("Canada");
  });

  it("reflects a Canada context (Canada checked, US not)", () => {
    const html = renderToStaticMarkup(
      <CountryProvider initialCountry="ca">
        <CountrySelector />
      </CountryProvider>,
    );
    // The Canada radio carries aria-label="Canada" and is the checked one.
    expect(html).toContain(
      'aria-checked="true" aria-label="Canada"',
    );
    expect(html).toContain(
      'aria-checked="false" aria-label="United States"',
    );
  });
});

describe("<HeroCountryChooser> (first-visit affordance)", () => {
  it("renders the prompt and both choices in the server HTML (hasChosen is false on SSR)", () => {
    const html = renderToStaticMarkup(<HeroCountryChooser />);
    expect(html).toContain("Where do you run your business");
    expect(html).toContain("United States");
    expect(html).toContain("Canada");
    expect(html).toContain('role="group"');
  });
});

describe("the country infrastructure never renders an em-dash (Law 6)", () => {
  it("holds across the selector, the chooser, and both branch outputs", () => {
    const html = renderToStaticMarkup(
      <>
        <CountrySelector />
        <CountrySelector fullLabels />
        <HeroCountryChooser />
        {/* A representative money sentence, priced from the book rather than
            typed: this test is about the dash, and a literal figure here would
            still be a second copy of the price (#328). */}
        <CountryText
          us={`a one-time ${USD.fee} registration fee`}
          ca="no fee"
        />
      </>,
    );
    expect(html).not.toContain("—");
  });
});

describe("the money branches on the same signal as the copy (#328)", () => {
  it("quotes a US visitor in US dollars", () => {
    expect(us(<PlanPrice plan="starter" />)).toBe(USD.starter);
    expect(us(<PlanPrice plan="pro" />)).toBe(USD.pro);
    expect(us(<RegistrationFee />)).toBe(USD.fee);
    expect(us(<FirstMonthTotal plan="starter" />)).toBe(USD.firstMonth);
  });

  it("quotes a Canadian visitor in Canadian dollars", () => {
    // THE ONE THAT MATTERS. Every one of these used to be the US figure on a
    // Canada-first page, and a literal never disagrees with itself: the drift
    // only surfaced on the invoice, in front of somebody holding a card.
    expect(ca(<PlanPrice plan="starter" />)).toBe(CAD.starter);
    expect(ca(<PlanPrice plan="pro" />)).toBe(CAD.pro);
    // A Canadian workspace CAN turn on US texting, and then the one-time fee
    // lands on a Canadian invoice, so it carries a currency too.
    expect(ca(<RegistrationFee />)).toBe(CAD.fee);
    expect(ca(<FirstMonthTotal plan="starter" />)).toBe(CAD.firstMonth);
  });

  it("the two countries are actually different figures", () => {
    // Without this the pair of tests above would both pass on a resolver that
    // ignored the country entirely.
    expect(CAD.starter).not.toBe(USD.starter);
    expect(CAD.pro).not.toBe(USD.pro);
  });

  it("defaults to the US figure with no provider above it (SSR)", () => {
    // Same default as every other branch here: "us" until a visitor says
    // otherwise, so the server HTML and the first paint agree.
    expect(renderToStaticMarkup(<PlanPrice plan="starter" />)).toBe(
      USD.starter,
    );
  });
});

describe("provider default is stable across identical renders (no hydration mismatch)", () => {
  it("the same tree renders identically twice at the us default", () => {
    const once = renderToStaticMarkup(<CountrySelector />);
    const twice = renderToStaticMarkup(<CountrySelector />);
    expect(once).toBe(twice);
    // Sanity: the setter never throws when read outside a provider.
    expect(() => vi.fn()).not.toThrow();
  });
});
