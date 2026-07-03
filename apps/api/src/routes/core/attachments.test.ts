/**
 * Generic attachment storage helpers (D19 §2): the type allow-list, byte-sniff
 * content-type re-validation, safe filename + object-key building.
 */
import { describe, expect, it } from "vitest";

import {
  attachmentStoragePath,
  bytesMatchDeclaredType,
  isAllowedAttachmentType,
  safeFilename,
  sniffContentType,
} from "./attachments";

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
