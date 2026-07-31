import { describe, expect, it } from "vitest";

import { MAX_SCANNABLE_BYTES, scanAttachment } from "./scan";

/**
 * #317 — the fixtures here are REAL containers, byte for byte.
 *
 * A scanner tested against hand-waved stubs proves the stubs parse. The ZIPs
 * below carry a genuine central directory that any unzip would read, and the
 * PDFs carry the actual dictionary keys a malicious PDF uses, so a change that
 * breaks the parser fails here instead of in an inbox.
 */

const enc = new TextEncoder();

/** Build a ZIP whose central directory lists `entries`. */
function zip(
  entries: { name: string; compressed?: number; uncompressed?: number }[],
  options: { corruptDirectory?: boolean } = {},
): Uint8Array {
  const parts: number[] = [];
  const push16 = (v: number) => parts.push(v & 0xff, (v >> 8) & 0xff);
  const push32 = (v: number) =>
    parts.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);

  // Local file headers are not read by the scanner (it walks the central
  // directory, exactly as an unzip does), so a single filler keeps the offsets
  // honest without building compressed payloads.
  const filler = enc.encode("PKlocal");
  for (const byte of filler) parts.push(byte);

  const dirOffset = parts.length;
  for (const entry of entries) {
    push32(options.corruptDirectory ? 0x01020304 : 0x02014b50); // central header
    push16(20); // version made by
    push16(20); // version needed
    push16(0); // flags
    push16(8); // method: deflate
    push16(0); // time
    push16(0); // date
    push32(0); // crc
    push32(entry.compressed ?? 100);
    push32(entry.uncompressed ?? 100);
    const name = enc.encode(entry.name);
    push16(name.length);
    push16(0); // extra
    push16(0); // comment
    push16(0); // disk
    push16(0); // internal attrs
    push32(0); // external attrs
    push32(0); // local header offset
    for (const byte of name) parts.push(byte);
  }
  const dirSize = parts.length - dirOffset;

  push32(0x06054b50); // EOCD
  push16(0); // disk
  push16(0); // disk with dir
  push16(entries.length);
  push16(entries.length);
  push32(dirSize);
  push32(dirOffset);
  push16(0); // comment length
  return new Uint8Array(parts);
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A plausible, harmless spreadsheet. */
const honestSheet = () =>
  zip([
    { name: "[Content_Types].xml", compressed: 200, uncompressed: 1200 },
    { name: "xl/workbook.xml", compressed: 300, uncompressed: 2400 },
    { name: "xl/worksheets/sheet1.xml", compressed: 900, uncompressed: 9000 },
  ]);

/** A PDF body wrapped in the header/trailer a reader expects. */
function pdf(body: string): Uint8Array {
  return enc.encode(`%PDF-1.7\n${body}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
}

describe("#317 scanAttachment — ZIP containers", () => {
  it("passes an ordinary spreadsheet", () => {
    expect(scanAttachment(honestSheet(), XLSX).verdict).toBe("clean");
  });

  it("blocks a macro project, whatever the document claims to be", () => {
    // The named attack: a spreadsheet whose real payload is VBA.
    const result = scanAttachment(
      zip([{ name: "xl/vbaProject.bin" }, { name: "xl/workbook.xml" }]),
      XLSX,
    );
    expect(result.verdict).toBe("blocked");
    expect(result.reason).toBe("zip_macro");
    // The message has to be usable by somebody between jobs, and must not
    // accuse a customer who may have been forwarded the file themselves.
    expect(result.message).toContain("macros");
    expect(result.message).not.toMatch(/virus|infected|attack/i);
  });

  it("blocks ODF's macro directory too, not just OpenXML's", () => {
    const result = scanAttachment(
      zip([{ name: "Basic/Standard/Module1.xml" }, { name: "content.xml" }]),
      "application/vnd.oasis.opendocument.text",
    );
    expect(result.reason).toBe("zip_macro");
  });

  it("blocks an executable packed inside a document", () => {
    for (const name of [
      "payload.exe",
      "word/embeddings/setup.msi",
      "docProps/thumbs.scr",
      "x/run.ps1",
      "x/thing.lnk",
    ]) {
      const result = scanAttachment(zip([{ name }, { name: "content.xml" }]), DOCX);
      expect(result.verdict, name).toBe("blocked");
      expect(result.reason, name).toBe("zip_executable");
    }
  });

  it("blocks zip-slip, including the backslash spelling", () => {
    for (const name of ["../../etc/passwd", "..\\..\\windows\\system32\\x.xml", "/abs.xml"]) {
      const result = scanAttachment(zip([{ name }]), DOCX);
      expect(result.verdict, name).toBe("blocked");
      expect(result.reason, name).toBe("zip_path_escape");
    }
  });

  it("blocks a decompression bomb but not ordinary XML compression", () => {
    // XML compresses hard — around 10:1 is normal and must not trip.
    const ordinary = scanAttachment(
      zip([{ name: "xl/sheet.xml", compressed: 1_000, uncompressed: 12_000 }]),
      XLSX,
    );
    expect(ordinary.verdict).toBe("clean");

    const bomb = scanAttachment(
      zip([{ name: "xl/sheet.xml", compressed: 1_000, uncompressed: 900_000 }]),
      XLSX,
    );
    expect(bomb.verdict).toBe("blocked");
    expect(bomb.reason).toBe("zip_expansion");
  });

  it("HOLDS a document whose insides cannot be read, rather than passing it", () => {
    // "We could not check it" must never resolve to "so we delivered it".
    const result = scanAttachment(zip([{ name: "a.xml" }], { corruptDirectory: true }), XLSX);
    expect(result.verdict).toBe("unscannable");
    expect(result.reason).toBe("zip_unreadable");
    expect(result.message).toContain("holding it");
  });

  it("HOLDS a declared document that is not a ZIP at all", () => {
    const result = scanAttachment(enc.encode("just some text, not a container"), DOCX);
    expect(result.verdict).toBe("unscannable");
  });
});

describe("#317 scanAttachment — PDF", () => {
  it("passes an ordinary invoice", () => {
    const result = scanAttachment(
      pdf("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj"),
      "application/pdf",
    );
    expect(result.verdict).toBe("clean");
  });

  it("blocks /Launch, which starts another program", () => {
    const result = scanAttachment(
      pdf("1 0 obj << /A << /S /Launch /F (cmd.exe) >> >> endobj"),
      "application/pdf",
    );
    expect(result.verdict).toBe("blocked");
    expect(result.reason).toBe("pdf_launch");
  });

  it("blocks JavaScript that runs on open", () => {
    const result = scanAttachment(
      pdf("1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> >> endobj"),
      "application/pdf",
    );
    expect(result.verdict).toBe("blocked");
    expect(result.reason).toBe("pdf_auto_javascript");
  });

  it("ALLOWS form-validation JavaScript with no auto-run", () => {
    // The deliberate false-positive concession. Fillable PDFs in the trades
    // carry field-validation scripts; blocking those would make this guard
    // something people route around, and routed-around guards protect nobody.
    const result = scanAttachment(
      pdf("1 0 obj << /AcroForm << /Fields [ << /JS (validate()) >> ] >> >> endobj"),
      "application/pdf",
    );
    expect(result.verdict).toBe("clean");
  });

  it("blocks a PDF carrying an embedded program", () => {
    const result = scanAttachment(
      pdf("1 0 obj << /Type /EmbeddedFile >> endobj\n2 0 obj << /F (invoice-1481.exe) >> endobj"),
      "application/pdf",
    );
    expect(result.verdict).toBe("blocked");
    expect(result.reason).toBe("pdf_embedded_executable");
  });

  it("allows a PDF with an embedded ordinary file", () => {
    const result = scanAttachment(
      pdf("1 0 obj << /Type /EmbeddedFile >> endobj\n2 0 obj << /F (receipt.png) >> endobj"),
      "application/pdf",
    );
    expect(result.verdict).toBe("clean");
  });
});

describe("#317 scanAttachment — the boundaries", () => {
  it("passes media, which carries no container to hide in", () => {
    // The byte-signature check at the boundary already proved these are what
    // they claim; there is nothing further to read.
    for (const type of ["image/jpeg", "image/png", "audio/mpeg", "video/mp4"]) {
      expect(scanAttachment(enc.encode("....binary...."), type).verdict, type).toBe("clean");
    }
  });

  it("HOLDS an empty file rather than calling it clean", () => {
    expect(scanAttachment(new Uint8Array(0), "application/pdf").verdict).toBe("unscannable");
  });

  it("HOLDS a file above the ceiling — the documented cost behaviour", () => {
    // #317 asks for a ceiling with a stated behaviour. "Too big to check" must
    // resolve to held, never to delivered: waving through exactly the files
    // nobody looked at would invert the whole point.
    const huge = new Uint8Array(MAX_SCANNABLE_BYTES + 1);
    huge.set(enc.encode("%PDF-1.7"), 0);
    const result = scanAttachment(huge, "application/pdf");
    expect(result.verdict).toBe("unscannable");
    expect(result.reason).toBe("too_large");
  });

  it("reads the type without being fooled by parameters or case", () => {
    const result = scanAttachment(
      pdf("<< /A << /S /Launch >> >>"),
      "APPLICATION/PDF; charset=binary",
    );
    expect(result.reason).toBe("pdf_launch");
  });

  it("never returns a blocked verdict without telling the person why", () => {
    // A held file with no explanation is the silent drop #317 calls out by
    // name as its own failure.
    const results = [
      scanAttachment(zip([{ name: "xl/vbaProject.bin" }]), XLSX),
      scanAttachment(pdf("/Launch"), "application/pdf"),
      scanAttachment(new Uint8Array(0), "application/pdf"),
    ];
    for (const result of results) {
      expect(result.verdict).not.toBe("clean");
      expect(result.reason, JSON.stringify(result)).toBeTruthy();
      expect(result.message!.length).toBeGreaterThan(30);
    }
  });
});
