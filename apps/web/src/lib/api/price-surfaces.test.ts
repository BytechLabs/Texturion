import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PLAN_PRICE_CENTS, US_REGISTRATION_FEE_CENTS } from "@loonext/shared";
import { describe, expect, it } from "vitest";

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
];

/**
 * The file with its comments removed.
 *
 * A comment explaining WHY a price must not be typed is not a price surface,
 * and matching one would make the guard unfixable except by writing worse
 * comments. Only code can mislead a reader holding a card.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).filter(
  (f) => !ALLOWED.some((allowed) => f.includes(allowed)),
);

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
