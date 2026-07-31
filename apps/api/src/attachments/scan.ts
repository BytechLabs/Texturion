/**
 * #317 — structural scanning of every file we redistribute.
 *
 * What already existed is genuinely good and this does not replace it: a D19
 * MIME allow-list at the boundary, the bucket as a hard ceiling behind it, and
 * `bytesMatchDeclaredType`, which refuses a script or native executable
 * uploaded under an allowed content type. Between them a `.exe` named
 * `invoice.pdf` never lands.
 *
 * They stop the wrong file TYPE. They do not stop a malicious file of an
 * ALLOWED type, and the allow-list deliberately includes the two formats that
 * carry payloads: PDF, and the OpenXML/ODF family, which are ZIP containers.
 * That gap matters here more than in most products, because of what this one
 * does: anyone who knows a number printed on a truck can send it a file, we
 * store it, we sign a URL for it, and a tech opens it on a phone between jobs.
 * If it is malicious we are the delivery mechanism, and the customer's
 * antivirus will name us.
 *
 * WHY STRUCTURAL RATHER THAN AN AV SERVICE. #317 notes that an external
 * scanner is a subprocessor decision with disclosure consequences (#285) and a
 * per-object price the cost mandate has to answer for. Both are the owner's
 * calls, and neither is a reason to leave the files unexamined in the meantime.
 * The attacks the issue actually names — a weaponised PDF, a macro document —
 * have structure you can read without sending anybody's file anywhere:
 *
 *   - a PDF that runs something when opened, or launches an external program;
 *   - an Office/ODF container carrying a macro project, an executable, or a
 *     path that escapes the extraction directory;
 *   - a container whose declared expansion is a decompression bomb.
 *
 * This catches those deterministically, at zero marginal cost, with no bytes
 * leaving the Worker and nobody new in the subprocessor list. It is not
 * antivirus and does not pretend to be: it will not catch a novel payload in a
 * well-formed document. It closes the named holes and leaves the door open for
 * a scanner to be added behind it (see `EXTERNAL_SCAN_UNAVAILABLE`).
 *
 * FALSE POSITIVES ARE THE REAL RISK, not missed detections. Blocking a
 * customer's legitimate invoice is a product failure the crew experiences
 * immediately, so every rule below is chosen to have essentially no honest
 * use: nothing that generates a real quote embeds a `/Launch` action, and no
 * spreadsheet a homeowner sends needs `vbaProject.bin`. Where a signal is
 * genuinely ambiguous — a PDF carrying form-validation JavaScript with no
 * auto-run — it is deliberately allowed.
 */

/** What the scan concluded. Anything that is not `clean` is not retrievable. */
export type ScanVerdict = "clean" | "blocked" | "unscannable";

export interface ScanResult {
  verdict: ScanVerdict;
  /**
   * Stable machine reason, for metrics and for the operator. Null when clean.
   */
  reason: string | null;
  /**
   * One sentence for the person looking at the held file. Written for a crew
   * member, not an analyst: it says what happened and what they can do, and
   * never implies the sender is guilty of something they may not be.
   */
  message: string | null;
}

const CLEAN: ScanResult = { verdict: "clean", reason: null, message: null };

function blocked(reason: string, message: string): ScanResult {
  return { verdict: "blocked", reason, message };
}

function unscannable(reason: string, message: string): ScanResult {
  return { verdict: "unscannable", reason, message };
}

/**
 * The deep-scan ceiling. Above this the file is HELD rather than waved
 * through: "too big to check" is not a reason to hand somebody an unchecked
 * file, and #317 is explicit that the cost ceiling needs a documented
 * behaviour rather than a silent one.
 *
 * 26 MB clears the 25 MB attachment cap and the 5 MB MMS cap with headroom, so
 * in practice nothing legitimate reaches it — it exists so that a raised
 * upload limit cannot silently turn scanning off.
 */
export const MAX_SCANNABLE_BYTES = 26 * 1024 * 1024;

/** Entry names that are executable whatever they are wrapped in. */
const EXECUTABLE_ENTRY = new RegExp(
  "\\.(exe|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|msi|msp|dll|cpl|lnk|reg|sh|app|dmg|deb|rpm)$",
  "i",
);

/**
 * A ZIP container's expansion ratio above which it is a bomb rather than a
 * document. Real OpenXML compresses well — XML is repetitive — so the ceiling
 * has to be generous. 200:1 is far above anything a text-heavy spreadsheet
 * reaches and far below the ratios a bomb needs to be dangerous.
 */
const MAX_EXPANSION_RATIO = 200;

/** More entries than any real document, and a cheap guard against zip quines. */
const MAX_ENTRIES = 4096;

/* -------------------------------------------------------------------------- */
/* ZIP                                                                        */
/* -------------------------------------------------------------------------- */

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

/** Little-endian reads. */
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/**
 * Parse a ZIP's central directory. Returns null when the file is not a
 * readable ZIP — the CALLER decides what that means, because "an .xlsx whose
 * central directory cannot be read" is a very different statement from "a JPEG
 * is not a ZIP".
 */
function readZipEntries(bytes: Uint8Array): ZipEntry[] | null {
  // The End of Central Directory record is at the end, after a comment of up
  // to 65535 bytes. Search backwards for its signature.
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const from = Math.max(0, bytes.length - (0xffff + 22));
  for (let i = bytes.length - 22; i >= from; i--) {
    if (u32(bytes, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = u16(bytes, eocd + 10);
  const dirOffset = u32(bytes, eocd + 16);
  // Zip64 stores 0xFFFF/0xFFFFFFFF sentinels here and the real values in an
  // extended record. Rather than half-implement that, say so: the caller holds
  // the file instead of guessing about it.
  if (count === 0xffff || dirOffset === 0xffffffff) return null;
  if (dirOffset >= bytes.length) return null;

  const entries: ZipEntry[] = [];
  let at = dirOffset;
  const CEN_SIG = 0x02014b50;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== CEN_SIG) return null;
    const compressedSize = u32(bytes, at + 20);
    const uncompressedSize = u32(bytes, at + 24);
    const nameLen = u16(bytes, at + 28);
    const extraLen = u16(bytes, at + 30);
    const commentLen = u16(bytes, at + 32);
    const nameEnd = at + 46 + nameLen;
    if (nameEnd > bytes.length) return null;
    let name = "";
    for (let j = at + 46; j < nameEnd; j++) name += String.fromCharCode(bytes[j]);
    entries.push({ name, compressedSize, uncompressedSize });
    at = nameEnd + extraLen + commentLen;
    if (entries.length > MAX_ENTRIES) break;
  }
  return entries;
}

/** Is this content type a ZIP container we are expected to be able to read? */
function isZipContainer(contentType: string): boolean {
  return (
    contentType.startsWith("application/vnd.openxmlformats-officedocument.") ||
    contentType.startsWith("application/vnd.oasis.opendocument.") ||
    contentType === "application/zip"
  );
}

function scanZip(bytes: Uint8Array): ScanResult {
  const entries = readZipEntries(bytes);
  if (entries === null) {
    return unscannable(
      "zip_unreadable",
      "We couldn't read inside this document to check it, so we're holding it. " +
        "Ask the sender to re-save it and send it again.",
    );
  }
  if (entries.length > MAX_ENTRIES) {
    return blocked(
      "zip_entry_count",
      "This document contains far more files inside it than a real document " +
        "does, so we haven't passed it on.",
    );
  }

  let compressed = 0;
  let uncompressed = 0;
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/");
    const lower = name.toLowerCase();

    // Zip-slip: an entry that escapes the extraction directory. There is no
    // honest document that does this.
    if (lower.startsWith("/") || lower.includes("../")) {
      return blocked(
        "zip_path_escape",
        "This document tries to write files outside where it should, which no " +
          "ordinary document does. We haven't passed it on.",
      );
    }
    // Macro projects. OpenXML puts VBA in vbaProject.bin; ODF uses Basic/.
    if (
      lower.endsWith("vbaproject.bin") ||
      lower.startsWith("macros/") ||
      lower.startsWith("basic/") ||
      lower.includes("/vbaproject.bin")
    ) {
      return blocked(
        "zip_macro",
        "This document contains macros — small programs that run when it opens. " +
          "We don't pass those on. Ask the sender for a PDF or a plain copy.",
      );
    }
    if (EXECUTABLE_ENTRY.test(lower)) {
      return blocked(
        "zip_executable",
        "This document has a program file packed inside it. We haven't passed " +
          "it on. Ask the sender for a PDF or a plain copy.",
      );
    }
    compressed += entry.compressedSize;
    uncompressed += entry.uncompressedSize;
  }

  // A decompression bomb: small on the wire, enormous when opened.
  if (compressed > 0 && uncompressed / compressed > MAX_EXPANSION_RATIO) {
    return blocked(
      "zip_expansion",
      "This document expands to an unreasonable size when opened, which is a " +
        "known way to crash the program opening it. We haven't passed it on.",
    );
  }
  return CLEAN;
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                        */
/* -------------------------------------------------------------------------- */

/** Case-sensitive byte search — PDF names are case-sensitive. */
function contains(haystack: Uint8Array, needle: string): boolean {
  const n = needle.length;
  if (n === 0 || haystack.length < n) return false;
  const first = needle.charCodeAt(0);
  outer: for (let i = 0; i <= haystack.length - n; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < n; j++) {
      if (haystack[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

function scanPdf(bytes: Uint8Array): ScanResult {
  // /Launch runs an external program. Nothing that produces an invoice, a
  // quote or a photo of a water heater has ever needed this.
  if (contains(bytes, "/Launch")) {
    return blocked(
      "pdf_launch",
      "This PDF tries to start another program when it opens. We haven't " +
        "passed it on — ask the sender for a plain PDF.",
    );
  }

  const hasJs = contains(bytes, "/JavaScript") || contains(bytes, "/JS");
  const autoRuns = contains(bytes, "/OpenAction") || contains(bytes, "/AA");
  // JavaScript that runs BY ITSELF on open is the attack. JavaScript sitting
  // in a form field waiting for input is how half the fillable PDFs in the
  // trades work, and blocking those would make this guard something people
  // route around. Both signals together, or nothing.
  if (hasJs && autoRuns) {
    return blocked(
      "pdf_auto_javascript",
      "This PDF runs a script by itself when it opens. We haven't passed it " +
        "on — ask the sender for a plain PDF.",
    );
  }

  // An embedded file is legitimate (attachments panel); an embedded PROGRAM is
  // not. The name appears near the specification, so look for the pairing.
  if (contains(bytes, "/EmbeddedFile")) {
    let name = "";
    // /F (filename) entries in the file specification dictionary.
    for (let i = 0; i < bytes.length - 3; i++) {
      if (bytes[i] === 0x2f && bytes[i + 1] === 0x46 && bytes[i + 2] === 0x20) {
        // "/F " then usually ( ... )
        let j = i + 3;
        while (j < bytes.length && bytes[j] !== 0x28 && bytes[j] !== 0x0a) j++;
        if (bytes[j] === 0x28) {
          name = "";
          for (j++; j < bytes.length && bytes[j] !== 0x29 && name.length < 260; j++) {
            name += String.fromCharCode(bytes[j]);
          }
          if (EXECUTABLE_ENTRY.test(name)) {
            return blocked(
              "pdf_embedded_executable",
              "This PDF has a program file packed inside it. We haven't passed " +
                "it on — ask the sender for a plain PDF.",
            );
          }
        }
      }
    }
  }
  return CLEAN;
}

/* -------------------------------------------------------------------------- */

/**
 * Examine one file. Called on ingest in BOTH directions, before the object is
 * retrievable by anybody.
 *
 * `contentType` is the type the boundary already validated and that
 * `bytesMatchDeclaredType` already confirmed the bytes agree with, so this can
 * trust it to choose which structure to read.
 */
export function scanAttachment(bytes: Uint8Array, contentType: string): ScanResult {
  const type = (contentType || "").toLowerCase().split(";")[0].trim();

  if (bytes.length === 0) {
    return unscannable(
      "empty",
      "This file arrived empty, so there was nothing to check. Ask the sender " +
        "to try again.",
    );
  }
  if (bytes.length > MAX_SCANNABLE_BYTES) {
    // The documented behaviour at the ceiling (#317): held, not waved through.
    return unscannable(
      "too_large",
      "This file is too large for us to check, so we're holding it rather than " +
        "passing on something we haven't looked at.",
    );
  }

  if (type === "application/pdf") return scanPdf(bytes);
  if (isZipContainer(type)) return scanZip(bytes);

  // Images, audio and video: the byte-signature check at the boundary already
  // established the bytes are what they claim, and there is no container here
  // to carry a payload. A polyglot is a real thing but it needs the VIEWER to
  // execute it, and `dispositionOptions` already stops these rendering in a
  // privileged origin.
  return CLEAN;
}

/**
 * The reason recorded when an external scanner is configured but did not
 * answer. Nothing sets this today — it is the seam for the AV service #317
 * leaves as an owner decision, so adding one later is a new branch here rather
 * than a new shape everywhere downstream.
 */
export const EXTERNAL_SCAN_UNAVAILABLE = "external_unavailable";
