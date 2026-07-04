import { describe, expect, it } from "vitest";

import { isFilePaste } from "./clipboard";

/**
 * `isFilePaste` decides whether a paste should be intercepted as a file
 * attachment (suppressing the default text paste). The tricky case is an
 * Office / rich-text copy, which carries BOTH a synthesized image on
 * `files` AND a `text/html` flavor — those must keep their normal text paste
 * (finding #10). A genuine file paste (screenshot, file-manager copy) has
 * files and no HTML.
 */

function clip(types: string[], fileCount: number) {
  return { types, files: { length: fileCount } };
}

describe("isFilePaste", () => {
  it("is true for a genuine file paste (files, no text/html)", () => {
    // A pasted screenshot: one image file, only the file flavor.
    expect(isFilePaste(clip(["Files"], 1))).toBe(true);
  });

  it("is true when a file-manager copy adds a plain-text flavor", () => {
    // Some OS file managers add text/plain (the path) — still a file paste.
    expect(isFilePaste(clip(["Files", "text/plain"], 1))).toBe(true);
  });

  it("is false for an Office copy carrying files AND text/html", () => {
    // Word/Excel/browser selection: a synthesized image rides along, but the
    // text/html flavor is the tell — the user meant to paste text.
    expect(
      isFilePaste(clip(["text/plain", "text/html", "Files"], 1)),
    ).toBe(false);
  });

  it("is false for a plain-text paste (no files)", () => {
    expect(isFilePaste(clip(["text/plain"], 0))).toBe(false);
  });

  it("is false when text/html is present but no files", () => {
    expect(isFilePaste(clip(["text/html", "text/plain"], 0))).toBe(false);
  });

  it("is false for null/undefined clipboard data", () => {
    expect(isFilePaste(null)).toBe(false);
    expect(isFilePaste(undefined)).toBe(false);
  });
});
