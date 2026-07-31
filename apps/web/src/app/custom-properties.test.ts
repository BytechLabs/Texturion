import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * [#362] A custom property that does not exist paints NOTHING, silently.
 *
 * `var(--does-not-exist)` is not an error in CSS. There is no fallback, no
 * console warning, no build failure — the declaration is simply dropped and the
 * element renders as though the rule was never written. TypeScript cannot see
 * inside a Tailwind arbitrary value, ESLint has no opinion about it, and the
 * component still renders, so every gate this repo has stays green.
 *
 * IT HAD ALREADY HAPPENED, which is why this exists rather than being a
 * precaution. `(marketing)/pricing/page.tsx` shipped
 *
 *     border-[color:var(--fr-ink-10)]
 *
 * for the divider above the "and if you leave later" block. `--fr-ink-10` is
 * defined nowhere — the marketing scope has `--fr-ink`, `--fr-ink-70` and
 * `--fr-ink-55`. So the border rendered transparent on a live pricing page, and
 * nothing in the toolchain had anything to say about it.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LANDS NOW, BEFORE THE RENAME.
 *
 * #362's phase 9 renames ~10 token families across hundreds of references
 * (`--app-olive-accent*` → `--app-olive*`, `--fr-olive` → `--fr-olive`, and so on).
 * A rename is exactly the operation that produces this failure: miss one read
 * and it does not break, it just stops painting. Doing that at scale without
 * this check would reproduce a known-invisible bug hundreds of times.
 *
 * So the check comes first and the rename does not start until it is green.
 */

const SRC = join(process.cwd(), "src");

/** Every file that can either define or read a custom property. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx", ".css"].includes(extname(path)) ? [path] : [];
  });
}

// Test files name tokens in order to search for them — including this one,
// which quotes `--fr-ink-10` in its own explanation. A guard that flags the
// files describing it is a guard nobody keeps.
const files = sourceFiles(SRC).filter((file) => !/\.test\.tsx?$/.test(file));
const corpus = files.map((file) => ({
  file,
  body: readFileSync(file, "utf8"),
}));

/** Names DECLARED anywhere: `--x: value` in CSS, or a Tailwind `@theme` entry. */
const declared = new Set<string>();
for (const { body } of corpus) {
  // The optional quote matters: a runtime declaration is written
  // `style={{ "--cascade-delay": ... }}`, so the name is followed by `":` and
  // not by `:`. Without it every JS-set property reads as undefined.
  for (const match of body.matchAll(/(--[a-zA-Z0-9-]+)["']?\s*:/g)) {
    declared.add(match[1]);
  }
}

/**
 * Names that come from outside this file tree and are therefore legitimately
 * read without a local declaration.
 *
 * Kept as a short, reasoned list rather than a broad prefix match: an
 * allow-list that swallows a whole namespace is how the retired-palette OG
 * image survived a guard that was meant to catch it (#362, phase 6).
 */
const EXTERNAL = new Set([
  // next/font injects these at build time.
  "--font-golos",
  // next/font again, for the marketing faces.
  "--font-body",
  "--font-mono",
  "--font-display",
  // Radix/vaul set these on their own portals at runtime.
  "--radix-navigation-menu-viewport-height",
  "--radix-navigation-menu-viewport-width",
  "--radix-select-trigger-height",
  "--radix-popper-available-height",
  "--radix-popper-available-width",
  "--radix-popper-anchor-width",
  "--radix-select-trigger-width",
  "--radix-select-content-available-height",
  "--radix-accordion-content-height",
  "--radix-accordion-content-width",
  "--vaul-drawer-direction",
]);

describe("#362 — every custom property that is read is also defined", () => {
  it("has no var(--…) reading a name nothing declares", () => {
    const offenders: string[] = [];
    for (const { file, body } of corpus) {
      // Comments discuss tokens without painting with them, and this repo's
      // comments frequently write `var(--app-*)` in prose.
      const painted = body
        .replace(/\/\/.*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      // `var(--x, fallback)` is the CORRECT way to read a property that may not
      // be set — the fallback is what makes it safe, so it is not an offender.
      // Only a bare read can silently paint nothing.
      for (const match of painted.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)) {
        const name = match[1];
        if (declared.has(name) || EXTERNAL.has(name)) continue;
        // Report each name once per file; a token read in a loop is one bug.
        const where = `${relative(process.cwd(), file)}: ${name}`;
        if (!offenders.includes(where)) offenders.push(where);
      }
    }
    expect(
      offenders,
      "these paint NOTHING — the declaration is dropped and the element renders " +
        "as if the rule was never written:\n" +
        `${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("is actually looking at the tree, not passing over an empty set", () => {
    // A file walk that silently matches nothing passes forever. This asserts
    // the corpus and the declaration set are both real before the check above
    // is trusted.
    expect(files.length).toBeGreaterThan(100);
    expect(declared.size).toBeGreaterThan(50);
    // The tokens the whole product is painted with must be among them.
    for (const anchor of ["--app-olive-accent", "--fr-ink", "--background"]) {
      expect(declared.has(anchor), `${anchor} should be declared`).toBe(true);
    }
  });
});
