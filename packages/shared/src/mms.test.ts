/**
 * MMS media contract (#189): canonicalization, the deliverable allow-list,
 * the picker's extension fallback, and the kind mapping the file-chip UIs key
 * on. Pure functions — no network, no platform APIs.
 */
import { describe, expect, it } from "vitest";

import {
  MMS_MAX_MEDIA_BYTES,
  MMS_MAX_MEDIA_ITEMS,
  MMS_OUTBOUND_MEDIA_TYPES,
  canonicalMmsType,
  isMmsMediaType,
  mmsMediaKind,
  mmsMediaTypeForFile,
} from "./mms";

describe("MMS media allow-list", () => {
  it("keeps the SPEC §7 numeric limits", () => {
    expect(MMS_MAX_MEDIA_BYTES).toBe(1024 * 1024);
    expect(MMS_MAX_MEDIA_ITEMS).toBe(3);
  });

  it("covers images, audio, video, vCard, calendar, PDF, and text", () => {
    for (const type of [
      "image/jpeg",
      "image/webp",
      "audio/mpeg",
      "audio/amr",
      "video/mp4",
      "text/vcard",
      "text/calendar",
      "application/pdf",
      "text/plain",
    ]) {
      expect(isMmsMediaType(type)).toBe(true);
    }
  });

  it("still excludes SVG and executables' MIME spellings", () => {
    expect(isMmsMediaType("image/svg+xml")).toBe(false);
    expect(isMmsMediaType("application/x-msdownload")).toBe(false);
    expect(isMmsMediaType("application/zip")).toBe(false);
  });
});

describe("canonicalMmsType", () => {
  it("lowercases and strips parameters", () => {
    expect(canonicalMmsType("Text/VCard; charset=UTF-8")).toBe("text/vcard");
  });

  it("maps vendor aliases onto the canonical list", () => {
    expect(canonicalMmsType("audio/x-m4a")).toBe("audio/mp4");
    expect(canonicalMmsType("audio/x-wav")).toBe("audio/wav");
    expect(canonicalMmsType("audio/mp3")).toBe("audio/mpeg");
    expect(canonicalMmsType("audio/amr-nb")).toBe("audio/amr");
  });

  it("passes unknown types through unchanged (cleaned)", () => {
    expect(canonicalMmsType("application/OCTET-stream")).toBe(
      "application/octet-stream",
    );
  });

  it("does not resolve Object.prototype keys to prototype members", () => {
    // Untrusted content-types that collide with inherited property names must
    // fall through to the cleaned string (and then be rejected), never return a
    // function/object from the prototype.
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      // Returns the cleaned (lowercased) string, never a prototype member.
      const result = canonicalMmsType(key);
      expect(typeof result).toBe("string");
      expect(result).toBe(key.toLowerCase());
      expect(isMmsMediaType(key)).toBe(false);
    }
  });
});

describe("mmsMediaTypeForFile", () => {
  it("prefers a deliverable declared type", () => {
    expect(
      mmsMediaTypeForFile({ name: "clip.bin", type: "video/mp4" }),
    ).toBe("video/mp4");
  });

  it("canonicalizes an aliased declared type", () => {
    expect(
      mmsMediaTypeForFile({ name: "note.m4a", type: "audio/x-m4a" }),
    ).toBe("audio/mp4");
  });

  it("falls back to the extension when the type is empty (Windows .vcf/.amr)", () => {
    expect(mmsMediaTypeForFile({ name: "Sam Rivera.vcf", type: "" })).toBe(
      "text/vcard",
    );
    expect(mmsMediaTypeForFile({ name: "voicenote.AMR", type: null })).toBe(
      "audio/amr",
    );
  });

  it("falls back to the extension when the declared type is undeliverable", () => {
    expect(
      mmsMediaTypeForFile({ name: "song.mp3", type: "application/octet-stream" }),
    ).toBe("audio/mpeg");
  });

  it("returns null for a file MMS cannot carry", () => {
    expect(mmsMediaTypeForFile({ name: "setup.exe", type: "" })).toBeNull();
    expect(
      mmsMediaTypeForFile({ name: "logo.svg", type: "image/svg+xml" }),
    ).toBeNull();
    expect(mmsMediaTypeForFile({ name: "archive.zip", type: "application/zip" })).toBeNull();
  });
});

describe("mmsMediaKind", () => {
  it("maps every allow-listed type onto a concrete kind", () => {
    for (const type of MMS_OUTBOUND_MEDIA_TYPES) {
      expect(mmsMediaKind(type)).not.toBe("file");
    }
  });

  it("maps the coarse categories the chips key on", () => {
    expect(mmsMediaKind("image/png")).toBe("image");
    expect(mmsMediaKind("audio/x-wav")).toBe("audio");
    expect(mmsMediaKind("video/quicktime")).toBe("video");
    expect(mmsMediaKind("text/x-vcard")).toBe("contact");
    expect(mmsMediaKind("text/calendar")).toBe("calendar");
    expect(mmsMediaKind("application/pdf")).toBe("document");
    expect(mmsMediaKind("text/plain")).toBe("text");
    expect(mmsMediaKind(null)).toBe("file");
    expect(mmsMediaKind("application/octet-stream")).toBe("file");
  });
});
