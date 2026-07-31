import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * [#362] A Tailwind colour utility with no `@theme` entry emits NOTHING.
 *
 * `bg-app-olive` is not a real class — it exists only because `globals.css`
 * declares `--color-app-olive` inside `@theme`, and Tailwind generates the
 * utility from that. Write `bg-app-petrl`, or rename the token without renaming
 * the class, and Tailwind simply does not generate a rule. No error, no warning:
 * the element renders with no background and every gate stays green.
 *
 * This is the same silent-failure shape as `custom-properties.test.ts`, one
 * layer up. That check reads `var(--x)`; this one reads the utility classes,
 * which it cannot see. Between them they cover both halves of how a colour
 * reaches the screen here.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LANDS BEFORE THE RENAME.
 *
 * #362's last step renames `--app-olive-accent*` → `--app-olive*` and
 * `--fr-olive` → `--fr-olive`. Measured, that is ~470 occurrences across ~60
 * files, and roughly 200 of them are utility classes rather than `var()` reads.
 * A rename is precisely the operation that produces this failure, and a missed
 * utility does not break the build — it just stops painting.
 *
 * The var() half of that rename was already made safe. This is the other half,
 * and the rename does not start until both are green.
 */

const SRC = join(process.cwd(), "src");
const GLOBALS = join(SRC, "app", "globals.css");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  });
}

const css = readFileSync(GLOBALS, "utf8");

/**
 * The colour names Tailwind can generate a utility for: every `--color-<name>`
 * declared in `@theme`.
 */
const themed = new Set<string>();
for (const match of css.matchAll(/--color-([a-zA-Z0-9-]+)\s*:/g)) {
  themed.add(match[1]);
}

/**
 * The prefixes this repo owns. Restricting to them is deliberate — Tailwind's
 * own palette (`bg-white`, `text-red-500`) needs no `@theme` entry, and
 * asserting over every utility in the tree would be a check about Tailwind
 * rather than about this codebase's tokens.
 */
const OWNED = /^(app|fr)-/;

/** `bg-app-olive`, `text-fr-ink/70`, `hover:bg-app-hover`, `border-app-line`. */
const UTILITY =
  /(?:^|[\s"'`{[])(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|from|via|to|decoration|outline|shadow|accent|caret|divide|placeholder)-((?:app|fr)-[a-z0-9-]+)/g;

describe("#362 — every app/fr colour utility has a @theme entry", () => {
  it("has no utility class Tailwind will silently refuse to generate", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (/\.test\.tsx?$/.test(file)) continue; // tests name classes to assert them
      const body = readFileSync(file, "utf8")
        .replace(/\/\/.*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of body.matchAll(UTILITY)) {
        // Strip a Tailwind opacity modifier: `text-fr-ink/70` themes on `fr-ink`.
        const name = match[1].split("/")[0];
        if (!OWNED.test(name) || themed.has(name)) continue;
        const where = `${relative(process.cwd(), file)}: ${match[0].trim()}`;
        if (!offenders.includes(where)) offenders.push(where);
      }
    }
    expect(
      offenders,
      "these emit NO rule — Tailwind generates a utility only from a @theme " +
        "entry, so the element renders unstyled and nothing errors:\n" +
        `${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("is actually looking at the tree, not passing over an empty set", () => {
    // A walk that matches nothing passes forever.
    expect(themed.size).toBeGreaterThan(20);
    for (const anchor of ["app-olive", "app-ink", "app-line"]) {
      expect(themed.has(anchor), `--color-${anchor} should be themed`).toBe(true);
    }
    // And the corpus really contains utilities of the shape being checked.
    const seen = sourceFiles(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .some((f) => UTILITY.test(readFileSync(f, "utf8")));
    expect(seen, "no app-/fr- utilities matched anywhere").toBe(true);
  });
});
