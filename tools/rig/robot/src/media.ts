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

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

function segment(marker: number, body: number[]): number[] {
  return [0xff, marker, ...u16(body.length + 2), ...body];
}

/** EXIF with only a GPS IFD: 43.65 N, the position the app must not keep. */
function exifWithGps(): number[] {
  const tiff: number[] = [0x49, 0x49, 0x2a, 0x00, ...u32le(8)];
  // IFD0 at 8: one entry, GPSInfo (0x8825), LONG, pointing at the GPS IFD.
  const gpsIfdAt = 8 + 2 + 12 + 4;
  tiff.push(...u16le(1), ...u16le(0x8825), ...u16le(4), ...u32le(1), ...u32le(gpsIfdAt), ...u32le(0));
  // GPS IFD: GPSLatitudeRef "N", GPSLatitude as three RATIONALs stored after it.
  const latitudeAt = gpsIfdAt + 2 + 2 * 12 + 4;
  tiff.push(...u16le(2));
  tiff.push(...u16le(0x0001), ...u16le(2), ...u32le(2), 0x4e, 0x00, 0x00, 0x00);
  tiff.push(...u16le(0x0002), ...u16le(5), ...u32le(3), ...u32le(latitudeAt));
  tiff.push(...u32le(0));
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
    0xff, 0xd8,
    ...segment(0xe1, exifWithGps()),
    ...segment(0xdb, [0x00, ...new Array<number>(64).fill(1)]),
    ...segment(0xc0, [8, ...u16(8), ...u16(8), 1, 1, 0x11, 0]),
    // DC table 0 and AC table 0, each a single one-bit code: category 0, and end of block.
    ...segment(0xc4, [0x00, 1, ...new Array<number>(15).fill(0), 0x00]),
    ...segment(0xc4, [0x10, 1, ...new Array<number>(15).fill(0), 0x00]),
    ...segment(0xda, [1, 1, 0x00, 0, 63, 0]),
    // "0" for the DC difference, "0" for end of block, padded with ones.
    0x3f,
    0xff, 0xd9,
  ];
  return Uint8Array.from(bytes);
}

/** Whether a JPEG still carries an EXIF block that points at GPS data. */
export function hasGpsExif(jpeg: Uint8Array): boolean {
  const bytes = Buffer.from(jpeg);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    if (marker === 0xda || marker === 0xd9) return false;
    const length = bytes.readUInt16BE(at + 2);
    const body = bytes.subarray(at + 4, at + 2 + length);
    if (marker === 0xe1 && body.subarray(0, 6).toString("latin1") === "Exif\0\0" && tiffHasGps(body.subarray(6))) return true;
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
    if (read16(entry) === 0x8825) return true;
  }
  return false;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
