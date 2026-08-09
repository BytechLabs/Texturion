/**
 * Real Exif structures, built byte by byte, for the suites that care what is inside a
 * customer's photo.
 *
 * Shared rather than copied because there are now two of them: `attachments/location`
 * proves the rewrite itself, and `routes/attachments` proves that the upload path runs
 * it on BOTH objects it stores — the original and the client-supplied preview (#581/13,
 * where the preview did not get it). A byte-level builder duplicated is a set of
 * offsets that drift apart, and a test whose fixture has drifted asserts nothing while
 * still passing.
 */

export const ORIENTATION = 0x0112;
export const GPS_POINTER = 0x8825;
export const GPS_LATITUDE = 0x0002;
/** A pattern that cannot occur by accident, so "zeroed" is unambiguous. */
export const LAT_FILL = 0xab;

/**
 * A TIFF block: IFD0 carrying Orientation and a GPS pointer, and a GPS directory
 * whose latitude is three RATIONALs held out of line (as every real one is — 24
 * bytes cannot fit in a 4-byte entry).
 */
export function tiffWithGps(options: { little?: boolean } = {}): {
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
export function jpegWithExif(tiff: Uint8Array): { bytes: Uint8Array; tiffAt: number } {
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

export function isZeroed(bytes: Uint8Array, from: number, length: number): boolean {
  for (let i = from; i < from + length; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

/**
 * A JPEG carrying a GPS latitude, and where to find it afterwards.
 *
 * The one call most suites want: the container every phone camera writes.
 */
export function jpegWithGps(): {
  bytes: Uint8Array;
  /** Offset of the latitude bytes within the JPEG. */
  latAt: number;
  latLength: number;
} {
  const tiff = tiffWithGps();
  const wrapped = jpegWithExif(tiff.bytes);
  return {
    bytes: wrapped.bytes,
    latAt: wrapped.tiffAt + tiff.latAt,
    latLength: tiff.latLength,
  };
}
