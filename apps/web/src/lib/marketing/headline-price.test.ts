import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BILLING_CURRENCIES,
  formatMoney,
  PLAN_PRICE_CENTS,
  PLAN_SEATS,
} from "@loonext/shared";

import {
  HEADLINE_PRICE,
  HEADLINE_PRICE_SUFFIX,
  headlinePrice,
} from "./headline-price";

/**
 * #385 — the headline figure cannot be rendered without the crew size it
 * covers.
 *
 * The claim used to travel and the qualifier stayed home: `$29 /mo · the whole
 * crew` in the site's largest type on the home truth bar and on every feature
 * page, with "For crews of one to three" only ever appearing in the pricing
 * section. Feature pages are what search and the nav deliver people to, so the
 * least qualified surface was the most visited one.
 *
 * #385's own comment asks for the D79 shape rather than a bespoke guard: one
 * declared resolver, and a test that enumerates who may decide. This is that
 * test. It reads the marketing tree rather than trusting review, because the
 * failure mode is somebody building the NEXT page and reaching for the string
 * that is already in three files.
 *
 * #328 CHANGED WHAT "THE HEADLINE PRICE" IS, and the guard had to follow it.
 * There is no single figure any more: a Canadian reader sees the CAD one, so
 * the price arrives at a `MonoFigure` as `headlinePrice(currency)` rather than
 * as one constant. Recognising only the old constant would have left the guard
 * passing while looking at nothing, which is the exact failure the last test
 * here exists to catch.
 */

const MARKETING = join(process.cwd(), "src", "components", "marketing");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return /\.tsx$/.test(path) && !/\.test\.tsx$/.test(path) ? [path] : [];
  });
}

/** Every string that IS the headline price, in every currency we bill in. */
const HEADLINE_FIGURES = BILLING_CURRENCIES.map((currency) =>
  headlinePrice(currency),
);

/**
 * Does this `<MonoFigure …>` render the headline price, however it got hold
 * of it? All three routes count: the declared resolver, the USD constant that
 * fronts it for surfaces with no country signal, and a typed figure in either
 * currency (which `price-surfaces.test.ts` forbids separately, but this guard
 * must not depend on that one holding).
 */
function rendersHeadlinePrice(tag: string): boolean {
  return (
    tag.includes("value={HEADLINE_PRICE}") ||
    tag.includes("value={headlinePrice(") ||
    HEADLINE_FIGURES.some((figure) => tag.includes(`value="${figure}"`))
  );
}

/** Every headline-price MonoFigure in the marketing tree, with its file. */
function headlineFigures(): { file: string; tag: string }[] {
  const found: { file: string; tag: string }[] = [];
  for (const file of tsxFiles(MARKETING)) {
    const source = readFileSync(file, "utf8");
    // Each <MonoFigure …> occurrence, self-closing.
    for (const match of source.matchAll(/<MonoFigure[\s\S]*?\/>/g)) {
      if (rendersHeadlinePrice(match[0])) found.push({ file, tag: match[0] });
    }
  }
  return found;
}

describe("the headline price carries its crew size", () => {
  it("states the seat count the plan actually enforces", () => {
    // Derived, not typed. `PLAN_SEATS.starter` is the same constant that blocks
    // a fourth invite, so the marketing claim and the gate cannot drift — #334's
    // complaint about claims with nothing tying them to the decision behind them.
    expect(HEADLINE_PRICE_SUFFIX).toContain(String(PLAN_SEATS.starter));
    expect(PLAN_SEATS.starter).toBe(3);
  });

  it("keeps the tagline's half-line as well as the fact", () => {
    // "the whole crew" is half the binding tagline and reads well; "up to 3" is
    // exact. #385 leaves the short form as a copy call and suggests keeping
    // both, which is what makes the sentence stop being merely nearly true.
    expect(HEADLINE_PRICE_SUFFIX).toContain("the whole crew");
    expect(HEADLINE_PRICE_SUFFIX).toMatch(/up to \d/);
  });

  it("is never rendered with a hand-written suffix", () => {
    // THE ONE THAT MATTERS. A `MonoFigure` whose value is the headline price
    // must take its suffix from the constant. Anything else is the claim
    // travelling again, and it would look completely reasonable in review.
    const offenders = headlineFigures()
      .filter(({ tag }) => !tag.includes("HEADLINE_PRICE_SUFFIX"))
      .map(
        ({ file, tag }) =>
          `${file.replace(process.cwd(), "")}: ${tag.replace(/\s+/g, " ")}`,
      );
    expect(
      offenders,
      "a MonoFigure renders the headline price with its own suffix:\n" +
        `${offenders.join("\n")}\n` +
        "Use HEADLINE_PRICE_SUFFIX from @/lib/marketing/headline-price. " +
        "The Starter price covers three seats, and D12 puts the ICP at 1-10 — " +
        "for most of the target market this is not the price they will pay.",
    ).toEqual([]);
  });

  it("cannot be smuggled past the suffix through the shared figure", () => {
    // #328 put a component between the pages and the MonoFigure, which is what
    // lets the figure carry a currency. `HeadlinePriceFigure` binds the price
    // and its qualifier together and exposes no `suffix` prop, so #385 holds by
    // construction — this fails the day somebody adds one back.
    for (const file of tsxFiles(MARKETING)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<HeadlinePriceFigure[\s\S]*?\/>/g)) {
        expect(match[0], file.replace(process.cwd(), "")).not.toContain(
          "suffix",
        );
      }
    }
  });

  it("finds the usages it is meant to be guarding", () => {
    // A file walk that silently matches nothing passes forever. Two floors,
    // because #328 split one job across two files: the walk above must have
    // recognised a real MonoFigure, and the resolver must be reached from more
    // than one surface (the truth bar, the feature pages, the trade pages).
    expect(headlineFigures().length).toBeGreaterThanOrEqual(1);
    const rendering = tsxFiles(MARKETING).filter((file) =>
      /HEADLINE_PRICE|headlinePrice\(|HeadlinePriceFigure/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(rendering.length).toBeGreaterThanOrEqual(2);
  });

  it("resolves one figure per currency, and one suffix for both (#328)", () => {
    // The qualifier is a seat count rather than money, so the same sentence
    // sits beside either figure. A currency baked into the suffix is how the
    // Canadian price ends up wearing a US one.
    expect(HEADLINE_PRICE_SUFFIX).not.toMatch(/\$/);
    for (const currency of BILLING_CURRENCIES) {
      expect(headlinePrice(currency)).toBe(
        formatMoney(PLAN_PRICE_CENTS[currency].starter, currency),
      );
    }
    // No two currencies share a figure, so a resolver that ignored its
    // argument could not pass the assertions above by luck.
    expect(new Set(HEADLINE_FIGURES).size).toBe(HEADLINE_FIGURES.length);
    // The static export is the USD one, and nothing else (it is the fallback
    // for surfaces rendered with no visitor, like an OpenGraph image).
    expect(HEADLINE_PRICE).toBe(headlinePrice("usd"));
  });
});
