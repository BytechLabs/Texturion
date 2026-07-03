/**
 * subset-marketing-fonts.mjs — regenerate the self-hosted MARKETING type trio as
 * latin-subset woff2 (DESIGN-DIRECTION §3). Committing this keeps the locked
 * fonts reproducible, the same way subset-fonts.mjs does for the app's Inter.
 *
 * The trio, locked by the /fontlab render pass:
 *   Display  Basteleur (Velvetyne, OFL) — Bold + Moonlight cuts
 *   Body     Hanken Grotesk (OFL, variable wght)
 *   Mono     Commit Mono (OFL)
 *
 * Source (unsubset) faces live under scripts/fonts-src/{display,body,mono}-
 * candidates/ (downloaded from the projects' OFL repos; see below). The subset
 * output lands in src/app/fonts/marketing/ where lib/marketing/fonts.ts loads it
 * via next/font/local. Only latin glyph coverage is kept; variable axes and all
 * layout features are preserved.
 *
 * Provenance (all OFL / free commercial use):
 *   Basteleur      gitlab.com/velvetyne/basteleur  (webfonts/Basteleur-{Bold,Moonlight}.woff2)
 *   Hanken Grotesk github.com/google/fonts ofl/hankengrotesk (variable)
 *   Commit Mono    github.com/eigilnikolajsen/commit-mono (450 Regular)
 *
 * Run:
 *   python -m pip install fonttools brotli   # one-time tooling
 *   node apps/web/scripts/subset-marketing-fonts.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const srcRoot = join(webRoot, "scripts", "fonts-src");
const outDir = join(webRoot, "src", "app", "fonts", "marketing");

// The Google-Fonts "latin" unicode-range (plus the currency + a few marks the
// marketing copy renders). Identical intent to subset-fonts.mjs's range; the
// display/mono do not need the arrows block, so it is trimmed.
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
  "U+2000-206F", // general punctuation: curly quotes, dashes, ellipsis, bullet, middot…
  "U+2074",
  "U+20AC", // €
  "U+2122", // ™
  "U+2212", // − minus
  "U+2215", // ∕
  "U+2248", // ≈
  "U+2260", // ≠
  "U+2264-2265", // ≤ ≥
  "U+2713-2714", // ✓ ✔
  "U+FEFF",
  "U+FFFD",
].join(",");

// input (relative to fonts-src) → output filename in src/app/fonts/marketing/
const JOBS = [
  {
    in: "display-candidates/Basteleur-Bold.woff2",
    out: "Basteleur-Bold.woff2",
  },
  {
    in: "display-candidates/Basteleur-Moonlight.woff2",
    out: "Basteleur-Moonlight.woff2",
  },
  {
    in: "body-candidates/HankenGrotesk-Variable.ttf",
    out: "HankenGrotesk-latin.woff2",
  },
  {
    // Commit Mono ships as static OTF per weight; the 450 Regular is our cut.
    // (fonts-src holds the woff2 we already converted from CommitMonoV143-450Regular.otf)
    in: "mono-candidates/CommitMono-Regular.woff2",
    out: "CommitMono-latin.woff2",
  },
];

function kib(p) {
  return `${(statSync(p).size / 1024).toFixed(1)} KiB`;
}

if (!existsSync(srcRoot)) {
  console.error(`Missing source fonts dir: ${srcRoot}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

for (const job of JOBS) {
  const input = join(srcRoot, job.in);
  const output = join(outDir, job.out);
  if (!existsSync(input)) {
    console.error(`Missing source font: ${input}`);
    process.exit(1);
  }
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
