import { describe, expect, it } from "vitest";

import {
  buildAttachmentForm,
  isAllowedAttachmentType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_OWNER,
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

describe("buildAttachmentForm (multipart shape POST /v1/attachments)", () => {
  it("appends owner_type, owner_id, and file", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "quote.pdf", {
      type: "application/pdf",
    });
    const form = buildAttachmentForm("task", "task-123", file);
    expect(form.get("owner_type")).toBe("task");
    expect(form.get("owner_id")).toBe("task-123");
    const uploaded = form.get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe("quote.pdf");
  });

  it("carries the note owner_type for a note attachment", () => {
    const form = buildAttachmentForm(
      "note",
      "note-9",
      new Blob(["hi"], { type: "text/plain" }),
    );
    expect(form.get("owner_type")).toBe("note");
    expect(form.get("owner_id")).toBe("note-9");
  });
});
