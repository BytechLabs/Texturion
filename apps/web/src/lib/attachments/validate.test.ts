import { describe, expect, it } from "vitest";

import {
  buildAttachmentForm,
  isAllowedAttachmentType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_OWNER,
  partitionAttachmentFiles,
  validateAttachment,
} from "./validate";

describe("isAllowedAttachmentType (D19 §2.4 allow-list)", () => {
  it("accepts any image subtype by prefix", () => {
    expect(isAllowedAttachmentType("image/jpeg")).toBe(true);
    expect(isAllowedAttachmentType("image/png")).toBe(true);
    expect(isAllowedAttachmentType("image/webp")).toBe(true);
    expect(isAllowedAttachmentType("IMAGE/HEIC")).toBe(true); // case-insensitive
  });

  it("rejects a bare 'image/' with no subtype", () => {
    expect(isAllowedAttachmentType("image/")).toBe(false);
  });

  it("denies image/svg+xml despite the image/ prefix (matches the API)", () => {
    // An SVG is an active document (scripts/external refs) — the API denies it
    // in assertAllowedType; the client gate must agree or a picked SVG would
    // pass here and 422 on the wire.
    expect(isAllowedAttachmentType("image/svg+xml")).toBe(false);
    expect(isAllowedAttachmentType("IMAGE/SVG+XML")).toBe(false);
    expect(isAllowedAttachmentType(" image/svg+xml ")).toBe(false);
  });

  it("accepts the exact document + archive types", () => {
    expect(isAllowedAttachmentType("application/pdf")).toBe(true);
    expect(isAllowedAttachmentType("text/plain")).toBe(true);
    expect(isAllowedAttachmentType("text/csv")).toBe(true);
    expect(isAllowedAttachmentType("application/zip")).toBe(true);
    expect(
      isAllowedAttachmentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("rejects executables and unknown scripts (D19 blocked set)", () => {
    expect(isAllowedAttachmentType("application/x-msdownload")).toBe(false);
    expect(isAllowedAttachmentType("text/html")).toBe(false);
    expect(isAllowedAttachmentType("application/x-sh")).toBe(false);
    expect(isAllowedAttachmentType("application/octet-stream")).toBe(false);
  });
});

describe("validateAttachment (client pre-flight, plain copy)", () => {
  const okFile = { name: "part.jpg", type: "image/jpeg", size: 2_000 };

  it("admits an allowed, in-size file", () => {
    expect(validateAttachment(okFile, 0)).toEqual({ ok: true });
  });

  it("rejects an empty file with a plain reason", () => {
    const result = validateAttachment({ ...okFile, size: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/empty/i);
  });

  it("rejects a file over the 25 MB ceiling", () => {
    const result = validateAttachment({
      ...okFile,
      size: MAX_ATTACHMENT_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/25 MB/);
  });

  it("accepts a file exactly at the ceiling", () => {
    expect(
      validateAttachment({ ...okFile, size: MAX_ATTACHMENT_BYTES }, 0).ok,
    ).toBe(true);
  });

  it("rejects a disallowed declared type", () => {
    const result = validateAttachment({
      name: "run.exe",
      type: "application/x-msdownload",
      size: 1_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/isn't allowed/i);
  });

  it("rejects an SVG with the plain type sentence", () => {
    const result = validateAttachment({
      name: "logo.svg",
      type: "image/svg+xml",
      size: 1_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/isn't allowed/i);
  });

  it("trusts an empty declared type (the API sniffs the bytes)", () => {
    // Some browsers report "" for known-but-unrecognized files; the server is
    // the authority, so a blank type must not block on the client.
    expect(validateAttachment({ name: "sheet.ods", type: "", size: 500 }).ok).toBe(
      true,
    );
  });

  it("enforces the soft per-owner cap before the network", () => {
    const result = validateAttachment(okFile, MAX_ATTACHMENTS_PER_OWNER);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reason).toMatch(
        new RegExp(String(MAX_ATTACHMENTS_PER_OWNER)),
      );
  });

  it("allows the tenth attachment but not the eleventh", () => {
    expect(validateAttachment(okFile, MAX_ATTACHMENTS_PER_OWNER - 1).ok).toBe(
      true,
    );
    expect(validateAttachment(okFile, MAX_ATTACHMENTS_PER_OWNER).ok).toBe(false);
  });
});

describe("partitionAttachmentFiles (multi-select / drop / paste batches)", () => {
  const pdf = { name: "quote.pdf", type: "application/pdf", size: 2_000 };
  const jpg = { name: "part.jpg", type: "image/jpeg", size: 5_000 };
  const exe = { name: "run.exe", type: "application/x-msdownload", size: 100 };
  const svg = { name: "logo.svg", type: "image/svg+xml", size: 100 };
  const huge = { name: "video.zip", type: "application/zip", size: MAX_ATTACHMENT_BYTES + 1 };

  it("admits every valid file and keeps the incoming order", () => {
    const { accepted, rejected } = partitionAttachmentFiles([pdf, jpg]);
    expect(accepted).toEqual([pdf, jpg]);
    expect(rejected).toEqual([]);
  });

  it("splits a mixed batch, pairing each reject with its plain reason", () => {
    const { accepted, rejected } = partitionAttachmentFiles([pdf, exe, svg, huge, jpg]);
    expect(accepted).toEqual([pdf, jpg]);
    expect(rejected.map((r) => r.file.name)).toEqual([
      "run.exe",
      "logo.svg",
      "video.zip",
    ]);
    expect(rejected[0].reason).toMatch(/isn't allowed/i);
    expect(rejected[1].reason).toMatch(/isn't allowed/i);
    expect(rejected[2].reason).toMatch(/25 MB/);
  });

  it("counts admissions toward the per-owner cap as it goes", () => {
    const batch = Array.from({ length: MAX_ATTACHMENTS_PER_OWNER + 2 }, (_, i) => ({
      name: `f${i}.pdf`,
      type: "application/pdf",
      size: 100,
    }));
    const { accepted, rejected } = partitionAttachmentFiles(batch);
    expect(accepted).toHaveLength(MAX_ATTACHMENTS_PER_OWNER);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reason).toMatch(
      new RegExp(String(MAX_ATTACHMENTS_PER_OWNER)),
    );
  });

  it("honors an existing count (already-staged or already-uploaded files)", () => {
    const { accepted, rejected } = partitionAttachmentFiles(
      [pdf, jpg],
      MAX_ATTACHMENTS_PER_OWNER - 1,
    );
    expect(accepted).toEqual([pdf]);
    expect(rejected.map((r) => r.file)).toEqual([jpg]);
  });

  it("rejected files don't consume cap headroom", () => {
    // 1 slot left, first file invalid — the second valid file still fits.
    const { accepted } = partitionAttachmentFiles(
      [exe, pdf],
      MAX_ATTACHMENTS_PER_OWNER - 1,
    );
    expect(accepted).toEqual([pdf]);
  });
});

describe("buildAttachmentForm (multipart shape POST /v1/attachments — notes-only, D28)", () => {
  it("appends owner_type='note', owner_id, and file", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "quote.pdf", {
      type: "application/pdf",
    });
    const form = buildAttachmentForm("note", "note-123", file);
    expect(form.get("owner_type")).toBe("note");
    expect(form.get("owner_id")).toBe("note-123");
    const uploaded = form.get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe("quote.pdf");
  });

  it("accepts a bare Blob body", () => {
    const form = buildAttachmentForm(
      "note",
      "note-9",
      new Blob(["hi"], { type: "text/plain" }),
    );
    expect(form.get("owner_type")).toBe("note");
    expect(form.get("owner_id")).toBe("note-9");
  });
});
