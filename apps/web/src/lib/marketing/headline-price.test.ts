import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PLAN_SEATS } from "@loonext/shared";

import { HEADLINE_PRICE, HEADLINE_PRICE_SUFFIX } from "./headline-price";

/**
 * #385 — the $29 figure cannot be rendered without the crew size it covers.
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
 */

const MARKETING = join(process.cwd(), "src", "components", "marketing");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return /\.tsx$/.test(path) && !/\.test\.tsx$/.test(path) ? [path] : [];
  });
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
    const offenders: string[] = [];
    for (const file of tsxFiles(MARKETING)) {
      const source = readFileSync(file, "utf8");
      // Each <MonoFigure …> occurrence, self-closing.
      for (const match of source.matchAll(/<MonoFigure[\s\S]*?\/>/g)) {
        const tag = match[0];
        const rendersHeadlinePrice =
          tag.includes(`value="${HEADLINE_PRICE}"`) ||
          tag.includes("value={HEADLINE_PRICE}");
        if (!rendersHeadlinePrice) continue;
        if (!tag.includes("HEADLINE_PRICE_SUFFIX")) {
          offenders.push(`${file.replace(process.cwd(), "")}: ${tag.replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(
      offenders,
      "a MonoFigure renders the headline price with its own suffix:\n" +
        `${offenders.join("\n")}\n` +
        "Use HEADLINE_PRICE_SUFFIX from @/lib/marketing/headline-price. " +
        "$29 covers three seats, and D12 puts the ICP at 1-10 — for most of " +
        "the target market this is not the price they will pay.",
    ).toEqual([]);
  });

  it("finds the usages it is meant to be guarding", () => {
    // A file walk that silently matches nothing passes forever. This asserts
    // the guard is actually looking at something — the truth bar and the
    // feature-page pricing snippet, at minimum.
    const rendering = tsxFiles(MARKETING).filter((file) =>
      readFileSync(file, "utf8").includes("HEADLINE_PRICE"),
    );
    expect(rendering.length).toBeGreaterThanOrEqual(2);
  });
});
