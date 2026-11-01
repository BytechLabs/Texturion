import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText } from "@/test/source-tree";

/**
 * The marketing woff2 files keep only the variation-axis values the CSS
 * renders (scripts/instance-marketing-fonts.mjs, #640): Bricolage Grotesque at
 * wght 800 and wdth 100, Hanken Grotesk and Spline Sans Mono from wght 400 up.
 * A rule that asks for any other value draws the nearest one the file kept,
 * which is a different typeface from the source's, and nothing reports it.
 * These fail first, so the script runs again with a wider range.
 */

const SRC = join(process.cwd(), "src");
const files = sourceFiles(SRC, [".ts", ".tsx", ".css"]).filter(
  (file) => !/\.test\.tsx?$/.test(file) && !file.endsWith(join("marketing", "fonts.ts")),
);

/** A weight below 400, a width, or a variation axis other than opsz. */
function asksForDroppedAxisValue(text: string): string[] {
  const hits: string[] = [];
  const rules = [
    /\bfont-(?:thin|extralight|light)\b/g,
    /font-weight:\s*(?:[123]00|lighter)\b/g,
    /fontWeight:\s*["']?(?:[123]00|lighter)\b/g,
    /\bfont-\[\d+\]/g,
    /font-stretch/g,
    /fontStretch/g,
  ];
  for (const rule of rules) hits.push(...(text.match(rule) ?? []));
  for (const [, value] of text.matchAll(/font-variation-settings:\s*([^;}]+)/g)) {
    if (!/^(?:normal|"opsz"\s+[\d.]+)\s*$/.test(value!.trim())) {
      hits.push(`font-variation-settings: ${value!.trim()}`);
    }
  }
  return hits;
}

/** The display face at a weight other than 800. */
function displayAtOtherWeight(text: string): string[] {
  const hits: string[] = [];
  for (const [classes] of text.matchAll(/"[^"\n]*\b(?:font-display|fr-h1|fr-h2)\b[^"\n]*"/g)) {
    const weight = classes.match(
      /\bfont-(?:thin|extralight|light|normal|medium|semibold|bold|black|\[\d+\])(?=[\s"])/,
    );
    if (weight) hits.push(classes);
  }
  for (const [rule, body] of text.matchAll(/@utility\s+[\w-]+\s*\{([^}]*)\}/g)) {
    const weight = body!.match(/font-weight:\s*([^;]+);/);
    if (body!.includes("var(--font-display)") && weight && weight[1]!.trim() !== "800") {
      hits.push(rule.split("{")[0]!.trim());
    }
  }
  return hits;
}

describe("the marketing fonts keep every axis value the CSS asks for (#640)", () => {
  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith("globals.css"))).toBe(true);
  });

  it("asks for no weight below 400, no width and no axis but opsz", () => {
    const offenders = files.flatMap((file) =>
      asksForDroppedAxisValue(sourceText(file)).map((hit) => `${file}: ${hit}`),
    );
    expect(
      offenders,
      "The marketing woff2 files start at wght 400 and carry no wdth axis. " +
        "Widen the range in scripts/instance-marketing-fonts.mjs and run it.",
    ).toEqual([]);
  });

  it("draws the display face at 800 only", () => {
    const offenders = files.flatMap((file) =>
      displayAtOtherWeight(sourceText(file)).map((hit) => `${file}: ${hit}`),
    );
    expect(
      offenders,
      "BricolageGrotesque.woff2 is pinned at wght 800. Widen it in " +
        "scripts/instance-marketing-fonts.mjs and run it.",
    ).toEqual([]);
  });

  it("would report each of those", () => {
    for (const code of [
      'className="font-light"',
      "font-weight: 300;",
      "style={{ fontWeight: 200 }}",
      'className="font-[350]"',
      "font-stretch: 87.5%;",
      'font-variation-settings: "wdth" 80;',
      'font-variation-settings: "opsz" 32, "wght" 650;',
    ]) {
      expect(asksForDroppedAxisValue(code), code).not.toEqual([]);
    }
    expect(asksForDroppedAxisValue('font-variation-settings: "opsz" 96;')).toEqual([]);
    expect(asksForDroppedAxisValue('className="font-medium font-bold"')).toEqual([]);

    expect(displayAtOtherWeight('<h2 className="fr-h2 font-bold">')).not.toEqual([]);
    expect(displayAtOtherWeight('<h1 className="font-display text-2xl font-semibold">')).not.toEqual([]);
    expect(
      displayAtOtherWeight("@utility fr-x {\n  font-family: var(--font-display);\n  font-weight: 700;\n}"),
    ).not.toEqual([]);
    expect(displayAtOtherWeight('<h1 className="font-display font-extrabold">')).toEqual([]);
    expect(displayAtOtherWeight('<p className="font-body-mkt font-semibold">')).toEqual([]);
  });
});
