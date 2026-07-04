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
