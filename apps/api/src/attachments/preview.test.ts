import { describe, expect, it } from "vitest";

import { ApiError } from "../http/errors";
import { scanAttachment } from "./scan";
import {
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_FRACTION,
  PREVIEW_WORTH_IT_BYTES,
  acceptUploadedPreview,
  previewStoragePath,
  previewWorthHaving,
} from "./preview";

/**
 * #240 item 1 — the bounded preview an uploader sends alongside the original.
 *
 * The thing worth testing here is not the happy path. It is that a preview is a
 * CLIENT-SUPPLIED FILE and gets every gate the original gets: this is a second
 * blob, chosen by the same caller, served inline to every member of the crew,
 * and the only thing making it "a preview" is that we said so.
 */

/** A minimal but genuine JPEG: SOI + APP0/JFIF, which the byte sniffer reads. */
function jpeg(sizeBytes: number): Uint8Array {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

function png(sizeBytes: number): Uint8Array {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function refusal(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error.message;
    throw error;
  }
  throw new Error("expected a refusal, got none");
}

describe("is a preview worth having", () => {
  it("wants one for a big image", () => {
    expect(previewWorthHaving("image/jpeg", 8 * 1024 * 1024)).toBe(true);
  });

  it("does not want one for a small image", () => {
    // Inbound MMS is ≤1 MB per item by carrier limit (D28), and the founder's
    // own re-derivation on #240 is that a derivative there saves a fraction of
    // a fraction. Below the threshold the original IS the bounded preview.
    expect(previewWorthHaving("image/jpeg", PREVIEW_WORTH_IT_BYTES)).toBe(false);
    expect(previewWorthHaving("image/jpeg", 40 * 1024)).toBe(false);
  });

  it("never wants one for a file that is not an image", () => {
    // A 20 MB PDF is the biggest thing this product accepts, and nothing about
    // it gets smaller by making a JPEG of its first page — the thread renders a
    // file row, not a picture.
    for (const type of [
      "application/pdf",
      "text/csv",
      "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(previewWorthHaving(type, 20 * 1024 * 1024), type).toBe(false);
    }
  });

  it("does not want one for an image type this product refuses", () => {
    // image/svg+xml is denied on the upload allow-list because an SVG is an
    // active document. A "preview" is a second way into the same bucket, so it
    // must not be a way around that.
    expect(previewWorthHaving("image/svg+xml", 5 * 1024 * 1024)).toBe(false);
    expect(previewWorthHaving("image/tiff", 5 * 1024 * 1024)).toBe(false);
  });
});

describe("the preview's object key", () => {
  it("sits beside its original, marked", () => {
    expect(previewStoragePath("co/note/n1/uuid-roof.jpg")).toBe(
      "co/note/n1/preview-uuid-roof.jpg",
    );
  });

  it("handles a key with no directory at all", () => {
    expect(previewStoragePath("loose.jpg")).toBe("preview-loose.jpg");
  });

  it("never collides with the original it belongs to", () => {
    // If it could, `upsert: false` would fail the preview upload — or worse,
    // the sweep's anti-join would see one object where there are two.
    const original = "co/note/n1/uuid-roof.jpg";
    expect(previewStoragePath(original)).not.toBe(original);
  });
});

describe("a preview is a client-supplied file", () => {
  const original = { sizeBytes: 8 * 1024 * 1024 };

  it("accepts a real, materially smaller image", () => {
    expect(() =>
      acceptUploadedPreview(
        { bytes: jpeg(120 * 1024), contentType: "image/jpeg" },
        original,
      ),
    ).not.toThrow();
    expect(() =>
      acceptUploadedPreview(
        { bytes: png(90 * 1024), contentType: "image/png" },
        original,
      ),
    ).not.toThrow();
  });

  it("refuses a type outside the image allow-list", () => {
    // The vector this closes: upload a PDF as the "preview" of a photo and get
    // an object into the bucket that skipped the original's allow-list.
    expect(
      refusal(() =>
        acceptUploadedPreview(
          { bytes: jpeg(1024), contentType: "application/pdf" },
          original,
        ),
      ),
    ).toContain("must be an image");
    expect(
      refusal(() =>
        acceptUploadedPreview(
          { bytes: jpeg(1024), contentType: "image/svg+xml" },
          original,
        ),
      ),
    ).toContain("must be an image");
  });

  it("refuses bytes that are not what the type says", () => {
    // The declared type is a string the client chose. A PDF renamed image/jpeg
    // would otherwise be served inline to the whole crew.
    const pdf = new Uint8Array(2048);
    pdf.set([0x25, 0x50, 0x44, 0x46], 0); // %PDF
    expect(
      refusal(() =>
        acceptUploadedPreview({ bytes: pdf, contentType: "image/jpeg" }, original),
      ),
    ).toContain("does not match its declared type");
  });

  it("refuses one that is not materially smaller", () => {
    // Without this a 300 KB original could arrive with a 299 KB "preview": the
    // ceiling passes, the thread fetches it, and nothing is saved.
    const small = { sizeBytes: 300 * 1024 };
    expect(
      refusal(() =>
        acceptUploadedPreview(
          { bytes: jpeg(299 * 1024), contentType: "image/jpeg" },
          small,
        ),
      ),
    ).toContain("materially smaller");
    // Exactly at the fraction is allowed; a byte over is not.
    const half = Math.floor(small.sizeBytes * MAX_PREVIEW_FRACTION);
    expect(() =>
      acceptUploadedPreview(
        { bytes: jpeg(half), contentType: "image/jpeg" },
        small,
      ),
    ).not.toThrow();
    expect(() =>
      acceptUploadedPreview(
        { bytes: jpeg(half + 1), contentType: "image/jpeg" },
        small,
      ),
    ).toThrow();
  });

  it("refuses one over the absolute ceiling, however big the original", () => {
    // The fraction rule alone would let a 25 MB original carry a 12 MB
    // "preview" — technically smaller, and a second full-size path in practice.
    expect(
      refusal(() =>
        acceptUploadedPreview(
          { bytes: jpeg(MAX_PREVIEW_BYTES + 1), contentType: "image/jpeg" },
          { sizeBytes: 25 * 1024 * 1024 },
        ),
      ),
    ).toContain("limit");
  });

  it("refuses an empty one", () => {
    expect(
      refusal(() =>
        acceptUploadedPreview(
          { bytes: new Uint8Array(0), contentType: "image/jpeg" },
          original,
        ),
      ),
    ).toContain("is empty");
  });

  it("is scanned on its own bytes", () => {
    // Asserted properly in preview-scan.test.ts, which stubs a blocking
    // verdict: `scanAttachment` returns CLEAN for every image by design, so a
    // test that fed it something nasty here would pass whether or not the call
    // existed. What this one holds is that a legitimate preview still gets
    // through the call rather than around it.
    expect(scanAttachment(jpeg(100 * 1024), "image/jpeg").verdict).toBe("clean");
    expect(() =>
      acceptUploadedPreview(
        { bytes: jpeg(100 * 1024), contentType: "image/jpeg" },
        original,
      ),
    ).not.toThrow();
  });
});
