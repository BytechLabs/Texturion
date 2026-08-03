import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PLAN_PRICE_CENTS, US_REGISTRATION_FEE_CENTS } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/test/source-tree";

/**
 * #328 — every price surface agrees, because none of them types a price.
 *
 * The acceptance criterion is that marketing, the plan builder, checkout,
 * invoices, the usage page and `/legal/fair-use` all show the same figures.
 * Auditing that by reading them is a thing that is true on the day somebody
 * checks and false a month later — the pricing page and the billing card were
 * already two hand-kept mirrors of the same number before this.
 *
 * So the guarantee is structural: the numbers live in
 * `packages/shared/src/billing-currency.ts`, and no source file may contain a
 * plan price as a literal. A test that reads the tree is the only version of
 * this that stays true.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

/** Every literal that would be a price if somebody typed it. */
const FORBIDDEN: [label: string, pattern: RegExp][] = [
  ["Starter USD", /(?<![\d.])\$29(?![\d])/],
  ["Pro USD", /(?<![\d.])\$79(?![\d])/],
  ["Starter CAD", /(?<![\d.])\$39(?![\d])/],
  ["Pro CAD", /(?<![\d.])\$109(?![\d])/],
];

/**
 * Files allowed to carry a price literal, each for a stated reason.
 *
 * Kept short on purpose. Every entry is a place the guarantee does not reach,
 * and a long list means the guarantee is decorative.
 */
const ALLOWED = [
  // Long-form marketing prose comparing competitors, where the figure is part
  // of a sentence about somebody ELSE's pricing and sourcing it from our own
  // price book would be wrong.
  "compare",
  // Changelogs record what a price WAS. Rewriting history to match today's
  // number is the opposite of what a changelog is for.
  "CHANGELOG",
  // This file names them in order to forbid them.
  "price-surfaces.test.ts",
  /**
   * THIS ONE IS A HOLE, NOT A DECISION (#519).
   *
   * Eight published articles quote our own prices in prose — "$29 a month
   * covers 3 teammates, $79 covers 15", "just $29 and $79 flat from month one",
   * worked examples adding the registration fee. Change a price and every one
   * of them keeps telling prospects the old number.
   *
   * They were never checked: the walk above collected `.ts`/`.tsx` only, so
   * `.mdx` was outside the guarantee entirely and nobody had decided that. It
   * is listed here rather than left invisible, because an exemption somebody
   * can read is worth more than a gap nobody knows about — but it is the
   * opposite of the other three entries, which are places a price literal is
   * CORRECT. Here it is a liability waiting on a price change.
   *
   * Fixing it is content work: either the prose sources the figure from the
   * price book, or the sentences stop naming a number. That is the founder's
   * call about published copy, so it is filed rather than done here.
   */
  "blog",
];

/**
 * The file with its comments removed.
 *
 * A comment explaining WHY a price must not be typed is not a price surface,
 * and matching one would make the guard unfixable except by writing worse
 * comments. Only code can mislead a reader holding a card.
 */
function codeOnly(source: string): string {
  // #519: `stripComments` rather than a local regex. The copy here opened a
  // block comment at any `/*` — including the one in `` `image/*` `` — and
  // blanked everything to the next `*/`, so a price literal in that region was
  // outside the guarantee this file exists to give.
  return stripComments(source);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    // `.mdx` too. The walk collected code only, so twelve marketing articles
    // were outside the guarantee entirely — and eight of them quote OUR prices
    // in prose ("$29 a month covers 3 teammates, $79 covers 15"). Change the
    // Starter price and those posts keep telling prospects the old number,
    // while the check that exists to prevent exactly that reports success.
    else if (/\.(ts|tsx|mdx)$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Path SEGMENTS, not a substring of the whole path.
 *
 * `f.includes("compare")` exempts anything with those letters anywhere in its
 * path, so a future `components/compare-widget.tsx` or `lib/price-compare.ts`
 * would be silently outside the guarantee — nothing today, and exactly the kind
 * of reach nobody would notice being lost. An exemption should name a place,
 * not a spelling.
 */
const FILES = walk(SRC).filter((f) => {
  const segments = f.split(/[\\/]/);
  return !ALLOWED.some((allowed) =>
    segments.some((segment) => segment === allowed || segment.startsWith(allowed + ".")),
  );
});

describe("no price surface types a price (#328)", () => {
  it("finds source files to check at all", () => {
    // A walk that silently returned nothing would make every assertion below
    // pass while checking not one line.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it.each(FORBIDDEN)("has no hardcoded %s figure", (label, pattern) => {
    const offenders = FILES.filter((f) =>
      pattern.test(codeOnly(readFileSync(f, "utf8"))),
    ).map((f) => f.slice(SRC.length));

    expect(
      offenders,
      `\n\n${label} is written as a literal in:\n  ${offenders.join("\n  ")}\n\n` +
        `Read it from PLAN_PRICE_CENTS in packages/shared/src/billing-currency.ts.\n` +
        `A typed price is how the pricing page and the invoice come to disagree,\n` +
        `and the reader who notices is the one holding a card.\n`,
    ).toEqual([]);
  });

  it("keeps the shared book as the only place the figures exist", () => {
    // The guard is only worth anything if the source it points at is real.
    expect(PLAN_PRICE_CENTS.usd.starter).toBe(2900);
    expect(PLAN_PRICE_CENTS.cad.starter).toBe(3900);
    expect(US_REGISTRATION_FEE_CENTS.usd).toBe(2900);
  });
});
