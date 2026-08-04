import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../http/errors";

/**
 * #240/#317 — the preview goes through the content scanner, and the proof is a
 * stubbed verdict rather than a malicious file.
 *
 * There is no image the current scanner rejects: `scanAttachment` returns CLEAN
 * for every image type by design, because the byte-signature check at the
 * boundary already established the bytes are what they claim and there is no
 * container to carry a payload. So a test that fed it something nasty would
 * assert "clean equals clean" and pass whether or not the call existed at all.
 *
 * What is actually worth holding is the WIRING: #317 leaves an external AV
 * service as an owner decision and names `scanAttachment` as the seam it lands
 * on. The day that seam starts blocking things, it has to block them on the
 * preview too — a preview is the object the thread renders INLINE, to every
 * member of the crew, which is the more exposed of a row's two objects.
 *
 * Its own file because the mock has to be hoisted above the import, and the
 * rest of preview.test.ts wants the real scanner.
 */
vi.mock("./scan", () => ({
  scanAttachment: vi.fn(() => ({
    verdict: "blocked",
    reason: "stubbed_for_test",
    message: "we found something in this file",
  })),
}));

const { assertUsablePreview } = await import("./preview");
const { scanAttachment } = await import("./scan");

function jpeg(sizeBytes: number): Uint8Array {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

describe("the preview is scanned", () => {
  it("refuses a preview the scanner blocks, and says what it said", () => {
    const bytes = jpeg(100 * 1024);
    let message = "";
    try {
      assertUsablePreview(
        { bytes, contentType: "image/jpeg" },
        { sizeBytes: 8 * 1024 * 1024 },
      );
    } catch (error) {
      message = error instanceof ApiError ? error.message : String(error);
    }
    expect(message).toBe("preview: we found something in this file");
    // On the preview's OWN bytes — not the original's, which were checked by
    // the upload route before this is ever reached.
    expect(scanAttachment).toHaveBeenCalledWith(bytes, "image/jpeg");
  });
});
