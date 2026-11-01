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
 * Tooling, one-time, in a virtualenv:
 *   python -m pip install fonttools==4.68.0 brotli==1.2.1
 * Run from the repo root, with PYTHON naming that venv's python if it is not
 * the one on PATH:
 *   PYTHON=.venv/bin/python node apps/web/scripts/instance-marketing-fonts.mjs
 *
 * The output is byte for byte reproducible: SOURCE_DATE_EPOCH fixes the one
 * timestamp fonttools writes (head.modified), and the script checks each file
 * against the SHA-256 recorded below. A mismatch means a different fonttools
 * or brotli, or a changed job; record the new hash only after checking the
 * pages still draw the same pixels.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "fonts-src", "marketing");
const outDir = join(here, "..", "src", "app", "fonts");

// 2026-11-01T00:00:00Z
const SOURCE_DATE_EPOCH = "1793491200";

const JOBS = [
  {
    in: "BricolageGrotesque-latin.woff2",
    out: "BricolageGrotesque.woff2",
    axes: ["wght=800", "wdth=100"],
    sha256: "2127e9536d63627f3ae0cddbc89878fe179d006cdf4e094ac7294869e3dac133",
  },
  {
    in: "HankenGrotesk-latin.woff2",
    out: "HankenGrotesk.woff2",
    axes: ["wght=400:900"],
    sha256: "4864954ba327f9233b7851f08c8cd8bae429a0213e80a19257ed3d5cb8ac29b3",
  },
  {
    in: "SplineSansMono-latin.woff2",
    out: "SplineSansMono.woff2",
    axes: ["wght=400:700"],
    sha256: "4bf1c757141452f0c7a04c23d0a80d1e73ea0c86b87c18eb4f3997f803dc14f5",
  },
];

const kib = (p) => `${(statSync(p).size / 1024).toFixed(1)} KiB`;

let mismatched = false;
for (const job of JOBS) {
  const input = join(srcDir, job.in);
  const output = join(outDir, job.out);
  if (!existsSync(input)) {
    console.error(`Missing source font: ${input}`);
    process.exit(1);
  }
  // The output keeps the input's woff2 flavor.
  execFileSync(
    process.env.PYTHON ?? "python",
    ["-m", "fontTools.varLib.instancer", input, ...job.axes, `--output=${output}`],
    { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, SOURCE_DATE_EPOCH } },
  );
  const sha256 = createHash("sha256").update(readFileSync(output)).digest("hex");
  console.log(`${job.out} (${job.axes.join(" ")}): ${kib(input)} -> ${kib(output)}`);
  if (sha256 !== job.sha256) {
    console.error(`${job.out}: sha256 ${sha256}, expected ${job.sha256}`);
    mismatched = true;
  }
}
if (mismatched) process.exit(1);
