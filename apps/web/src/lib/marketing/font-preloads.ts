import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The LCP hero-font preload URL(s), produced post-build by
 * scripts/gen-font-preloads.mjs (public/marketing-font-preloads.json). This is
 * the single LCP face (Basteleur Bold); see gen-font-preloads.mjs for why only
 * the LCP face is preloaded (the demoted above-the-fold faces only contended for
 * the critical path with no LCP benefit).
 *
 * next/font hashes each woff2 and, with our `inlineCss: true` delivery fix, does
 * not inject the font `<link rel=preload>`. With `font-display: optional` the
 * preload is what lets Basteleur Bold make the block window so the hero lettering
 * renders instead of the fallback. The (marketing) layout renders a
 * `<link rel="preload" as="font">` for each URL here (React hoists it to <head>).
 *
 * Read ONCE at module load (server only). Missing/malformed manifest degrades to
 * an empty list: no preload, identical to the pre-fix behavior, never a crash
 * (e.g. the first pass of the two-pass build, before the manifest exists).
 */
function loadPreloadUrls(): string[] {
  try {
    const file = join(process.cwd(), "public", "marketing-font-preloads.json");
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.every((u): u is string => typeof u === "string")
    ) {
      return parsed;
    }
  } catch {
    // No manifest yet (or unreadable): degrade to no explicit preload.
  }
  return [];
}

export const MARKETING_FONT_PRELOADS: readonly string[] = loadPreloadUrls();
