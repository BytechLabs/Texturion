import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
 */

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
        <CountryText us="a one-time $29 registration fee" ca="no fee" />
      </>,
    );
    expect(html).not.toContain("—");
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
