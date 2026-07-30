/**
 * Generic attachment storage helpers (D19 §2): the type allow-list, byte-sniff
 * content-type re-validation, safe filename + object-key building.
 */
import { describe, expect, it } from "vitest";

import {
  attachmentStoragePath,
  bytesMatchDeclaredType,
  EXECUTABLE_SNIFF,
  isAllowedAttachmentType,
  OWNER_TYPES,
  safeFilename,
  sniffContentType,
  UPLOAD_OWNER_TYPES,
} from "./attachments";

describe("owner types (D19 carry vs D28 ingress)", () => {
  it("the table still carries note AND task rows, but upload is notes-only", () => {
    // Read paths (list / signed URL / delete / gallery) accept both — legacy
    // task-owned rows keep working forever (D28: no data migration).
    expect([...OWNER_TYPES]).toEqual(["note", "task"]);
    // Files enter through messages and notes ONLY (D28) — the standalone
    // task-attachment ingress is removed.
    expect([...UPLOAD_OWNER_TYPES]).toEqual(["note"]);
  });
});

describe("isAllowedAttachmentType (D19 §2.4)", () => {
  it("allows images (by prefix), pdf, text, office/odf, zip", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/heic",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.oasis.opendocument.spreadsheet",
    ]) {
      expect(isAllowedAttachmentType(type), type).toBe(true);
    }
  });

  it("blocks executables/scripts and unknown types", () => {
    for (const type of [
      "application/x-msdownload",
      "application/x-sh",
      "text/html",
      "application/javascript",
      "image/", // bare prefix is not a real image type
    ]) {
      expect(isAllowedAttachmentType(type), type).toBe(false);
    }
  });

  it("blocks image/svg+xml despite the image/ prefix (stored-XSS vector)", () => {
    // SVG is an active document (embedded script) — never inline-servable.
    expect(isAllowedAttachmentType("image/svg+xml")).toBe(false);
    expect(isAllowedAttachmentType("IMAGE/SVG+XML")).toBe(false);
    expect(isAllowedAttachmentType("  image/svg+xml  ")).toBe(false);
  });
});

describe("sniffContentType", () => {
  it("recognizes common magic bytes", () => {
    expect(sniffContentType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(
      sniffContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    expect(sniffContentType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(
      "application/pdf",
    );
    expect(sniffContentType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(
      "application/zip",
    );
  });

  it("returns null for bytes with no known signature (e.g. plain text)", () => {
    expect(sniffContentType(new TextEncoder().encode("hello,world\n"))).toBeNull();
  });

  it("recognizes executable/script signatures as EXECUTABLE_SNIFF (D19 §2.3)", () => {
    const mz = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // Windows PE
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // Linux ELF
    const machO = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]); // Mach-O 64 LE
    const shebang = new TextEncoder().encode("#!/bin/sh\nrm -rf /\n");
    for (const bytes of [mz, elf, machO, shebang]) {
      expect(sniffContentType(bytes)).toBe(EXECUTABLE_SNIFF);
    }
  });
});

describe("bytesMatchDeclaredType (D19 §2.3)", () => {
  it("accepts a matching image declaration", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytesMatchDeclaredType(png, "image/png")).toBe(true);
  });

  it("rejects a declaration whose bytes are a different media class", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(bytesMatchDeclaredType(pdf, "image/png")).toBe(false);
  });

  it("accepts a ZIP-container office declaration for ZIP bytes", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(
      bytesMatchDeclaredType(
        zip,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("trusts an allow-listed declaration when the bytes have no distinctive magic", () => {
    const text = new TextEncoder().encode("a,b,c\n1,2,3\n");
    expect(bytesMatchDeclaredType(text, "text/csv")).toBe(true);
  });

  it("rejects an executable declared as any allowed type (MZ-as-PDF, D19 §2.3)", () => {
    const mz = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // .exe renamed to .pdf
    expect(bytesMatchDeclaredType(mz, "application/pdf")).toBe(false);
    expect(bytesMatchDeclaredType(mz, "application/zip")).toBe(false);
    expect(bytesMatchDeclaredType(mz, "application/octet-stream")).toBe(false);
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    expect(bytesMatchDeclaredType(elf, "image/png")).toBe(false);
    const shebang = new TextEncoder().encode("#!/usr/bin/env python\n");
    expect(bytesMatchDeclaredType(shebang, "text/plain")).toBe(false);
  });

  /**
   * #317 — an AMR voice note is not a shell script, even though it starts `#!`.
   *
   * RFC 4867 §5 gives AMR the magic number `#!AMR\n`, and the shebang branch read
   * that as a script signature. It was latent while it lasted: nothing called the
   * sniffer on inbound MMS, so no voice note was ever actually dropped. It went
   * live the moment #317 wired this check into the inbound path — a customer
   * recording a voice note about a burst pipe would have had it refused, and the
   * crew would have seen a text with a missing attachment.
   */
  it("accepts AMR audio, whose magic number is a shebang (#317)", () => {
    const variants: [string, string][] = [
      ["#!AMR\n", "narrowband"],
      ["#!AMR-WB\n", "wideband"],
      ["#!AMR_MC1.0\n", "multi-channel narrowband"],
      ["#!AMR-WB_MC1.0\n", "multi-channel wideband"],
    ];
    for (const [header, label] of variants) {
      const bytes = new TextEncoder().encode(`${header}frames`);
      expect(sniffContentType(bytes), label).toBe("audio/amr");
      expect(bytesMatchDeclaredType(bytes, "audio/amr"), label).toBe(true);
      // Any audio declaration passes: carriers disagree about spelling (#189),
      // and audio/3gpp is a legitimate label for AMR-in-3GP content. What the
      // check is defending against is a BINARY wearing a media label, and these
      // bytes are not one.
      expect(bytesMatchDeclaredType(bytes, "audio/3gpp"), label).toBe(true);
      expect(bytesMatchDeclaredType(bytes, "audio/amr-nb"), label).toBe(true);
      // Still not a free pass across media classes.
      expect(bytesMatchDeclaredType(bytes, "image/jpeg"), label).toBe(false);
      expect(bytesMatchDeclaredType(bytes, "application/pdf"), label).toBe(false);
    }
  });

  it("still refuses a script that only LOOKS like it starts with the AMR header", () => {
    // The exception is the four exact RFC headers, so it cannot itself become
    // the way past the branch whose job is to catch scripts. `#!AMRrm -rf /` is
    // not AMR, and a real shebang naming an interpreter path is still a script.
    for (const text of [
      "#!AMRrm -rf /\n",
      "#!AMR-XX\nrm -rf /\n",
      "#!/bin/AMR\n",
      "#! AMR\n",
    ]) {
      const bytes = new TextEncoder().encode(text);
      expect(sniffContentType(bytes), text).toBe(EXECUTABLE_SNIFF);
      expect(bytesMatchDeclaredType(bytes, "audio/amr"), text).toBe(false);
    }
  });
});

describe("safeFilename + attachmentStoragePath", () => {
  it("sanitizes filenames and strips path traversal", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("my quote (final).pdf")).toBe("my_quote_final_.pdf");
    expect(safeFilename("")).toBe("file");
  });

  it("builds {company}/{owner_type}/{owner_id}/{uuid}-{safe_name} (company-leading)", () => {
    const path = attachmentStoragePath({
      companyId: "co1",
      ownerType: "task",
      ownerId: "t1",
      uuid: "u1",
      fileName: "Site Photo.png",
    });
    expect(path).toBe("co1/task/t1/u1-Site_Photo.png");
  });
});

describe("#262 — the image allow-list matches the bucket, not a prefix", () => {
  // The bucket enumerates six image types. A `startsWith("image/")` rule
  // admitted everything else, the byte sniffer has no signature for any of them
  // so it waved them through, a row was claimed, and storage.upload then failed
  // with InvalidMimeType — surfacing as a 500 rather than the 422 this gate
  // exists to produce. Enumerating both sides is what makes them agree.
  it("accepts exactly what the attachments bucket stores", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/heic",
      "image/heif",
    ]) {
      expect(isAllowedAttachmentType(type), type).toBe(true);
    }
  });

  it("refuses the image types the bucket would reject", () => {
    // Each of these previously reached Storage and came back a 500. They now
    // get the honest 422 at the boundary.
    for (const type of [
      "image/tiff",
      "image/avif",
      "image/bmp",
      "image/x-icon",
      "image/vnd.adobe.photoshop",
    ]) {
      expect(isAllowedAttachmentType(type), type).toBe(false);
    }
  });

  it("still refuses a bare prefix and the SVG XSS vector", () => {
    expect(isAllowedAttachmentType("image/")).toBe(false);
    expect(isAllowedAttachmentType("image/svg+xml")).toBe(false);
  });

  it("is case- and whitespace-insensitive, as the gate was before", () => {
    expect(isAllowedAttachmentType("  IMAGE/JPEG  ")).toBe(true);
    expect(isAllowedAttachmentType(" Image/TIFF ")).toBe(false);
  });
});
