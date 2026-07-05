/**
 * Post-build: emit the marketing hero-font preload manifest.
 *
 * WHY: next/font hashes each woff2 to /_next/static/media/<hash>-s.p.woff2 and,
 * with `inlineCss: true` (our render-blocking-CSS fix), does NOT inject the
 * `<link rel=preload as=font>` that normally pairs with the external stylesheet.
 * So the marketing fonts were discovered late (from the inlined @font-face),
 * which delayed the hero Basteleur swap — the LCP lag and the font-swap CLS the
 * Lighthouse audit flagged.
 *
 * This scans the emitted media dir, maps the ABOVE-THE-FOLD hero faces by their
 * exact source byte-size (content-stable), and writes their public URLs to
 * `public/marketing-font-preloads.json`. The (marketing) layout reads that at
 * startup and preloads exactly those faces, so the hero paints in Basteleur at
 * first paint. Only the hero faces are preloaded (not every marketing woff2), to
 * spend the preload budget where the LCP is.
 *
 * Run automatically by scripts/build-isolated.mjs after `next build`.
 */
import { readdirSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const webDir = process.cwd();
const distDir = process.env.JOBTEXT_DIST_DIR || ".next";
const mediaDir = join(webDir, distDir, "static", "media");
const srcFontDir = join(webDir, "src", "app", "fonts", "marketing");
const outFile = join(webDir, "public", "marketing-font-preloads.json");

// The single LCP face: Besley (the variable file carrying the 700-900 range the
// hero H1, the LCP element, is set in). It is the ONLY face preloaded,
// deliberately, not an omission:
//
// Under Lighthouse's Lantern simulation every extra `<link rel=preload as=font>`
// is a High-priority resource that lands on the critical path in the first-paint
// window and contends with the document. Preloading all three above-the-fold faces
// (Bold + Moonlight + Hanken) added critical-path contention with no LCP benefit;
// preloading ONLY the LCP face (Bold) frees that bandwidth. It is also the only
// face worth preloading under `font-display: optional` (fonts.ts): preloading Bold
// is what lets it make the ~100 ms block window on warm/fast loads so the hero
// lettering renders instead of the fallback. (A tinier hero-glyph subset of Bold
// and an inlined data-URI face were both tried and measured no better: the mobile
// LCP is gated by Lantern's estimate of the React/Next framework-JS parse before
// first paint, not by the hero font's bytes.) The demoted faces (Moonlight, the one
// emphasis word; Hanken, sub-copy; Commit Mono, numerals) are self-hosted and, with
// `optional` + their size-adjusted fallbacks, upgrade in-window with zero CLS. The
// app Inter is on the other surface. Map each by exact source byte-size.
const HERO_SOURCES = {
  "Besley-latin.woff2": true,
};

function bySize() {
  const sizes = new Map();
  for (const name of Object.keys(HERO_SOURCES)) {
    const p = join(srcFontDir, name);
    if (existsSync(p)) sizes.set(statSync(p).size, name);
  }
  return sizes;
}

try {
  if (!existsSync(mediaDir)) {
    console.warn(`[gen-font-preloads] no media dir at ${mediaDir}; skipping.`);
    process.exit(0);
  }
  const wantBySize = bySize();
  const urls = [];
  for (const file of readdirSync(mediaDir)) {
    if (!file.endsWith(".woff2")) continue;
    const size = statSync(join(mediaDir, file)).size;
    if (wantBySize.has(size)) {
      urls.push(`/_next/static/media/${file}`);
    }
  }
  urls.sort();
  writeFileSync(outFile, JSON.stringify(urls, null, 2) + "\n");
  console.log(
    `[gen-font-preloads] wrote ${urls.length} hero-font preload URL(s) → public/marketing-font-preloads.json`,
  );
} catch (e) {
  console.warn(`[gen-font-preloads] skipped: ${String(e)}`);
  process.exit(0);
}
