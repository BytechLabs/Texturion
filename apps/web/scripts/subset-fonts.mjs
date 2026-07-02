/**
 * subset-fonts.mjs — regenerate the self-hosted Inter web fonts as a Latin
 * subset (DESIGN.md G2: "self-hosted Inter variable via next/font; latin
 * subset"). Committing this script keeps the subset fonts reproducible.
 *
 * WHY (iteration-4 Lighthouse major): the full-unicode InterVariable woff2
 * files ship 723 KiB on every page (344 KiB roman + 379 KiB italic, ~2,900
 * glyphs each, all Cyrillic/Greek/Vietnamese/symbol ranges we never render).
 * DESIGN.md G2 specifies a latin subset; a properly subset Inter variable is
 * ~50-100 KiB. Marketing prose is Latin-only, so the non-latin glyphs are pure
 * transfer/decode waste.
 *
 * WHAT it keeps: the full variable axes (opsz 14-32, wght 100-900) so every
 * weight/optical-size still renders, and ALL layout features (cv11, ss01, tnum
 * and the rest the design system toggles via font-feature-settings). Only the
 * glyph coverage is cut, to the Google-Fonts "latin" unicode-range — the exact
 * range next/font declares for `subsets: ['latin']`, so no visible character on
 * the site loses its glyph.
 *
 * The source (full) fonts live beside this script under fonts-src/; the subset
 * output lands in src/app/fonts/ where layout.tsx loads it. Run:
 *   python -m pip install fonttools brotli   # one-time tooling
 *   node apps/web/scripts/subset-fonts.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const srcDir = join(webRoot, "scripts", "fonts-src");
const outDir = join(webRoot, "src", "app", "fonts");

// The Google-Fonts "latin" unicode-range — identical to what next/font emits
// for subsets:['latin']. Keeps ASCII, Latin-1 punctuation/symbols, the common
// typographic punctuation (curly quotes, dashes, ellipsis), and the currency
// signs the pricing copy uses. Nothing outside Latin.
const LATIN_UNICODES = [
  "U+0000-00FF",
  "U+0131",
  "U+0152-0153",
  "U+02BB-02BC",
  "U+02C6",
  "U+02DA",
  "U+02DC",
  "U+0304",
  "U+0308",
  "U+0329",
  "U+2000-206F", // general punctuation: curly quotes, dashes, ellipsis, bullet…
  "U+2074",
  "U+20AC", // €
  "U+2122", // ™
  // Arrows & math the marketing copy actually renders as TEXT (verified by
  // scanning src): → ↓ ↔ ⇒ used in "See it →"/"See how it works ↓" nudges and
  // the ≈ ≤ ≥ in pricing math, ✓ in feature checks. All exist in Inter; without
  // these codepoints the browser falls back to a system font for just those
  // glyphs (a visible inconsistency), so they belong in the Latin subset.
  "U+2190-2199", // arrows block (→ ↓ ↔ etc.)
  "U+21D2", // ⇒
  "U+2212", // − minus
  "U+2215", // ∕ division slash
  "U+2248", // ≈
  "U+2260", // ≠
  "U+2264-2265", // ≤ ≥
  "U+2713-2714", // ✓ ✔ checkmarks
  "U+FEFF",
  "U+FFFD",
].join(",");

const JOBS = [
  { in: "InterVariable.woff2", out: "InterVariable.woff2" },
  { in: "InterVariable-Italic.woff2", out: "InterVariable-Italic.woff2" },
];

function kib(p) {
  return `${(statSync(p).size / 1024).toFixed(1)} KiB`;
}

if (!existsSync(srcDir)) {
  console.error(
    `Missing source fonts dir: ${srcDir}\n` +
      `Place the full InterVariable.woff2 + InterVariable-Italic.woff2 there ` +
      `(the un-subset originals) and re-run.`,
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

for (const job of JOBS) {
  const input = join(srcDir, job.in);
  const output = join(outDir, job.out);
  if (!existsSync(input)) {
    console.error(`Missing source font: ${input}`);
    process.exit(1);
  }

  // pyftsubset: keep the variable axes pinned to their full ranges, keep every
  // layout feature ('*'), keep name/hint tables the browser needs, output woff2.
  execFileSync(
    "python",
    [
      "-m",
      "fontTools.subset",
      input,
      `--unicodes=${LATIN_UNICODES}`,
      "--layout-features=*",
      "--glyph-names",
      "--symbol-cmap",
      "--legacy-cmap",
      "--notdef-glyph",
      "--notdef-outline",
      "--recommended-glyphs",
      "--name-IDs=*",
      "--name-legacy",
      "--name-languages=*",
      "--flavor=woff2",
      `--output-file=${output}`,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );

  console.log(`${job.out}: ${kib(input)} → ${kib(output)}`);
}
