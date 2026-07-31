import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { sourceFiles as readSourceFiles } from "@/test/source-tree";

/**
 * [#362 phase 8] The marketing surface renders DARK as well as light.
 *
 * Every earlier phase of #362 had a mechanical gate — a value the tests could
 * read and a ratio they could recompute. Phase 8 was recorded in
 * `docs/OLIVE-CONVERGENCE-PLAN.md` as the one phase with none, because
 * `.mkt-scope` was light-locked by construction: `color-scheme: light` on the
 * scope root plus a `dark:` variant that deliberately excluded marketing. The
 * palette had never rendered dark, so no test could say whether it looked right.
 *
 * That is only half true, and this file is the other half. Nothing here can tell
 * you the site looks GOOD on dark. What it can tell you — and what would
 * otherwise take opening 42 pages twice — is whether any of the three ways this
 * change goes silently wrong has happened:
 *
 *   1. A CONTRAST pair falls below AA on the dark grounds. Recomputed from the
 *      hexes actually in globals.css, both columns, the same formula
 *      globals.contrast.test.ts uses on the app.
 *
 *   2. A colour that is a FILL in one mode carries a label meant for the other.
 *      `bg-[color:var(--fr-olive)] text-white` reads 10.35:1 on light and 1.54:1
 *      on dark. It renders. It does not warn. It is simply unreadable for every
 *      visitor whose OS is dark.
 *
 *   3. A token is declared in one column and not the other, so half the site
 *      keeps its light value on a dark ground.
 *
 * All three are silent at build time and invisible in the light mode a developer
 * is looking at, which is exactly the class of bug this repo keeps shipping
 * (#362's invisible pricing divider, the cobalt hero, the uncoloured sidebar).
 */

const css = readFileSync(
  fileURLToPath(new URL("./globals.css", import.meta.url)),
  "utf8",
);

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `selector "${selector}" exists in globals.css`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

function token(blockCss: string, name: string): string {
  const m = blockCss.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `token ${name} is a 6-digit hex`).not.toBeNull();
  return m![1].toLowerCase();
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
/** WCAG 1.4.11 — UI component boundaries and state indicators. */
const UI = 3;

const LIGHT = block(".mkt-scope,\n.marketing");
const DARK = block(
  ".dark .mkt-scope,\n.mkt-scope.dark,\n.mkt-scope .dark,\n" +
    ".dark .marketing,\n.marketing.dark,\n.marketing .dark",
);

const COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["light", LIGHT],
  ["dark", DARK],
];

describe("#362 phase 8 — marketing reads in both modes", () => {
  it.each(COLUMNS)("body and secondary text clear AA on every %s ground", (
    _mode,
    col,
  ) => {
    // The three surfaces marketing text actually sits on.
    const grounds = {
      ground: token(col, "--fr-ground"),
      card: token(col, "--fr-card"),
      frost: token(col, "--fr-frost"),
    };
    // --fr-ink-55 is the smallest step that still CARRIES text (captions,
    // timestamps, table labels), so it is held to AA rather than waived as
    // decorative. That is what caught #61 on the app side.
    for (const step of ["--fr-ink", "--fr-ink-70", "--fr-ink-55"]) {
      const ink = token(col, step);
      for (const [name, bg] of Object.entries(grounds)) {
        expect(
          contrast(ink, bg),
          `${step} on ${name} (${ink} / ${bg})`,
        ).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it.each(COLUMNS)("the accent is legible as text and takes its own label (%s)", (
    _mode,
    col,
  ) => {
    const olive = token(col, "--fr-olive");
    const onOlive = token(col, "--fr-on-olive");
    const ground = token(col, "--fr-ground");
    const card = token(col, "--fr-card");

    // As TEXT (links, the accent word in a headline).
    expect(contrast(olive, ground), `--fr-olive on ground`).toBeGreaterThanOrEqual(AA);
    expect(contrast(olive, card), `--fr-olive on card`).toBeGreaterThanOrEqual(AA);
    // As a FILL, with the label that belongs to it. This is the pair that
    // inverts: paper-on-olive in light, ink-on-lime in dark.
    expect(contrast(onOlive, olive), `--fr-on-olive on the fill`).toBeGreaterThanOrEqual(AA);
    // …and the fill's own boundary against the page (1.4.11), or a button has
    // no visible edge.
    expect(contrast(olive, ground), `the accent fill's edge`).toBeGreaterThanOrEqual(UI);

    // The hover step has to keep the same label readable — a hover that drops
    // the label below AA is a control nobody can read while using it.
    const deep = token(col, "--fr-olive-deep");
    expect(contrast(onOlive, deep), `--fr-on-olive on the hover fill`).toBeGreaterThanOrEqual(AA);

    // The band's quieter label steps.
    for (const step of ["--fr-on-olive-70", "--fr-on-olive-55"]) {
      expect(contrast(token(col, step), olive), `${step} on the accent band`).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(COLUMNS)("Answered Green stays semantic AND readable (%s)", (_mode, col) => {
    const green = token(col, "--fr-green");
    const onGreen = token(col, "--fr-on-green");
    const olive = token(col, "--fr-olive");

    expect(contrast(green, token(col, "--fr-ground")), "green as text on ground").toBeGreaterThanOrEqual(AA);
    expect(contrast(green, token(col, "--fr-card")), "green as text on card").toBeGreaterThanOrEqual(AA);
    expect(contrast(onGreen, green), "the label on a green fill").toBeGreaterThanOrEqual(AA);

    // The whole reason this token is not just the accent: "handled" and "brand"
    // must not be the same colour. On dark both lift, and lifting them into each
    // other would quietly erase the distinction — a delivered tick that reads as
    // branding. Two colours a person can tell apart, in both modes.
    expect(contrast(green, olive), "green vs the accent").toBeGreaterThanOrEqual(1.6);
  });

  it.each(COLUMNS)("the separate band is separate, and its labels read (%s)", (
    _mode,
    col,
  ) => {
    const inverse = token(col, "--fr-inverse");
    const ground = token(col, "--fr-ground");

    // The band's job is to read as a different surface from the page. On dark
    // it LIFTS to do that: #191b14 on a #141610 ground is 1.05:1 — the footer
    // would simply not be there. This is the assertion that would have caught
    // shipping the light value into the dark column.
    expect(contrast(inverse, ground), "the band against the page").toBeGreaterThan(1.15);

    for (const [step, floor] of [
      ["--fr-on-inverse", AA],
      ["--fr-on-inverse-70", AA],
      ["--fr-on-inverse-55", AA],
    ] as const) {
      expect(
        contrast(token(col, step), inverse),
        `${step} on the band`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it("every --fr-* token declared in one column is declared in the other", () => {
    // A token that exists only in the light column keeps its light value on a
    // dark ground — the exact half-converged state this phase exists to avoid.
    // Deliberate exceptions are listed, not silently skipped.
    const CONSTANT = new Set([
      // A mark, never a surface. 5.37:1 on the dark ground and whitelist-only
      // on light; one coral in both modes is the point.
      "--fr-flare",
    ]);
    const names = (b: string) =>
      new Set([...b.matchAll(/(--fr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const inLight = names(LIGHT);
    const inDark = names(DARK);

    const missingFromDark = [...inLight].filter(
      (n) => !inDark.has(n) && !CONSTANT.has(n),
    );
    expect(
      missingFromDark,
      "declared light-only — these keep a light value on a dark ground",
    ).toEqual([]);

    const missingFromLight = [...inDark].filter((n) => !inLight.has(n));
    expect(missingFromLight, "declared dark-only").toEqual([]);

    // And the walk found real tokens, not an empty set that passes forever.
    expect(inLight.size).toBeGreaterThan(15);
  });

  it("marketing is no longer light-locked", () => {
    // Three things pinned it shut, and all three have to be gone together —
    // any one left behind produces a half-flipped page rather than an error.
    expect(DARK, "the dark column sets color-scheme").toContain("color-scheme: dark");
    expect(LIGHT, "the light column still declares its own").toContain("color-scheme: light");
    // The `dark:` variant used to carve marketing out with `:not(.mkt-scope *)`.
    const variant = css.slice(0, css.indexOf("@custom-variant dark") + 200);
    expect(variant).not.toContain(":not(.mkt-scope *)");
  });
});

/* -------------------------------------------------------------------------
   The component half: a literal white cannot follow a theme.
   ------------------------------------------------------------------------- */

const MARKETING_DIRS = [
  fileURLToPath(new URL("./(marketing)", import.meta.url)),
  fileURLToPath(new URL("../components/marketing", import.meta.url)),
];

/**
 * #492: delegated to the one shared reader — `withFileTypes` instead of a
 * `statSync` per entry (5× fewer syscalls on this tree), memoised so a file
 * with several `it()`s walks once, and an IO failure that says it is one
 * rather than surfacing as whatever this suite asserts about.
 */
const sourceFiles = readSourceFiles;

/**
 * Files that legitimately paint a fixed colour because they are not a themed
 * surface at all. Kept short and reasoned — an allow-list that swallows a
 * directory is how the retired-palette OG image survived the guard meant to
 * catch it (#362, phase 6).
 */
const NOT_A_THEMED_SURFACE = [
  // Rendered once, server-side, into a PNG for social previews. There is no
  // viewer preference to follow: the image is the same bytes for everyone.
  "opengraph-image.tsx",
];

describe("#362 phase 8 — no literal white on a surface that flips", () => {
  const offenders: string[] = [];
  for (const dir of MARKETING_DIRS) {
    for (const file of sourceFiles(dir)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      if (NOT_A_THEMED_SURFACE.some((n) => file.endsWith(n))) continue;
      const body = readFileSync(file, "utf8")
        // Comments EXPLAIN why the literal is wrong; several of these files now
        // carry that explanation. Flagging the explanation is how a guard gets
        // deleted by the next person who trips over it.
        .replace(/\/\/.*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [pattern, what] of [
        [/\btext-white\b/g, "text-white"],
        [/\bbg-white\b/g, "bg-white"],
        [/\bborder-white\b/g, "border-white"],
        [/\boutline-white\b/g, "outline-white"],
        [/#ffffff\b/gi, "#ffffff"],
        [/#fff\b/gi, "#fff"],
        [/\brgba\(\s*255\s*,\s*255\s*,\s*255/g, "rgba(255,255,255…)"],
      ] as const) {
        if (pattern.test(body)) {
          offenders.push(`${relative(process.cwd(), file)}: ${what}`);
        }
      }
    }
  }

  it("has no marketing file painting a hardcoded white", () => {
    expect(
      offenders,
      "white is a value, not a role. On dark it lands on a #d6e77e lime band " +
        "(1.54:1) or becomes a flashbang panel. Use the --fr-on-* token for " +
        "the surface the element actually sits on:\n" +
        `${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("is actually reading the marketing tree", () => {
    // A walk that matches nothing passes forever.
    // Not `flatMap(sourceFiles)`: flatMap passes (value, index, array), and
    // the index would land in the reader's optional extensions parameter.
    const all = MARKETING_DIRS.flatMap((dir) => sourceFiles(dir));
    expect(all.length).toBeGreaterThan(60);
    expect(all.some((f) => f.endsWith("footer.tsx"))).toBe(true);
  });
});

describe("#362 phase 8 — ink is text, never a surface", () => {
  it("has no --fr-ink read in a background position", () => {
    // The trap this whole phase was sequenced around. `--fr-ink` flips light on
    // dark; a band painted with it inverts, taking its label with it. An
    // ALPHA-modified read (`bg-[color:var(--fr-ink)]/[0.04]`) is fine and
    // deliberately allowed: a 4% wash of the text colour is a subtle raise in
    // whichever direction the theme is going, which is the correct behaviour.
    const offenders: string[] = [];
    for (const dir of MARKETING_DIRS) {
      for (const file of sourceFiles(dir)) {
        if (/\.test\.tsx?$/.test(file)) continue;
        const body = readFileSync(file, "utf8")
          .replace(/\/\/.*/g, "")
          .replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of body.matchAll(
          /(?:bg-\[color:var\(--fr-ink\)\](?!\/)|background(?:-color)?:\s*var\(--fr-ink\))/g,
        )) {
          offenders.push(`${relative(process.cwd(), file)}: ${m[0]}`);
        }
      }
    }
    expect(
      offenders,
      "these paint a SURFACE with the TEXT ink, which inverts on dark — use " +
        `--fr-inverse (with --fr-on-inverse for its label):\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });
});
