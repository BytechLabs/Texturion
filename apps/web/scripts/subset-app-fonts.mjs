/**
 * subset-app-fonts.mjs — regenerate the self-hosted APP web font (Golos Text) as
 * a latin-subset woff2, exactly how subset-fonts.mjs does for Inter. Committing
 * this script keeps the subset font reproducible.
 *
 * Golos Text (Golos type foundry, OFL) is the APP's primary sans — an uncommon,
 * UI-grade grotesque with true tabular figures (APP-SHELL-REDESIGN.md). It
 * REPLACES Inter in the (app) subtree; marketing keeps its own trio. The source
 * variable .ttf (wght 400-900) is staged under scripts/fonts-src/; the subset
 * output lands in src/app/fonts/ where lib/app/fonts.ts loads it via
 * next/font/local.
 *
 * WHAT it keeps: the full wght variable axis so every weight still renders, and
 * ALL layout features ('*': tnum for tabular figures the app toggles, plus the
 * rest). Only glyph coverage is cut, to the Google-Fonts "latin" unicode-range —
 * the exact range next/font declares for `subsets: ['latin']`, so no visible
 * character in the app loses its glyph.
 *
 * The source (full) font lives beside this script under fonts-src/; run:
 *   python -m pip install fonttools brotli   # one-time tooling
 *   node apps/web/scripts/subset-app-fonts.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const srcDir = join(webRoot, "scripts", "fonts-src");
const outDir = join(webRoot, "src", "app", "fonts");

// The Google-Fonts "latin" unicode-range — identical to what next/font emits for
// subsets:['latin']. Mirrors subset-fonts.mjs (LATIN_UNICODES): ASCII, Latin-1,
// the common typographic punctuation (curly quotes, dashes, ellipsis), currency,
// and the arrows/math/✓ the app may render as text. Keep in sync with the
// unicode-range declared in lib/app/fonts.ts.
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
  { in: "GolosText-Variable.ttf", out: "GolosText.woff2" },
];

function kib(p) {
  return `${(statSync(p).size / 1024).toFixed(1)} KiB`;
}

if (!existsSync(srcDir)) {
  console.error(
    `Missing source fonts dir: ${srcDir}\n` +
      `Place the full GolosText-Variable.ttf there (the un-subset original) ` +
      `and re-run.`,
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

  // pyftsubset: keep the wght variable axis at its full range, keep every layout
  // feature ('*'), keep the name/hint tables the browser needs, output woff2.
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
