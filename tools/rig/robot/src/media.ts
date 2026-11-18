/**
 * The robot's picture message for S22: an 8x8 grey JPEG carrying a GPS
 * position in its EXIF, built here so no image file is committed. The app
 * must strip the position before it stores the picture; `hasGpsExif` is how
 * the scenario checks it did.
 *
 * The image is the smallest baseline JPEG a decoder accepts: one 8x8 block
 * whose coefficients are all zero, with Huffman tables of one code each.
 */
import { createHash } from "node:crypto";

const u16 = (n: number) => [(n >> 8) & 0xFF, n & 0xFF];
const u16le = (n: number) => [n & 0xFF, (n >> 8) & 0xFF];
const u32le = (n: number) => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF];

function segment(marker: number, body: number[]): number[] {
  return [0xFF, marker, ...u16(body.length + 2), ...body];
}

/** EXIF with only a GPS IFD: 43.65 N, the position the app must not keep. */
function exifWithGps(): number[] {
  const tiff: number[] = [0x49, 0x49, 0x2A, 0x00, ...u32le(8)];
  // IFD0 at 8: one entry, GPSInfo (0x8825), LONG, pointing at the GPS IFD.
  const gpsIfdAt = 8 + 2 + 12 + 4;
  tiff.push(...u16le(1), ...u16le(0x88_25), ...u16le(4), ...u32le(1), ...u32le(gpsIfdAt), ...u32le(0));
  // GPS IFD: GPSLatitudeRef "N", GPSLatitude as three RATIONALs stored after it.
  const latitudeAt = gpsIfdAt + 2 + 2 * 12 + 4;
  tiff.push(...u16le(2), ...u16le(0x00_01), ...u16le(2), ...u32le(2), 0x4E, 0x00, 0x00, 0x00);
  tiff.push(...u16le(0x00_02), ...u16le(5), ...u32le(3), ...u32le(latitudeAt), ...u32le(0));
  for (const [numerator, denominator] of [
    [43, 1],
    [39, 1],
    [0, 1],
  ]) {
    tiff.push(...u32le(numerator!), ...u32le(denominator!));
  }
  return [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
}

export function gpsJpeg(): Uint8Array<ArrayBuffer> {
  const bytes = [
    0xFF, 0xD8,
    ...segment(0xE1, exifWithGps()),
    ...segment(0xDB, [0x00, ...Array.from({ length: 64 }, () => 1)]),
    ...segment(0xC0, [8, ...u16(8), ...u16(8), 1, 1, 0x11, 0]),
    // DC table 0 and AC table 0, each a single one-bit code: category 0, and end of block.
    ...segment(0xC4, [0x00, 1, ...Array.from({ length: 15 }, () => 0), 0x00]),
    ...segment(0xC4, [0x10, 1, ...Array.from({ length: 15 }, () => 0), 0x00]),
    ...segment(0xDA, [1, 1, 0x00, 0, 63, 0]),
    // "0" for the DC difference, "0" for end of block, padded with ones.
    0x3F,
    0xFF, 0xD9,
  ];
  return Uint8Array.from(bytes);
}

/** Whether a JPEG still carries an EXIF block that points at GPS data. */
export function hasGpsExif(jpeg: Uint8Array): boolean {
  const bytes = Buffer.from(jpeg);
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return false;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xFF) {
    const marker = bytes[at + 1]!;
    if (marker === 0xDA || marker === 0xD9) return false;
    const length = bytes.readUInt16BE(at + 2);
    const body = bytes.subarray(at + 4, at + 2 + length);
    if (marker === 0xE1 && body.subarray(0, 6).toString("latin1") === "Exif\0\0" && tiffHasGps(body.subarray(6))) return true;
    at += 2 + length;
  }
  return false;
}

function tiffHasGps(tiff: Buffer): boolean {
  if (tiff.length < 8) return false;
  const little = tiff.toString("latin1", 0, 2) === "II";
  const read16 = (offset: number) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const read32 = (offset: number) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  const ifd = read32(4);
  if (ifd + 2 > tiff.length) return false;
  const entries = read16(ifd);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return false;
    if (read16(entry) === 0x88_25) return true;
  }
  return false;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
