/**
 * Client-side MMS validation matrix (#189): the type/size/count gate the text
 * composers run BEFORE any bytes leave the browser, mirroring the API's
 * outbound rules. Pure functions — no React, no network.
 */
import { describe, expect, it } from "vitest";

import {
  MMS_ACCEPT,
  MMS_MAX_MEDIA_BYTES,
  MMS_MAX_MEDIA_ITEMS,
  partitionMmsFiles,
  validateMmsFile,
} from "./mms";

const jpeg = { name: "site.jpg", type: "image/jpeg", size: 500_000 };

describe("validateMmsFile", () => {
  it("admits a deliverable file and resolves its send type", () => {
    const check = validateMmsFile(jpeg);
    expect(check).toEqual({ ok: true, contentType: "image/jpeg" });
  });

  it("resolves the send type from the extension when the OS reports none", () => {
    const check = validateMmsFile({ name: "Sam Rivera.vcf", type: "", size: 900 });
    expect(check).toEqual({ ok: true, contentType: "text/vcard" });
  });

  it("canonicalizes vendor MIME spellings (audio/x-m4a → audio/mp4)", () => {
    const check = validateMmsFile({
      name: "voicenote.m4a",
      type: "audio/x-m4a",
      size: 40_000,
    });
    expect(check).toEqual({ ok: true, contentType: "audio/mp4" });
  });

  it("rejects an undeliverable type with the file's name in the copy", () => {
    const check = validateMmsFile({
      name: "backup.zip",
      type: "application/zip",
      size: 1000,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain('"backup.zip"');
      expect(check.reason).toContain("can carry");
    }
  });

  it("rejects SVG (matches the API: active document, never deliverable)", () => {
    const check = validateMmsFile({
      name: "logo.svg",
      type: "image/svg+xml",
      size: 1000,
    });
    expect(check.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    const check = validateMmsFile({ name: "note.txt", type: "text/plain", size: 0 });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("empty");
  });

  it("rejects a file over the 1 MB carrier ceiling", () => {
    const check = validateMmsFile({
      name: "clip.mp4",
      type: "video/mp4",
      size: MMS_MAX_MEDIA_BYTES + 1,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("1 MB");
  });

  it("admits a file exactly at the ceiling", () => {
    const check = validateMmsFile({
      name: "clip.mp4",
      type: "video/mp4",
      size: MMS_MAX_MEDIA_BYTES,
    });
    expect(check.ok).toBe(true);
  });

  it("rejects past the item cap", () => {
    const check = validateMmsFile(jpeg, MMS_MAX_MEDIA_ITEMS);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain(`${MMS_MAX_MEDIA_ITEMS}`);
  });
});

describe("partitionMmsFiles", () => {
  it("admits up to the cap and rejects the tail with the cap sentence", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      name: `photo-${i}.jpg`,
      type: "image/jpeg",
      size: 1000,
    }));
    const { accepted, rejected } = partitionMmsFiles(files);
    expect(accepted).toHaveLength(MMS_MAX_MEDIA_ITEMS);
    expect(rejected).toHaveLength(5 - MMS_MAX_MEDIA_ITEMS);
    expect(rejected[0].reason).toContain("up to");
  });

  it("counts already-staged items toward the cap", () => {
    const { accepted, rejected } = partitionMmsFiles([jpeg, jpeg], 2);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("keeps admitting valid files after a rejection", () => {
    const { accepted, rejected } = partitionMmsFiles([
      { name: "logo.svg", type: "image/svg+xml", size: 1000 },
      { name: "quote.pdf", type: "application/pdf", size: 1000 },
    ]);
    expect(accepted.map((a) => a.contentType)).toEqual(["application/pdf"]);
    expect(rejected).toHaveLength(1);
  });
});

describe("MMS_ACCEPT", () => {
  it("offers the deliverable MIME set plus the empty-type extensions", () => {
    expect(MMS_ACCEPT).toContain("image/jpeg");
    expect(MMS_ACCEPT).toContain("video/mp4");
    expect(MMS_ACCEPT).toContain("text/vcard");
    expect(MMS_ACCEPT).toContain(".vcf");
    expect(MMS_ACCEPT).toContain(".amr");
    expect(MMS_ACCEPT).not.toContain("image/svg");
  });
});
