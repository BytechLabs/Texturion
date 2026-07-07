/**
 * Outbound MMS media validation (SPEC §7 422 rules + #35 byte sniffing):
 * decodeOutboundMedia must reject byte/declaration mismatches, executable
 * signatures, and magic-less blobs with `validation_failed` BEFORE anything
 * is stored or a signed URL is minted for Telnyx — the same D19 §2.3 posture
 * the generic attachment path enforces, tightened to strict equality because
 * jpeg/png/gif all carry distinctive magic. Pure functions: no network.
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "../http/errors";
import { decodeOutboundMedia, MAX_OUTBOUND_MEDIA_BYTES } from "./media";

/** Base64 of a binary string (test fixtures are tiny, btoa is fine). */
function b64(binary: string): string {
  return btoa(binary);
}

const JPEG = b64("\xff\xd8\xff\xe0 rest of a jpeg");
const PNG = b64("\x89PNG\r\n\x1a\n rest of a png");
const GIF = b64("GIF89a rest of a gif");

function decodeError(
  items: { content_type: string; base64: string }[],
): ApiError {
  try {
    decodeOutboundMedia(items);
  } catch (cause) {
    if (cause instanceof ApiError) return cause;
    throw cause;
  }
  throw new Error("decodeOutboundMedia did not throw");
}

describe("decodeOutboundMedia — §7 shape rules", () => {
  it("decodes items whose bytes match the declared type", () => {
    const decoded = decodeOutboundMedia([
      { content_type: "image/jpeg", base64: JPEG },
      { content_type: "image/png", base64: PNG },
      { content_type: "image/gif", base64: GIF },
    ]);
    expect(decoded.map((item) => item.contentType)).toEqual([
      "image/jpeg",
      "image/png",
      "image/gif",
    ]);
    // The decoded bytes round-trip exactly (first item spot-checked).
    expect(Array.from(decoded[0].bytes.slice(0, 3))).toEqual([
      0xff, 0xd8, 0xff,
    ]);
  });

  it("rejects more than 3 items", () => {
    const error = decodeError(
      Array.from({ length: 4 }, () => ({
        content_type: "image/jpeg",
        base64: JPEG,
      })),
    );
    expect(error.code).toBe("validation_failed");
  });

  it("rejects a content_type outside jpeg|png|gif", () => {
    const error = decodeError([{ content_type: "image/tiff", base64: JPEG }]);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toContain("content_type");
  });

  it("rejects invalid base64", () => {
    const error = decodeError([
      { content_type: "image/png", base64: "!!!not-base64!!!" },
    ]);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toContain("base64");
  });

  it("rejects an empty payload", () => {
    const error = decodeError([{ content_type: "image/png", base64: "" }]);
    expect(error.code).toBe("validation_failed");
  });

  it("rejects a decoded payload over 1 MB", () => {
    const error = decodeError([
      {
        content_type: "image/jpeg",
        base64: b64("\xff\xd8\xff" + "x".repeat(MAX_OUTBOUND_MEDIA_BYTES)),
      },
    ]);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toContain("exceeds");
  });
});

describe("decodeOutboundMedia — #35 byte sniffing", () => {
  it("rejects bytes of a DIFFERENT image type than declared (png-as-jpeg)", () => {
    const error = decodeError([{ content_type: "image/jpeg", base64: PNG }]);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toContain("do not match");
  });

  it("rejects a renamed executable (MZ) declared as an image", () => {
    const error = decodeError([
      { content_type: "image/png", base64: b64("MZ\x90\x00 pe payload") },
    ]);
    expect(error.code).toBe("validation_failed");
  });

  it("rejects a shell script (#!) declared as an image", () => {
    const error = decodeError([
      { content_type: "image/gif", base64: b64("#!/bin/sh\nrm -rf /") },
    ]);
    expect(error.code).toBe("validation_failed");
  });

  it("rejects magic-less bytes (strict: no null-sniff trust on this path)", () => {
    const error = decodeError([
      { content_type: "image/jpeg", base64: b64("just some text bytes") },
    ]);
    expect(error.code).toBe("validation_failed");
  });

  it("names the failing item's index in the message", () => {
    const error = decodeError([
      { content_type: "image/jpeg", base64: JPEG },
      { content_type: "image/jpeg", base64: PNG },
    ]);
    expect(error.message).toContain("media[1]");
  });
});
