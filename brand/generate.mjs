/**
 * Brand raster generator (#206). One command regenerates every raster the
 * platforms need from the SVG sources in this directory:
 *
 *   node brand/generate.mjs        (from the repo root)
 *
 * Outputs:
 *   apps/web/public/favicon.ico            16+32+48 PNG-in-ICO
 *   apps/web/public/apple-touch-icon.png   180
 *   apps/web/public/icons/icon-192.png     tile
 *   apps/web/public/icons/icon-512.png     tile
 *   apps/web/public/icons/icon-maskable-192.png
 *   apps/web/public/icons/icon-maskable-512.png
 *   apps/web/public/icons/badge-72.png     white mark on transparent (push badge)
 *   apps/web/public/og/loonext-og-default.png  1200x630 dark og card
 *   brand/out/icon-1024.png                iOS AppIcon source (no alpha)
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
/** pnpm keeps no root `sharp` link - resolve through the virtual store. */
function loadSharp(root) {
  try {
    return require("sharp");
  } catch {
    const store = join(root, "node_modules", ".pnpm");
    const entry = readdirSync(store).find((d) => d.startsWith("sharp@"));
    if (!entry) throw new Error("sharp not found in the pnpm store");
    return require(join(store, entry, "node_modules", "sharp"));
  }
}

const brandDir = dirname(fileURLToPath(import.meta.url));
const root = join(brandDir, "..");
const sharp = loadSharp(root);
const pub = join(root, "apps", "web", "public");

const tile = readFileSync(join(brandDir, "loonext-tile.svg"));
const maskable = readFileSync(join(brandDir, "loonext-maskable.svg"));

/** Render an SVG buffer at a square size. */
const png = (svg, size) => sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();

/** Multi-image PNG-in-ICO container (valid in every modern browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

/** The mark recolored to a single color (push badge wants flat white). */
const monoMark = (color) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <circle cx="136" cy="256" r="86" fill="none" stroke="${color}" stroke-width="52"/>
    <circle cx="376" cy="256" r="86" fill="none" stroke="${color}" stroke-width="52"/>
  </svg>`,
);

/** 1200x630 og card: ink base, the rings, the wordmark with the lime O. */
const ogSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#191B14"/>
    <circle cx="435" cy="240" r="56" fill="none" stroke="#F0F1E5" stroke-width="34"/>
    <circle cx="591" cy="240" r="56" fill="none" stroke="#B9CF57" stroke-width="34"/>
    <text x="600" y="435" text-anchor="middle" font-family="Golos Text, sans-serif"
      font-size="104" font-weight="600" fill="#F0F1E5">L<tspan fill="#F0F1E5">o</tspan><tspan fill="#B9CF57">o</tspan>next</text>
    <text x="600" y="520" text-anchor="middle" font-family="Golos Text, sans-serif"
      font-size="34" fill="#9AA08B">Your number. One inbox. The whole crew.</text>
  </svg>`,
);

async function main() {
  // fontconfig reads FONTCONFIG_FILE when sharp's native lib initializes -
  // setting it after import is too late. Re-exec once with it in place so
  // plain `node brand/generate.mjs` renders the wordmark in Golos.
  if (process.env.FONTCONFIG_FILE !== join(brandDir, "fonts.conf")) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, FONTCONFIG_FILE: join(brandDir, "fonts.conf") },
      stdio: "inherit",
    });
    process.exit(r.status ?? 1);
  }
  mkdirSync(join(brandDir, "out"), { recursive: true });
  mkdirSync(join(pub, "icons"), { recursive: true });
  mkdirSync(join(pub, "og"), { recursive: true });

  writeFileSync(
    join(pub, "favicon.ico"),
    ico(await Promise.all([16, 32, 48].map(async (s) => ({ size: s, data: await png(tile, s) })))),
  );
  writeFileSync(join(pub, "apple-touch-icon.png"), await png(tile, 180));
  writeFileSync(join(pub, "icons", "icon-192.png"), await png(tile, 192));
  writeFileSync(join(pub, "icons", "icon-512.png"), await png(tile, 512));
  writeFileSync(join(pub, "icons", "icon-maskable-192.png"), await png(maskable, 192));
  writeFileSync(join(pub, "icons", "icon-maskable-512.png"), await png(maskable, 512));
  writeFileSync(join(pub, "icons", "badge-72.png"), await png(monoMark("#FFFFFF"), 72));

  // og render: fontconfig (see main's env line) resolves Golos Text from the
  // Android res/font dir via brand/fonts.conf, keeping the wordmark on-brand.
  const og = sharp(ogSvg, { density: 150 });
  writeFileSync(join(pub, "og", "loonext-og-default.png"), await og.png().toBuffer());

  // iOS wants a flat, no-alpha 1024 source.
  writeFileSync(
    join(brandDir, "out", "icon-1024.png"),
    await sharp(await png(tile, 1024)).flatten({ background: "#FDFDF9" }).png().toBuffer(),
  );

  console.log("brand rasters written");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
