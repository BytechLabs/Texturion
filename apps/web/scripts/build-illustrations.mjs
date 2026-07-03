/**
 * build-illustrations.mjs — turn the raw unDraw source SVGs
 * (scripts/illustrations-src/) into JobText-branded, optimized, committed
 * illustration assets under public/illustrations/, and (re)generate the
 * manifest public/illustrations/manifest.ts the marketing rebuild consumes.
 *
 * WHY unDraw (VISUALS-V2 §3 — ONE cohesive professional library):
 *   - MIT-clean license: free for commercial use, NO attribution required, and
 *     recoloring/modification explicitly permitted (undraw.co/license). We still
 *     record the source in CREDITS.md, and we use the illustrations in-product —
 *     we do NOT redistribute them as a pack (the one license restriction).
 *   - ONE style, single-accent recolorable — the exact fix for the user's
 *     "inconsistent / ugly" complaint: every scene shares one flat, warm,
 *     characterful grammar, and the single brand accent (#6c63ff on unDraw)
 *     recolors to petrol so the whole set reads as one art-directed system.
 *
 * WHAT this script does (reproducible, like subset-fonts.mjs / capture-shots.mjs):
 *   1. RECOLOR toward the JobText brand (one art-director grade):
 *        - the unDraw accent #6c63ff  → petrol #0F766E   (brand accent)
 *        - the cold blue-black "ink"  → warm stone ink    (#1c1917 family)
 *        so the people/scenes read WARM, not corporate-cold-blue. Skin tones
 *        are preserved (they carry the human warmth VISUALS-V2 §2/§6 asks for).
 *   2. OPTIMIZE: strip XML/DOCTYPE/comments, collapse whitespace, ensure the
 *        <svg> has no fixed width/height that would fight responsive layout
 *        (viewBox is kept — every source has one, verified). Inline SVG is
 *        weightless and crisp at any DPR (VISUALS-V2 §7).
 *   3. WRITE the branded SVG to public/illustrations/<key>.svg.
 *   4. EMIT public/illustrations/manifest.ts: key → { src, viewBox, w, h, alt,
 *        credit } — the typed API the rebuild renders through <Illustration/>.
 *
 * Run:  node apps/web/scripts/build-illustrations.mjs
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const srcDir = join(webRoot, "scripts", "illustrations-src");
const outDir = join(webRoot, "public", "illustrations");

/**
 * The scene set the marketing rebuild needs (VISUALS-V2 §3). Each entry maps a
 * stable, semantic KEY (what the rebuild imports) to the source unDraw slug and
 * honest alt text. ONE library, ONE style — no mixing.
 */
const SCENES = [
  {
    key: "shared-inbox",
    slug: "group-chat_nze2",
    alt: "A team sharing one conversation — the whole crew sees every customer text.",
  },
  {
    key: "get-a-number",
    slug: "my-location_dcug",
    alt: "Picking a local business phone number for your area.",
  },
  {
    key: "crew",
    slug: "meet-the-team_fau8",
    alt: "A service crew — everyone on the team, on one shared number.",
  },
  {
    key: "team-live",
    slug: "real-time-collaboration_bchs",
    alt: "A crew replying together in real time from wherever they are.",
  },
  {
    key: "canada",
    slug: "location-search_9mdg",
    alt: "Finding a local number on a map — coverage across Canada and the US.",
  },
  {
    key: "compliance-handled",
    slug: "all-checked_d3u6",
    alt: "The texting rules, handled — registration and opt-outs taken care of for you.",
  },
  {
    key: "bring-your-number",
    slug: "nfc-sharing_tt2d",
    alt: "Forwarding your existing business number to your new JobText number.",
  },
  {
    key: "missed-lead",
    slug: "business-call_w1gr",
    alt: "A customer trying to reach a business — the lead you can't afford to miss.",
  },
  {
    key: "texting",
    slug: "messages_okui",
    alt: "Texting a business from a phone.",
  },
  {
    key: "welcome",
    slug: "welcome-aboard_y4e9",
    alt: "Getting set up and welcomed aboard in minutes.",
  },
  {
    key: "data-safe",
    slug: "security-on_3ykb",
    alt: "Your data kept secure — encrypted, never sold.",
  },
];

/**
 * Recolor map (one art-director grade). Left = the unDraw source color, right =
 * the JobText-brand replacement. Matching is case-insensitive on hex. Order
 * matters: longer/darker inks first so we don't partially rewrite.
 *
 * Petrol accent + warm-stone inks; skin tones + light grays are intentionally
 * NOT in the map (preserved) so the people stay human and warm.
 */
const RECOLOR = [
  // The single recolorable brand accent → petrol (--primary #0F766E).
  ["#6c63ff", "#0f766e"],
  // Cold blue-black "ink" tones → warm stone ink, darkest → lightest.
  ["#090814", "#1c1917"], // near-black → stone-950-ish
  ["#2f2e41", "#292524"], // dark → stone-800
  ["#3f3d56", "#44403c"], // mid dark → stone-700 (warm)
  ["#423a59", "#57534e"], // muted purple-gray → stone-600
  ["#3a3768", "#0f766e"], // a deep accent-shadow → petrol (keeps accent cohesion)
  ["#d0cde1", "#e7e5e4"], // pale lilac → stone-200 (warm neutral)
  ["#d6d6e3", "#e7e5e4"], // pale lilac → stone-200
  ["#e6e8ec", "#f5f5f4"], // cool off-white → warm stone-100
];

function optimizeSvg(raw) {
  let svg = raw;
  // Drop XML prolog / DOCTYPE / comments (unDraw ships a bare <svg>, but be safe).
  svg = svg.replace(/<\?xml[\s\S]*?\?>/gi, "");
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  // Apply the brand recolor (case-insensitive on the hex).
  for (const [from, to] of RECOLOR) {
    svg = svg.replace(new RegExp(from, "gi"), to);
  }
  // Strip any fixed width/height on the root <svg> so it scales to its box
  // (viewBox drives aspect ratio; the manifest carries intrinsic w/h). Only the
  // FIRST <svg> tag is touched.
  svg = svg.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
    const cleaned = attrs
      .replace(/\s(width|height)="[^"]*"/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return `<svg ${cleaned}>`;
  });
  // Collapse inter-tag whitespace.
  svg = svg.replace(/>\s+</g, "><").trim();
  return svg;
}

function parseViewBox(svg) {
  const m = svg.match(/viewBox="([^"]+)"/i);
  if (!m) throw new Error("no viewBox");
  const [, , w, h] = m[1].split(/[\s,]+/).map(Number);
  return { viewBox: m[1], w: Math.round(w), h: Math.round(h) };
}

if (!existsSync(srcDir)) {
  console.error(`Missing source dir: ${srcDir}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const available = new Set(
  readdirSync(srcDir).filter((f) => f.endsWith(".svg")),
);
const entries = [];

for (const scene of SCENES) {
  const file = `${scene.slug}.svg`;
  if (!available.has(file)) {
    console.error(`Missing source SVG for "${scene.key}": ${file}`);
    process.exit(1);
  }
  const raw = readFileSync(join(srcDir, file), "utf8");
  const svg = optimizeSvg(raw);
  const { viewBox, w, h } = parseViewBox(svg);
  writeFileSync(join(outDir, `${scene.key}.svg`), svg, "utf8");
  entries.push({ ...scene, viewBox, w, h, bytes: Buffer.byteLength(svg) });
  console.log(
    `${scene.key}.svg  ${viewBox}  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KiB`,
  );
}

// ---- emit manifest.ts -------------------------------------------------------
const manifest = `// AUTOGENERATED by apps/web/scripts/build-illustrations.mjs — do not edit by hand.
//
// The JobText marketing illustration set (VISUALS-V2 §3). ONE cohesive library —
// unDraw (undraw.co), MIT-clean license (free commercial use, no attribution
// required, recoloring permitted). Every scene is recolored to the JobText brand
// (petrol accent + warm-stone inks) by the build script, so the whole set reads
// as one art-directed system. Source slugs + license are recorded in
// public/illustrations/CREDITS.md.
//
// Each entry is a branded, optimized inline SVG under /public/illustrations/,
// with its viewBox + intrinsic width/height (for aspect-ratio boxes → zero CLS).
// Render through <Illustration id="..."/> (components/marketing/illustration.tsx).

export type Illustration = {
  /** Path under /public — the branded, optimized SVG. */
  readonly src: string;
  /** SVG viewBox — drives the aspect ratio of the reserved box (zero CLS). */
  readonly viewBox: string;
  /** Intrinsic width in the illustration's own units. */
  readonly w: number;
  /** Intrinsic height in the illustration's own units. */
  readonly h: number;
  /** Honest alt text describing the scene. */
  readonly alt: string;
  /** Source library + slug, for the credits record. */
  readonly credit: string;
};

export const illustrations = {
${entries
  .map(
    (e) => `  ${JSON.stringify(e.key)}: {
    src: "/illustrations/${e.key}.svg",
    viewBox: ${JSON.stringify(e.viewBox)},
    w: ${e.w},
    h: ${e.h},
    alt: ${JSON.stringify(e.alt)},
    credit: "unDraw · ${e.slug} · MIT (undraw.co/license)",
  },`,
  )
  .join("\n")}
} as const satisfies Record<string, Illustration>;

export type IllustrationId = keyof typeof illustrations;

/** Resolve one illustration by id, or undefined if the key is unknown. */
export function getIllustration(id: string): Illustration | undefined {
  return (illustrations as Record<string, Illustration>)[id];
}
`;

writeFileSync(join(outDir, "manifest.ts"), manifest, "utf8");
console.log(`\nWrote ${entries.length} illustrations + manifest.ts to ${outDir}`);
