import { describe, expect, it } from "vitest";

import { stripImageLocation } from "./location";

/**
 * #294 / D128 — the coordinates of a customer's home do not enter the bucket.
 *
 * These build real Exif structures rather than asserting on a fixture blob, because
 * the thing under test is a byte-level rewrite of a customer's photo. Two properties
 * matter more than any of the others and are asserted everywhere:
 *
 *   1. The latitude bytes are GONE — not orphaned, not unreferenced. Zeroed.
 *   2. The file is the same length and still parses. A corrupted job photo is a
 *      worse outcome than the problem being fixed.
 */

const ORIENTATION = 0x0112;
const GPS_POINTER = 0x8825;
const GPS_LATITUDE = 0x0002;
/** A pattern that cannot occur by accident, so "zeroed" is unambiguous. */
const LAT_FILL = 0xab;

/**
 * A TIFF block: IFD0 carrying Orientation and a GPS pointer, and a GPS directory
 * whose latitude is three RATIONALs held out of line (as every real one is — 24
 * bytes cannot fit in a 4-byte entry).
 */
function tiffWithGps(options: { little?: boolean } = {}): {
  bytes: Uint8Array;
  latAt: number;
  latLength: number;
} {
  const little = options.little ?? true;
  // 0 header(8) | 8 IFD0(2 + 2*12 + 4 = 30) → 38 | 38 GPS IFD(2 + 12 + 4 = 18) → 56
  // | 56 latitude(24) → 80
  const gpsAt = 38;
  const latAt = 56;
  const latLength = 24;
  const total = 80;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const u16 = (at: number, value: number) => view.setUint16(at, value, little);
  const u32 = (at: number, value: number) => view.setUint32(at, value, little);

  bytes[0] = little ? 0x49 : 0x4d;
  bytes[1] = little ? 0x49 : 0x4d;
  u16(2, 42);
  u32(4, 8);

  u16(8, 2); // two entries in IFD0
  // Orientation = 6 (rotate 90 CW), stored inline.
  u16(10, ORIENTATION);
  u16(12, 3); // SHORT
  u32(14, 1);
  u16(18, 6);
  // GPS pointer.
  u16(22, GPS_POINTER);
  u16(24, 4); // LONG
  u32(26, 1);
  u32(30, gpsAt);
  u32(34, 0); // no next IFD

  u16(gpsAt, 1); // one entry in the GPS directory
  u16(gpsAt + 2, GPS_LATITUDE);
  u16(gpsAt + 4, 5); // RATIONAL
  u32(gpsAt + 6, 3);
  u32(gpsAt + 10, latAt);
  u32(gpsAt + 14, 0); // no next IFD

  bytes.fill(LAT_FILL, latAt, latAt + latLength);
  return { bytes, latAt, latLength };
}

/** Wrap a TIFF block in a JPEG APP1 Exif segment. */
function jpeg(tiff: Uint8Array): { bytes: Uint8Array; tiffAt: number } {
  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const length = 2 + header.length + tiff.length;
  const bytes = new Uint8Array(2 + 2 + 2 + header.length + tiff.length + 2);
  let at = 0;
  bytes[at++] = 0xff;
  bytes[at++] = 0xd8; // SOI
  bytes[at++] = 0xff;
  bytes[at++] = 0xe1; // APP1
  bytes[at++] = (length >> 8) & 0xff;
  bytes[at++] = length & 0xff;
  for (const byte of header) bytes[at++] = byte;
  const tiffAt = at;
  bytes.set(tiff, at);
  at += tiff.length;
  bytes[at++] = 0xff;
  bytes[at++] = 0xd9; // EOI
  return { bytes, tiffAt };
}

/** Wrap a TIFF block in a PNG `eXIf` chunk. */
function png(tiff: Uint8Array): { bytes: Uint8Array; tiffAt: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const bytes = new Uint8Array(signature.length + 8 + tiff.length + 4 + 12);
  bytes.set(signature, 0);
  const view = new DataView(bytes.buffer);
  let at = signature.length;
  view.setUint32(at, tiff.length);
  bytes.set([0x65, 0x58, 0x49, 0x66], at + 4); // eXIf
  const tiffAt = at + 8;
  bytes.set(tiff, tiffAt);
  at = tiffAt + tiff.length + 4; // + CRC
  view.setUint32(at, 0);
  bytes.set([0x49, 0x45, 0x4e, 0x44], at + 4); // IEND
  return { bytes, tiffAt };
}

/** Wrap a TIFF block in a WebP RIFF `EXIF` chunk. */
function webp(tiff: Uint8Array): { bytes: Uint8Array; tiffAt: number } {
  const size = 4 + 8 + tiff.length + (tiff.length % 2);
  const bytes = new Uint8Array(8 + size);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, size, true);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x45, 0x58, 0x49, 0x46], 12); // EXIF
  view.setUint32(16, tiff.length, true);
  const tiffAt = 20;
  bytes.set(tiff, tiffAt);
  return { bytes, tiffAt };
}

/** An ISO-BMFF-ish container with the Exif payload where a HEIC keeps it. */
function heic(tiff: Uint8Array): { bytes: Uint8Array; tiffAt: number } {
  const preamble = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // ftyp box
    0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
    0x68, 0x65, 0x69, 0x63, 0x6d, 0x69, 0x66, 0x31,
    0x00, 0x00, 0x00, 0x06, // the Exif item's TIFF-header offset field
  ]);
  const bytes = new Uint8Array(preamble.length + tiff.length);
  bytes.set(preamble, 0);
  bytes.set(tiff, preamble.length);
  return { bytes, tiffAt: preamble.length };
}

function isZeroed(bytes: Uint8Array, from: number, length: number): boolean {
  for (let i = from; i < from + length; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

describe("the latitude is destroyed, in every container we accept (#294)", () => {
  const containers: [string, string, (t: Uint8Array) => { bytes: Uint8Array; tiffAt: number }][] = [
    ["image/jpeg", "JPEG APP1", jpeg],
    ["image/png", "PNG eXIf", png],
    ["image/webp", "WebP RIFF", webp],
    ["image/heic", "HEIC item", heic],
  ];

  for (const [contentType, name, wrap] of containers) {
    it(`${name}: the coordinates are zeroed and the file keeps its length`, () => {
      const tiff = tiffWithGps();
      const { bytes, tiffAt } = wrap(tiff.bytes);
      const before = bytes.length;

      const changed = stripImageLocation(bytes, contentType);

      expect(changed, "nothing was stripped").toBe(true);
      expect(
        isZeroed(bytes, tiffAt + tiff.latAt, tiff.latLength),
        "the latitude bytes survived",
      ).toBe(true);
      // A resized container is a container whose every later offset is wrong.
      expect(bytes.length).toBe(before);
    });
  }
});

describe("what must survive (#294)", () => {
  it("keeps Orientation, so a portrait photo is not served on its side", () => {
    // The reason this is surgical instead of "delete all metadata". Orientation is
    // rendering information, not information about a person.
    const tiff = tiffWithGps();
    const { bytes, tiffAt } = jpeg(tiff.bytes);

    stripImageLocation(bytes, "image/jpeg");

    const view = new DataView(bytes.buffer);
    expect(view.getUint16(tiffAt + 10, true), "the Orientation tag").toBe(ORIENTATION);
    expect(view.getUint16(tiffAt + 18, true), "the Orientation value").toBe(6);
  });

  it("leaves the pointer pointing at nothing a reader will follow", () => {
    // Zeroing the directory but leaving the pointer would send a strict reader to
    // offset 0 — the TIFF header — to read the byte order marker as a directory.
    const tiff = tiffWithGps();
    const { bytes, tiffAt } = jpeg(tiff.bytes);

    stripImageLocation(bytes, "image/jpeg");

    const view = new DataView(bytes.buffer);
    expect(view.getUint16(tiffAt + 22, true), "still tagged as GPS").not.toBe(
      GPS_POINTER,
    );
    expect(view.getUint32(tiffAt + 30, true)).toBe(0);
  });

  it("handles a big-endian file, which is half of them", () => {
    const tiff = tiffWithGps({ little: false });
    const { bytes, tiffAt } = jpeg(tiff.bytes);

    const changed = stripImageLocation(bytes, "image/jpeg");

    expect(changed).toBe(true);
    expect(isZeroed(bytes, tiffAt + tiff.latAt, tiff.latLength)).toBe(true);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(tiffAt + 10, false)).toBe(ORIENTATION);
  });
});

describe("what it must not touch (#294)", () => {
  it("reports no change for a photo that never carried a location", () => {
    // Most files. `changed` is what tells the audit trail apart from noise.
    const { bytes } = jpeg(new Uint8Array([0x49, 0x49, 42, 0x00, 8, 0, 0, 0, 0, 0]));
    const before = Uint8Array.from(bytes);

    const changed = stripImageLocation(bytes, "image/jpeg");

    expect(changed).toBe(false);
    expect(Array.from(bytes)).toEqual(Array.from(before));
  });

  it("stops at the scan, so pixel data is never parsed as a directory", () => {
    // THE CASE THAT MATTERS for a walker versus a search, and the fixture has to be
    // strong enough to prove it: everything after SOS here is a byte-for-byte valid
    // APP1 Exif segment carrying a GPS directory. A scanner that kept walking would
    // find it and zero a run of somebody's photograph.
    const tiff = tiffWithGps();
    const segmentLength = 2 + 6 + tiff.bytes.length;
    const bytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xda, 0x00, 0x02, // SOS: everything after is entropy-coded
      0xff, 0xe1, (segmentLength >> 8) & 0xff, segmentLength & 0xff,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif  ", inside the pixels
      ...tiff.bytes,
    ]);
    const before = Uint8Array.from(bytes);

    const changed = stripImageLocation(bytes, "image/jpeg");

    expect(changed, "it walked past the start of scan").toBe(false);
    expect(Array.from(bytes)).toEqual(Array.from(before));
  });

  it("leaves a GIF alone", () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
    const before = Uint8Array.from(bytes);
    expect(stripImageLocation(bytes, "image/gif")).toBe(false);
    expect(Array.from(bytes)).toEqual(Array.from(before));
  });
});

describe("a file it cannot read is a file it leaves alone (#294)", () => {
  it("never throws on truncated, empty or nonsense bytes", () => {
    // Refusing an upload because its metadata is unusual would fail a customer's
    // photo to protect a third party who is not in the request.
    const cases: [string, Uint8Array][] = [
      ["empty", new Uint8Array(0)],
      ["one byte", new Uint8Array([0xff])],
      ["truncated jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])],
      ["random", new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])],
      ["png header only", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      ["riff header only", new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0])],
    ];
    for (const [name, bytes] of cases) {
      for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic"]) {
        expect(() => stripImageLocation(bytes, type), `${name} as ${type}`).not.toThrow();
      }
    }
  });

  it("refuses to read a directory that claims more entries than the block holds", () => {
    // A malformed count is how a crafted file would get this to walk off the end of
    // the buffer and zero whatever is next to it.
    const tiff = new Uint8Array(20);
    const view = new DataView(tiff.buffer);
    tiff[0] = 0x49;
    tiff[1] = 0x49;
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, 9999, true); // nine thousand entries in twelve bytes
    const { bytes } = jpeg(tiff);

    expect(() => stripImageLocation(bytes, "image/jpeg")).not.toThrow();
    expect(stripImageLocation(bytes, "image/jpeg")).toBe(false);
  });
});

describe("the location written as XML rather than Exif (#294)", () => {
  it("blanks the XMP attributes, keeping every byte count intact", () => {
    // A file cleaned of one and still carrying the other is not cleaned.
    const xmp = '<x exif:GPSLatitude="51,30.5N" exif:GPSLongitude="0,7.5W"/>';
    const bytes = new TextEncoder().encode(xmp);
    const before = bytes.length;

    const changed = stripImageLocation(bytes, "image/jpeg");

    const after = new TextDecoder().decode(bytes);
    expect(changed).toBe(true);
    expect(after).not.toContain("51,30.5N");
    expect(after).not.toContain("0,7.5W");
    // The attribute NAMES stay: only the values are blanked, so the packet is
    // still well-formed XML of exactly the same length.
    expect(after).toContain("exif:GPSLatitude");
    expect(bytes.length).toBe(before);
  });

  it("leaves an unterminated attribute rather than running off the end", () => {
    const bytes = new TextEncoder().encode('<x exif:GPSLatitude="' + "5".repeat(400));
    expect(() => stripImageLocation(bytes, "image/jpeg")).not.toThrow();
  });
});
