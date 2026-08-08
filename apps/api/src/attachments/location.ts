/**
 * #294 / D128 — a customer's home coordinates do not enter the bucket.
 *
 * ## The problem, in one sentence
 *
 * A phone photographing a boiler in somebody's kitchen writes the GPS position of
 * that kitchen into the file. Every note photo we store carries the home address of
 * one of our customer's customers, in a form no one on the crew asked for and no one
 * can see.
 *
 * That matters because those bytes travel: to the customer-facing job page, into a
 * forwarded thread, out of an export, and into whatever a backup ends up on. The
 * business gains nothing from it — a job already carries its address as a field, and
 * every map feature reads that field, not the picture.
 *
 * ## Why it is neutralised in place rather than removed
 *
 * A Worker has no image library. Removing an Exif block means rewriting the
 * container: fixing JPEG segment lengths, PNG chunk CRCs, RIFF sizes, ISO-BMFF box
 * offsets — four format-specific rewrites, each of which can produce a file that no
 * longer opens. A corrupted job photo is a worse outcome than the problem.
 *
 * So nothing is resized. The GPS directory is found and its bytes are overwritten
 * with zeros, and the entry pointing at it is turned into a tag no reader follows.
 * The file is exactly as long as it was, every offset in it still resolves, and the
 * coordinates are gone. The same routine then works for every container, because
 * they all embed the SAME TIFF block — JPEG in an APP1 segment, PNG in an `eXIf`
 * chunk, WebP in an `EXIF` chunk, HEIC in an `Exif` item.
 *
 * ## What is deliberately kept
 *
 * Orientation. It is rendering information rather than information about a person,
 * and dropping it turns every portrait photo on its side. This is the reason the
 * routine is surgical instead of "delete all metadata", which would have been less
 * code and a visible regression.
 *
 * ## What this does not reach, stated rather than implied
 *
 * A location written ONLY into a vendor-private MakerNote, or into a format outside
 * the allow-list. Both are recorded in D128 with the reasoning; neither is what a
 * phone camera does.
 */

/** Tag 0x8825 in IFD0: "the GPS directory starts here". */
const GPS_IFD_POINTER = 0x8825;

/**
 * What the pointer entry becomes.
 *
 * A private tag in the range reserved for them, so a strict reader sees an unknown
 * entry and skips it rather than following four zero bytes to the start of the TIFF
 * header and reading whatever is there as a directory.
 */
const NEUTRALISED_TAG = 0xdead;

/** Bytes per IFD entry: tag(2) + type(2) + count(4) + value-or-offset(4). */
const ENTRY_SIZE = 12;

/** Size in bytes of each TIFF field type, indexed by the type code. */
const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

/** A TIFF block inside some container, as an absolute range in the file. */
interface TiffBlock {
  /** Absolute offset of the "II"/"MM" byte order marker. */
  start: number;
  /** Bytes available to this block. Nothing is read past it. */
  length: number;
}

/**
 * Overwrite every location in an image, IN PLACE. Returns whether anything went.
 *
 * In place rather than returning a copy: the caller holds a freshly read upload
 * buffer, and duplicating a 25 MB file for no reason is 25 MB of Worker memory. It
 * is also why nothing here resizes — see the file docblock.
 *
 * Never throws. A file this cannot parse is a file it leaves exactly as it found it:
 * refusing an upload because its metadata is unusual would fail a customer's photo
 * to protect a third party who is not in the request.
 */
export function stripImageLocation(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  let changed = false;
  try {
    for (const block of findTiffBlocks(bytes, contentType)) {
      if (neutraliseGpsInTiff(bytes, block)) changed = true;
    }
    if (blankXmpLocation(bytes)) changed = true;
  } catch {
    // See the docblock: an unparseable file is left alone, not rejected.
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Finding the TIFF block, per container
// ---------------------------------------------------------------------------

function findTiffBlocks(bytes: Uint8Array, contentType: string): TiffBlock[] {
  const type = contentType.trim().toLowerCase();
  if (type === "image/jpeg") return jpegTiffBlocks(bytes);
  if (type === "image/png") return pngTiffBlocks(bytes);
  if (type === "image/webp") return webpTiffBlocks(bytes);
  if (type === "image/heic" || type === "image/heif") return heifTiffBlocks(bytes);
  // GIF has no Exif segment in any form a camera writes.
  return [];
}

/**
 * JPEG: walk the marker segments looking for APP1 with the "Exif\0\0" header.
 *
 * Walked rather than searched, because the byte sequence "Exif" appears inside plenty
 * of compressed image data and following it would mean parsing pixels as a directory.
 */
function jpegTiffBlocks(bytes: Uint8Array): TiffBlock[] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return [];
  const found: TiffBlock[] = [];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1];
    // Start of scan: everything after this is entropy-coded pixel data.
    if (marker === 0xda || marker === 0xd9) break;
    // Standalone markers carry no length.
    if (marker >= 0xd0 && marker <= 0xd9) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) break;
    const payload = at + 4;
    if (marker === 0xe1 && payload + 6 <= bytes.length) {
      const isExif =
        bytes[payload] === 0x45 && // E
        bytes[payload + 1] === 0x78 && // x
        bytes[payload + 2] === 0x69 && // i
        bytes[payload + 3] === 0x66 && // f
        bytes[payload + 4] === 0x00 &&
        bytes[payload + 5] === 0x00;
      if (isExif) {
        found.push({ start: payload + 6, length: length - 2 - 6 });
      }
    }
    at += 2 + length;
  }
  return found;
}

/** PNG: the `eXIf` chunk holds a bare TIFF block. */
function pngTiffBlocks(bytes: Uint8Array): TiffBlock[] {
  if (bytes.length < 8) return [];
  const found: TiffBlock[] = [];
  let at = 8; // past the signature
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(
      bytes[at + 4],
      bytes[at + 5],
      bytes[at + 6],
      bytes[at + 7],
    );
    const data = at + 8;
    if (data + length > bytes.length) break;
    if (type === "eXIf") found.push({ start: data, length });
    if (type === "IEND") break;
    at = data + length + 4; // + CRC
  }
  return found;
}

/** WebP: a RIFF `EXIF` chunk holds a bare TIFF block. */
function webpTiffBlocks(bytes: Uint8Array): TiffBlock[] {
  if (bytes.length < 12) return [];
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff !== "RIFF" || webp !== "WEBP") return [];
  const found: TiffBlock[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const type = String.fromCharCode(
      bytes[at],
      bytes[at + 1],
      bytes[at + 2],
      bytes[at + 3],
    );
    const length = view.getUint32(at + 4, true); // RIFF is little-endian
    const data = at + 8;
    if (data + length > bytes.length) break;
    if (type === "EXIF") found.push({ start: data, length });
    // Chunks are padded to an even length.
    at = data + length + (length % 2);
  }
  return found;
}

/**
 * HEIC/HEIF: what an iPhone shoots, and the format the note allow-list accepts.
 *
 * The Exif payload sits inside an `mdat` box as an item, and finding it properly
 * means resolving `iloc` offsets out of the `meta` box. That is a lot of parsing to
 * locate a block that announces itself: an Exif item begins with a 4-byte offset to
 * the TIFF header followed by "II"/"MM". So the scan looks for the byte-order marker
 * with a plausible TIFF header behind it, and every candidate is then validated by
 * the same directory walk everything else uses — a false positive fails to parse as
 * an IFD and is left alone.
 *
 * Bounded to the first megabyte: the metadata sits at the front of the file, and the
 * alternative is scanning 25 MB of compressed pixels for a two-byte pattern.
 */
function heifTiffBlocks(bytes: Uint8Array): TiffBlock[] {
  const found: TiffBlock[] = [];
  const limit = Math.min(bytes.length - 8, 1_000_000);
  for (let at = 0; at < limit; at += 1) {
    const little = bytes[at] === 0x49 && bytes[at + 1] === 0x49;
    const big = bytes[at] === 0x4d && bytes[at + 1] === 0x4d;
    if (!little && !big) continue;
    const magic = little
      ? bytes[at + 2] | (bytes[at + 3] << 8)
      : (bytes[at + 2] << 8) | bytes[at + 3];
    if (magic !== 42) continue;
    found.push({ start: at, length: bytes.length - at });
    // One Exif block per file in practice; stopping also keeps a pathological
    // file from producing thousands of candidate blocks.
    break;
  }
  return found;
}

// ---------------------------------------------------------------------------
// The TIFF walk, shared by every container
// ---------------------------------------------------------------------------

/**
 * Zero the GPS directory and orphan the entry that points at it.
 *
 * Returns whether anything was actually overwritten, so the caller can tell "no
 * location present" from "location removed" without re-reading the file.
 */
function neutraliseGpsInTiff(bytes: Uint8Array, block: TiffBlock): boolean {
  const { start, length } = block;
  if (length < 8 || start + 8 > bytes.length) return false;

  const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
  const big = bytes[start] === 0x4d && bytes[start + 1] === 0x4d;
  if (!little && !big) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);

  if (u16(start + 2) !== 42) return false;
  const ifd0 = u32(start + 4);
  if (ifd0 < 8 || ifd0 + 2 > length) return false;

  const entries = u16(start + ifd0);
  // A directory claiming more entries than the block can hold is not a directory.
  if (ifd0 + 2 + entries * ENTRY_SIZE > length) return false;

  let changed = false;
  for (let i = 0; i < entries; i += 1) {
    const entry = start + ifd0 + 2 + i * ENTRY_SIZE;
    if (u16(entry) !== GPS_IFD_POINTER) continue;

    const gpsAt = u32(entry + 8);
    if (gpsAt >= 8 && gpsAt + 2 <= length) {
      changed = zeroDirectory(bytes, view, block, gpsAt, little) || changed;
    }
    // The pointer goes last: if zeroing the directory threw, the entry still
    // points somewhere real rather than at a half-cleared range.
    view.setUint16(entry, NEUTRALISED_TAG, little);
    view.setUint32(entry + 8, 0, little);
    changed = true;
  }
  return changed;
}

/**
 * Zero one directory: its entry table, and any values too big to live inline.
 *
 * A TIFF value of four bytes or fewer is stored IN the entry; anything larger — and
 * every coordinate is, being three RATIONALs — lives elsewhere in the block with the
 * entry holding an offset. Zeroing only the table would leave the actual latitude
 * sitting in the file.
 */
function zeroDirectory(
  bytes: Uint8Array,
  view: DataView,
  block: TiffBlock,
  directoryAt: number,
  little: boolean,
): boolean {
  const { start, length } = block;
  const entries = view.getUint16(start + directoryAt, little);
  const tableEnd = directoryAt + 2 + entries * ENTRY_SIZE;
  if (tableEnd + 4 > length) return false;

  for (let i = 0; i < entries; i += 1) {
    const entry = start + directoryAt + 2 + i * ENTRY_SIZE;
    const fieldType = view.getUint16(entry + 2, little);
    const count = view.getUint32(entry + 4, little);
    const unit = TYPE_SIZES[fieldType] ?? 0;
    const size = unit * count;
    if (size > 4) {
      const valueAt = view.getUint32(entry + 8, little);
      if (valueAt >= 8 && valueAt + size <= length) {
        bytes.fill(0, start + valueAt, start + valueAt + size);
      }
    }
  }
  // The table itself, including the entry count and the next-directory pointer.
  bytes.fill(0, start + directoryAt, start + tableEnd + 4);
  return true;
}

// ---------------------------------------------------------------------------
// XMP
// ---------------------------------------------------------------------------

/**
 * Blank the location out of any XMP packet, without changing its length.
 *
 * Some pipelines write the position a second time as XML rather than as Exif, and a
 * file cleaned of one while still carrying the other is not cleaned. Overwriting the
 * VALUE characters with spaces keeps every byte count and offset in the container
 * intact, which is the same rule the rest of this file follows.
 *
 * ASCII-scanned rather than XML-parsed: this is a fixed set of attribute names inside
 * a packet whose encoding is not guaranteed, and a parser would be a much larger
 * thing to be wrong in.
 */
function blankXmpLocation(bytes: Uint8Array): boolean {
  const attributes = [
    "exif:GPSLatitude",
    "exif:GPSLongitude",
    "exif:GPSAltitude",
    "exif:GPSTimeStamp",
    "exif:GPSDateStamp",
  ];
  let changed = false;
  for (const attribute of attributes) {
    let from = 0;
    for (;;) {
      const at = indexOfAscii(bytes, attribute, from);
      if (at < 0) break;
      from = at + attribute.length;
      // Expect `="…"` or `>…<`, and blank whatever sits between the delimiters.
      const opened = openerAfter(bytes, from);
      if (opened === null) continue;
      const end = closerFrom(bytes, opened.at + 1, opened.closer);
      if (end < 0) continue;
      bytes.fill(0x20, opened.at + 1, end);
      changed = true;
    }
  }
  return changed;
}

function openerAfter(
  bytes: Uint8Array,
  from: number,
): { at: number; closer: number } | null {
  for (let at = from; at < Math.min(bytes.length, from + 8); at += 1) {
    if (bytes[at] === 0x22) return { at, closer: 0x22 }; // "
    if (bytes[at] === 0x27) return { at, closer: 0x27 }; // '
    if (bytes[at] === 0x3e) return { at, closer: 0x3c }; // > … <
  }
  return null;
}

function closerFrom(bytes: Uint8Array, from: number, closer: number): number {
  // Bounded: an unterminated attribute is a malformed packet, not an invitation
  // to walk the rest of a 25 MB file.
  const limit = Math.min(bytes.length, from + 256);
  for (let at = from; at < limit; at += 1) {
    if (bytes[at] === closer) return at;
  }
  return -1;
}

function indexOfAscii(bytes: Uint8Array, needle: string, from: number): number {
  const first = needle.charCodeAt(0);
  const last = bytes.length - needle.length;
  for (let at = from; at <= last; at += 1) {
    if (bytes[at] !== first) continue;
    let hit = true;
    for (let i = 1; i < needle.length; i += 1) {
      if (bytes[at + i] !== needle.charCodeAt(i)) {
        hit = false;
        break;
      }
    }
    if (hit) return at;
  }
  return -1;
}
