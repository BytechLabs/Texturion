/**
 * Renders the committed PWA raster icons from the crafted SVG sources
 * (DESIGN.md G9). Deterministic — pure vector shapes, no text elements, so
 * output never depends on installed fonts. Run from apps/web after touching
 * either SVG source:
 *
 *   node scripts/generate-icons.mjs
 *
 * Inputs (committed, hand-crafted):
 *   public/icons/loonext-icon.svg   the loon tile (rounded, id="tile")
 *   public/favicon.svg              loon favicon
 *   public/favicon-unread.svg       loon favicon + unread badge
 *
 * Outputs (committed alongside):
 *   public/icons/icon-192.png, icon-512.png           manifest `purpose: any`
 *   public/icons/icon-maskable-192.png, -512.png      manifest `purpose:
 *     maskable` — same artwork with the tile's corner radius flattened to
 *     full bleed (the glyph already sits inside the 80% safe circle)
 *   public/apple-touch-icon.png (180×180)              iOS home screen
 *     (full-bleed: iOS applies its own corner mask; transparency turns black)
 *   public/icons/badge-72.png                          Android notification
 *     badge (white glyph silhouette on transparency — the OS tints it)
 *   public/favicon.ico                                 16/32/48 fallback for
 *     browsers that ignore SVG favicons (PNG-compressed ICO entries)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(webRoot, "public");
const iconsDir = path.join(publicDir, "icons");

/** Rasterize an SVG buffer to a square PNG of the given edge length. */
function renderPng(svg, size) {
  return sharp(svg, { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Pack PNG buffers into a .ico container (ICONDIR + ICONDIRENTRY table +
 * raw PNG payloads). PNG-compressed entries are valid ICO members and are
 * what every current browser reads; no dependency needed.
 */
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const table = [];
  const blobs = [];
  let offset = 6 + entries.length * 16;
  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette size
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    table.push(entry);
    blobs.push(png);
  }
  return Buffer.concat([header, ...table, ...blobs]);
}

async function main() {
  await mkdir(iconsDir, { recursive: true });

  const tileSvg = await readFile(path.join(iconsDir, "loonext-icon.svg"));
  // Maskable variant: flatten the tile's corner radius to full bleed. The
  // source rect is tagged id="tile" with rx/ry 116 — keep this replacement in
  // sync with the SVG if the radius ever changes.
  const maskableSvg = Buffer.from(
    tileSvg.toString("utf8").replace('rx="116" ry="116"', 'rx="0" ry="0"'),
  );
  if (maskableSvg.equals(tileSvg)) {
    throw new Error(
      'loonext-icon.svg lost its rx="116" ry="116" tile — update the maskable replacement.',
    );
  }

  // Badge silhouette: the same glyph without the tile (notification badges
  // are monochrome masks — Android tints the opaque pixels).
  const badgeSvg = Buffer.from(
    tileSvg.toString("utf8").replace(/<rect id="tile"[^>]*\/>/, ""),
  );
  if (badgeSvg.equals(tileSvg)) {
    throw new Error(
      'loonext-icon.svg lost its <rect id="tile"…/> — update the badge strip.',
    );
  }

  const outputs = [
    [path.join(iconsDir, "icon-192.png"), await renderPng(tileSvg, 192)],
    [path.join(iconsDir, "icon-512.png"), await renderPng(tileSvg, 512)],
    [
      path.join(iconsDir, "icon-maskable-192.png"),
      await renderPng(maskableSvg, 192),
    ],
    [
      path.join(iconsDir, "icon-maskable-512.png"),
      await renderPng(maskableSvg, 512),
    ],
    [
      path.join(publicDir, "apple-touch-icon.png"),
      await renderPng(maskableSvg, 180),
    ],
    [path.join(iconsDir, "badge-72.png"), await renderPng(badgeSvg, 72)],
  ];

  const faviconSvg = await readFile(path.join(publicDir, "favicon.svg"));
  const icoSizes = [16, 32, 48];
  const icoEntries = [];
  for (const size of icoSizes) {
    icoEntries.push({ size, png: await renderPng(faviconSvg, size) });
  }
  outputs.push([path.join(publicDir, "favicon.ico"), packIco(icoEntries)]);

  for (const [file, buffer] of outputs) {
    await writeFile(file, buffer);
    console.log(
      `wrote ${path.relative(webRoot, file)} (${buffer.length} bytes)`,
    );
  }
}

await main();
