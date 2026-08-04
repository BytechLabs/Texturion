import { describe, expect, it } from "vitest";

import {
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_FRACTION,
  PREVIEW_MAX_EDGE,
  PREVIEW_WORTH_IT_BYTES,
  previewDimensions,
  previewIsUseful,
  previewWorthHaving,
} from "./attachment-preview";

/**
 * #240 — the numbers three clients generate against and one Worker refuses on.
 *
 * Vectors shared with the Kotlin and Swift ports. Two sets of numbers for one
 * contract is how a client ends up producing something the server will not
 * take — and the failure would look like "photos sometimes don't upload".
 */
describe("is a preview worth making", () => {
  it("wants one for a big image", () => {
    expect(previewWorthHaving("image/jpeg", 8 * 1024 * 1024)).toBe(true);
    expect(previewWorthHaving("image/png", PREVIEW_WORTH_IT_BYTES + 1)).toBe(
      true,
    );
  });

  it("leaves a small image alone", () => {
    // Inbound MMS is ≤1 MB per item by carrier limit (D28), and below the
    // threshold a derivative saves a fraction of a fraction while costing an
    // object, a column and a round trip.
    expect(previewWorthHaving("image/jpeg", PREVIEW_WORTH_IT_BYTES)).toBe(false);
    expect(previewWorthHaving("image/jpeg", 40 * 1024)).toBe(false);
  });

  it("never wants one for a file that is not an image", () => {
    // Nothing about a 20 MB PDF gets smaller by making a picture of its first
    // page — the thread renders a file row, not a picture.
    for (const type of [
      "application/pdf",
      "text/csv",
      "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(previewWorthHaving(type, 20 * 1024 * 1024), type).toBe(false);
    }
  });

  it("never wants one for an image type this product refuses", () => {
    // A preview is a second way into the same bucket, so it must not be a way
    // around the upload allow-list. SVG is denied there because an SVG is an
    // active document.
    expect(previewWorthHaving("image/svg+xml", 5 * 1024 * 1024)).toBe(false);
    expect(previewWorthHaving("image/tiff", 5 * 1024 * 1024)).toBe(false);
  });

  it("ignores case and stray whitespace on the type", () => {
    // Three platforms report a picked file's type, and not all of them are
    // tidy about it.
    expect(previewWorthHaving("  IMAGE/JPEG ", 5 * 1024 * 1024)).toBe(true);
  });
});

describe("the preview's dimensions", () => {
  it("scales the longest edge down to the ceiling, keeping the ratio", () => {
    expect(previewDimensions(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(previewDimensions(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it("never scales anything up", () => {
    // A small image that somehow reaches here keeps its own size. Re-encoding
    // it larger than it started would cost bytes to lose quality.
    expect(previewDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(previewDimensions(PREVIEW_MAX_EDGE, 900)).toEqual({
      width: PREVIEW_MAX_EDGE,
      height: 900,
    });
  });

  it("keeps a panorama's short edge above zero", () => {
    // 8000 x 12 scales the short edge to 2.4px, and every platform throws on a
    // zero-height canvas. Rounding down to nothing is the kind of edge that
    // shows up as "the app crashes on one guy's photos".
    const thin = previewDimensions(8000, 12);
    expect(thin.width).toBe(1600);
    expect(thin.height).toBeGreaterThanOrEqual(1);
  });

  it("answers something usable for a degenerate size", () => {
    // A decode that reports 0 or NaN is a broken image, and the caller drops
    // the preview — but it must not divide by zero on the way to finding out.
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [Number.NaN, 100],
      [-5, 100],
    ]) {
      const size = previewDimensions(w, h);
      expect(size.width, `${w}x${h}`).toBeGreaterThanOrEqual(1);
      expect(size.height, `${w}x${h}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("is the result worth sending", () => {
  const original = 8 * 1024 * 1024;

  it("accepts a real downscale", () => {
    expect(previewIsUseful(180 * 1024, original)).toBe(true);
  });

  it("drops one that came out bigger than its source", () => {
    // An already-optimised small JPEG re-encoded at a fixed quality is the
    // ordinary case. The right answer is to send the original alone rather
    // than earn a 422.
    expect(previewIsUseful(400 * 1024, 300 * 1024)).toBe(false);
  });

  it("drops one over the absolute ceiling, however big the original", () => {
    // The fraction rule alone would let a 25 MB original carry a 12 MB
    // "preview" — technically smaller, and a second full-size path in practice.
    expect(previewIsUseful(MAX_PREVIEW_BYTES + 1, 25 * 1024 * 1024)).toBe(false);
    expect(previewIsUseful(MAX_PREVIEW_BYTES, 25 * 1024 * 1024)).toBe(true);
  });

  it("drops an empty one", () => {
    expect(previewIsUseful(0, original)).toBe(false);
  });

  it("agrees with the server exactly at the fraction", () => {
    // The server refuses strictly above the fraction. A client that disagreed
    // by one byte would produce an upload that fails only for photos of a
    // particular size, which is the worst kind of bug to be told about.
    const small = 300 * 1024;
    const half = Math.floor(small * MAX_PREVIEW_FRACTION);
    expect(previewIsUseful(half, small)).toBe(true);
    expect(previewIsUseful(half + 1, small)).toBe(false);
  });
});
