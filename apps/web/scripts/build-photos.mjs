/**
 * build-photos.mjs — turn the curated Unsplash source photos
 * (scripts/photos-src/) into optimized, art-directed marketing imagery under
 * public/img/, and (re)generate the manifest public/img/manifest.ts the rework
 * consumes. Mirrors the capture-shots.mjs pipeline (same WebP/AVIF quality and
 * blur-up convention) so the two raster pipelines stay consistent.
 *
 * WHY real photography (VISUALS-V2 §2): warm, authentic tradespeople / service-
 * business photos replace the hand-made CSS/SVG "art." All are Unsplash,
 * photographer-contributed (the FREE license — no Unsplash+/Getty in the set),
 * free for commercial use, no attribution required; sources recorded in
 * public/img/CREDITS.md.
 *
 * WHAT this does (reproducible, like capture-shots.mjs):
 *   1. GRADE — one art-director pass over the WHOLE set so it reads curated by
 *      one hand (VISUALS-V2 §2 "consistent color/warmth grade"): a gentle warm
 *      tint + slight saturation lift + a touch of brightness normalization pulls
 *      the cool/cyan-lit shots (under-sink plumbing, the rooftop crew) toward the
 *      warm morning-light temperature of the rest. Not corporate-cheese; warm.
 *   2. CROP to a consistent 4:3 landscape with sharp's attention crop (keeps the
 *      subject) so the set shares one silhouette.
 *   3. EMIT two widths per photo (1200 primary + 600 small) as WebP + AVIF at the
 *      exact display size (width/height in the manifest → zero CLS), plus a 20px
 *      blur-up placeholder data-URI.
 *   4. WRITE public/img/manifest.ts: key → { webp, avif, srcset, w, h, blur, alt,
 *      credit } — the typed API the rebuild renders through <Photo/>.
 *
 * Run:  node apps/web/scripts/build-photos.mjs
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const srcDir = join(webRoot, "scripts", "photos-src");
const outDir = join(webRoot, "public", "img");

const { default: sharp } = await import("sharp");

/** The two display widths every photo is emitted at (primary + small). */
const WIDTHS = [1200, 600];
/** Consistent 4:3 landscape aspect for the whole set (one silhouette). */
const ASPECT = 4 / 3;

/**
 * The curated set (VISUALS-V2 §2). key → source filename, honest alt, credit,
 * and the Unsplash page URL. Every photographer here is a free-license Unsplash
 * contributor (no Unsplash+/Getty). The build applies the SAME warm grade to all
 * so they feel like one shoot.
 */
const PHOTOS = [
  {
    key: "plumber-pipe",
    file: "plumber-pipe.jpg",
    alt: "A plumber working on the pipes under a sink.",
    photographer: "Timur Shakerzianov",
    url: "https://unsplash.com/photos/c314Gh8dXAo",
  },
  {
    key: "plumber-heater",
    file: "plumber-heater.jpg",
    alt: "A tradesperson servicing a water heater on a job.",
    photographer: "Timur Shakerzianov",
    url: "https://unsplash.com/photos/kxuz4YrLxSc",
  },
  {
    key: "tools-wall",
    file: "tools-wall.jpg",
    alt: "A tradesperson holding a tool in front of a wall of tools.",
    photographer: "Anton Savinov",
    url: "https://unsplash.com/photos/Cx5Lk7Rv-vE",
  },
  {
    key: "landscaper-shovel",
    file: "landscaper-shovel.jpg",
    alt: "A landscaper digging in a yard with a shovel.",
    photographer: "Jared Muller",
    url: "https://unsplash.com/photos/EkhWxU_pgLo",
  },
  {
    key: "landscaper-mower",
    file: "landscaper-mower.jpg",
    alt: "A lawn-care crew mowing a green lawn.",
    photographer: "Michael Smith",
    url: "https://unsplash.com/photos/bsld7GjQwjI",
  },
  {
    key: "gardener-hands",
    file: "gardener-hands.jpg",
    alt: "Gloved hands planting a seedling in soil.",
    photographer: "Jonathan Kemper",
    url: "https://unsplash.com/photos/CbZh3kaPxrE",
  },
  {
    key: "salon-stylist",
    file: "salon-stylist.jpg",
    alt: "A salon stylist drying a client's hair.",
    photographer: "Adam Winger",
    url: "https://unsplash.com/photos/FkAZqQJTbXM",
  },
  {
    key: "salon-cut",
    file: "salon-cut.jpg",
    alt: "A hairstylist cutting a client's hair with scissors.",
    photographer: "Ionela Mat",
    url: "https://unsplash.com/photos/lps3FolQ6Ro",
  },
  {
    key: "texting-hands",
    file: "texting-hands.jpg",
    alt: "Close-up of hands texting on a smartphone.",
    photographer: "Darya Ezerskaya",
    url: "https://unsplash.com/photos/hgz7pZkQoQc",
  },
  {
    key: "phone-in-hand",
    file: "phone-in-hand.jpg",
    alt: "A person reading a text on their smartphone.",
    photographer: "Priscilla Du Preez",
    url: "https://unsplash.com/photos/BjhUu6BpUZA",
  },
  {
    key: "owner-apron-phone",
    file: "owner-apron-phone.jpg",
    alt: "A shop owner in an apron checking a text on his phone at the counter.",
    photographer: "Ali Mkumbwa",
    url: "https://unsplash.com/photos/uk3ey_vhDKA",
  },
  {
    key: "owner-counter-phone",
    file: "owner-counter-phone.jpg",
    alt: "A small-business owner texting a customer from behind the counter.",
    photographer: "Omar Lopez",
    url: "https://unsplash.com/photos/iuBoZIZQkKM",
  },
  {
    key: "hvac-tech",
    file: "hvac-tech.jpg",
    alt: "A service technician in a hard hat wiring an electrical panel.",
    photographer: "Emmanuel Ikwuegbu",
    url: "https://unsplash.com/photos/-0-kl1BjvFc",
  },
  {
    key: "crew-rooftop",
    file: "crew-rooftop.jpg",
    alt: "A two-person crew working together on a rooftop HVAC install.",
    photographer: "Singapore Stock Photos",
    url: "https://unsplash.com/photos/iS5GDeLDk0E",
  },
];

/**
 * The one art-director grade, applied to EVERY photo so the set reads as one
 * shoot (VISUALS-V2 §2). A gentle WARM WHITE-BALANCE shift that KEEPS full color
 * (NOT sharp's `.tint()`, which duotones the image): lift the red channel a hair,
 * pull the blue channel down a hair, plus a small saturation/brightness normalize.
 * This nudges the cyan-lit under-sink plumbing shots and the cool rooftop toward
 * the warm morning-light temperature of the rest, without going sepia. Subtle —
 * authentic, not Instagram-filtered.
 */
function grade(pipeline) {
  return pipeline
    .modulate({ saturation: 1.05, brightness: 1.02 })
    .linear([1.045, 1.0, 0.955], [0, 0, 0]); // per-channel: warm R, neutral G, cool-down B
}

if (!existsSync(srcDir)) {
  console.error(`Missing source dir: ${srcDir}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const available = new Set(readdirSync(srcDir).filter((f) => f.endsWith(".jpg")));
const entries = [];

for (const photo of PHOTOS) {
  if (!available.has(photo.file)) {
    console.error(`Missing source photo for "${photo.key}": ${photo.file}`);
    process.exit(1);
  }
  const inPath = join(srcDir, photo.file);

  const variants = [];
  for (const w of WIDTHS) {
    const h = Math.round(w / ASPECT);
    const base = `${photo.key}-${w}`;
    const cropped = grade(
      sharp(inPath).resize(w, h, { fit: "cover", position: sharp.strategy.attention }),
    );
    await cropped.clone().webp({ quality: 82, effort: 5 }).toFile(join(outDir, `${base}.webp`));
    await cropped.clone().avif({ quality: 62, effort: 5 }).toFile(join(outDir, `${base}.avif`));
    variants.push({ w, h, base });
  }

  // Primary = the first (largest) variant; carry its intrinsic w/h in the manifest.
  const primary = variants[0];

  // 20px blur-up placeholder (base64 WebP data-URI), same grade so it matches.
  const blurH = Math.max(1, Math.round(20 / ASPECT));
  const blurBuf = await grade(
    sharp(inPath).resize(20, blurH, { fit: "cover", position: sharp.strategy.attention }),
  )
    .webp({ quality: 40 })
    .toBuffer();
  const blur = `data:image/webp;base64,${blurBuf.toString("base64")}`;

  entries.push({ ...photo, variants, primary, blur });
  console.log(`${photo.key}: ${primary.w}x${primary.h} (+${WIDTHS[1]}w) webp+avif`);
}

// ---- emit manifest.ts -------------------------------------------------------
const manifest = `// AUTOGENERATED by apps/web/scripts/build-photos.mjs — do not edit by hand.
//
// The JobText marketing photography set (VISUALS-V2 §2). Warm, authentic
// tradespeople / service-business photos from Unsplash (photographer-contributed,
// the FREE license — free commercial use, no attribution required). One
// art-director warm grade is applied to the whole set by the build script so it
// reads as one shoot. Sources + photographers are recorded in
// public/img/CREDITS.md. To reproduce: node apps/web/scripts/build-photos.mjs.
//
// Each entry is pre-sized WebP + AVIF at two display widths (primary + small),
// with intrinsic width/height (zero CLS) and a tiny blur-up placeholder.
// Render through <Photo id="..."/> (components/marketing/photo.tsx).

export type Photo = {
  /** Primary WebP path under /public (the ${WIDTHS[0]}px-wide variant). */
  readonly webp: string;
  /** Primary AVIF path under /public (same display size). */
  readonly avif: string;
  /** WebP srcset string across the emitted widths (small + primary). */
  readonly srcsetWebp: string;
  /** AVIF srcset string across the emitted widths. */
  readonly srcsetAvif: string;
  /** Intrinsic width of the primary variant (CSS px). */
  readonly w: number;
  /** Intrinsic height of the primary variant (CSS px). */
  readonly h: number;
  /** Blurred low-res placeholder as a base64 WebP data-URI (blur-up). */
  readonly blur: string;
  /** Honest alt text describing the photo. */
  readonly alt: string;
  /** Photographer + source, for the credits record. */
  readonly credit: string;
};

export const photos = {
${entries
  .map((e) => {
    const srcsetWebp = e.variants
      .slice()
      .sort((a, b) => a.w - b.w)
      .map((v) => `/img/${v.base}.webp ${v.w}w`)
      .join(", ");
    const srcsetAvif = e.variants
      .slice()
      .sort((a, b) => a.w - b.w)
      .map((v) => `/img/${v.base}.avif ${v.w}w`)
      .join(", ");
    return `  ${JSON.stringify(e.key)}: {
    webp: "/img/${e.primary.base}.webp",
    avif: "/img/${e.primary.base}.avif",
    srcsetWebp: ${JSON.stringify(srcsetWebp)},
    srcsetAvif: ${JSON.stringify(srcsetAvif)},
    w: ${e.primary.w},
    h: ${e.primary.h},
    blur: ${JSON.stringify(e.blur)},
    alt: ${JSON.stringify(e.alt)},
    credit: ${JSON.stringify(`Photo by ${e.photographer} on Unsplash (${e.url})`)},
  },`;
  })
  .join("\n")}
} as const satisfies Record<string, Photo>;

export type PhotoId = keyof typeof photos;

/** Resolve one photo by id, or undefined if the key is unknown. */
export function getPhoto(id: string): Photo | undefined {
  return (photos as Record<string, Photo>)[id];
}
`;

writeFileSync(join(outDir, "manifest.ts"), manifest, "utf8");
console.log(`\nWrote ${entries.length} photos (×2 widths, webp+avif) + manifest.ts to ${outDir}`);
