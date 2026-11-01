/**
 * instance-marketing-fonts.mjs: rebuild the three marketing woff2 files in
 * src/app/fonts/ from the sources in scripts/fonts-src/marketing/ (#640).
 *
 * The sources are the latin-subset variable woff2 files Google Fonts serves
 * for each family, exactly as they shipped before this script existed. This
 * script only narrows variation axes to the values the marketing CSS renders,
 * so every page draws the same pixels from fewer bytes. It does not touch the
 * glyph set or the layout features.
 *
 *   Bricolage Grotesque  wght pinned at 800, wdth pinned at 100, opsz 12-96
 *                        kept whole. 800 is the only display weight and no
 *                        rule sets font-stretch or a wdth variation, and both
 *                        pins are the font's own defaults, so the outlines
 *                        are the source's. 128.5 KiB -> 37.5 KiB.
 *   Hanken Grotesk       wght 400-900 (was 100-900). Nothing renders below
 *                        400, and a <strong> in a 600 label resolves to 900.
 *                        33.9 KiB -> 23.6 KiB.
 *   Spline Sans Mono     wght 400-700 (was 300-700). Nothing renders below
 *                        400. 35.6 KiB -> 28.6 KiB.
 *
 * The @font-face weight ranges in src/lib/marketing/fonts.ts still name the
 * source ranges. A weight outside the ranges above renders as the nearest
 * one the file keeps (a display heading at 600 would draw at 800), so a rule
 * that needs one re-runs this script with a wider range first.
 * src/lib/marketing/font-axes.test.ts fails on a marketing class or rule that
 * asks for one.
 *
 * Tooling, one-time (the output was made with fonttools 4.68.0 and brotli):
 *   python -m pip install fonttools brotli
 * Run from the repo root:
 *   node apps/web/scripts/instance-marketing-fonts.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "fonts-src", "marketing");
const outDir = join(here, "..", "src", "app", "fonts");

const JOBS = [
  { in: "BricolageGrotesque-latin.woff2", out: "BricolageGrotesque.woff2", axes: ["wght=800", "wdth=100"] },
  { in: "HankenGrotesk-latin.woff2", out: "HankenGrotesk.woff2", axes: ["wght=400:900"] },
  { in: "SplineSansMono-latin.woff2", out: "SplineSansMono.woff2", axes: ["wght=400:700"] },
];

const kib = (p) => `${(statSync(p).size / 1024).toFixed(1)} KiB`;

for (const job of JOBS) {
  const input = join(srcDir, job.in);
  const output = join(outDir, job.out);
  if (!existsSync(input)) {
    console.error(`Missing source font: ${input}`);
    process.exit(1);
  }
  // The output keeps the input's woff2 flavor.
  execFileSync(
    "python",
    ["-m", "fontTools.varLib.instancer", input, ...job.axes, `--output=${output}`],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  console.log(`${job.out} (${job.axes.join(" ")}): ${kib(input)} -> ${kib(output)}`);
}
