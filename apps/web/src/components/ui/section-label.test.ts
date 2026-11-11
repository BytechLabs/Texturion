/**
 * #733: one small uppercase heading, drawn one way.
 *
 * Ten class strings drew the same label before this (11px or 12px or `text-xs`,
 * `tracking-wide` or 0.06em or 0.08em, three colours). This fails on any class
 * string in the app that is uppercase and tracked and is not a chip, so a new
 * screen cannot quietly start an eleventh.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { SECTION_LABEL_CLASS } from "./section-label";

const SRC = join(__dirname, "..", "..");

/** Marketing and the public pages have their own type scale (`fr-*`). */
const OUT_OF_SCOPE = ["components/marketing/", "app/(marketing)/", "components/public/"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

describe("#733 section labels come from SECTION_LABEL_CLASS", () => {
  const files = walk(SRC)
    .map((file) => ({ file, rel: relative(SRC, file).replaceAll("\\", "/") }))
    .filter(({ rel }) => !OUT_OF_SCOPE.some((prefix) => rel.startsWith(prefix)))
    .filter(({ rel }) => rel !== "components/ui/section-label.tsx");

  it("finds no hand-rolled uppercase, tracked label", () => {
    const offenders: string[] = [];
    for (const { file, rel } of files) {
      for (const match of readFileSync(file, "utf8").matchAll(/"([^"\n]*\buppercase\b[^"\n]*)"/g)) {
        const classes = match[1];
        // A chip is a filled, rounded token: its own pattern, not a label.
        if (!/\btracking-/.test(classes) || /\brounded/.test(classes)) continue;
        offenders.push(`${rel}: "${classes}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is used across the app, so an empty scan cannot pass", () => {
    const users = files.filter(({ file }) => readFileSync(file, "utf8").includes("SECTION_LABEL_CLASS"));
    expect(users.length).toBeGreaterThanOrEqual(20);
  });

  it("reads 11px, semibold, uppercase, 0.06em, in the AA-safe muted ink", () => {
    expect(SECTION_LABEL_CLASS.split(" ").sort()).toEqual(
      ["font-semibold", "text-[11px]", "text-app-muted", "tracking-[0.06em]", "uppercase"].sort(),
    );
  });
});
