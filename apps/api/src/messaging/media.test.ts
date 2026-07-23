/**
 * Outbound MMS media validation (SPEC §7 422 rules + #35 byte sniffing,
 * widened by #189): decodeOutboundMedia must reject byte/declaration
 * mismatches, executable signatures, and magic-less BINARY declarations with
 * `validation_failed` BEFORE anything is stored or a signed URL is minted for
 * Telnyx — while accepting the full deliverable set (images, audio, video,
 * vCard, calendar, PDF, text). Pure functions: no network.
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "../http/errors";
import {
  decodeOutboundMedia,
  MAX_OUTBOUND_MEDIA_BYTES,
  MAX_OUTBOUND_MEDIA_ITEMS,
} from "./media";

/** Base64 of a binary string (test fixtures are tiny, btoa is fine). */
function b64(binary: string): string {
  return btoa(binary);
}

const JPEG = b64("\xff\xd8\xff\xe0 rest of a jpeg");
const PNG = b64("\x89PNG\r\n\x1a\n rest of a png");
const GIF = b64("GIF89a rest of a gif");
const WEBP = b64("RIFF\x24\x00\x00\x00WEBPVP8 rest");
const PDF = b64("%PDF-1.7 rest of a pdf");
const MP3_ID3 = b64("ID3\x03\x00 rest of an mp3");
const MP3_RAW = b64("\xff\xfb\x90\x00 raw mpeg frames");
const OGG = b64("OggS\x00\x02 rest of an ogg");
const WAV = b64("RIFF\x24\x00\x00\x00WAVEfmt rest");
const AMR = b64("#!AMR\n voice frames");
const FTYP_MP4 = b64("\x00\x00\x00\x18ftypmp42 boxes");
const FTYP_QT = b64("\x00\x00\x00\x14ftypqt   boxes");
const VCARD = b64("BEGIN:VCARD\nVERSION:3.0\nFN:Sam Rivera\nEND:VCARD");
const VCAL = b64("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR");
const PLAIN = b64("Job notes: bring the 3/4 inch fittings.");

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

  it("rejects more than the item cap", () => {
    const error = decodeError(
      Array.from({ length: MAX_OUTBOUND_MEDIA_ITEMS + 1 }, () => ({
        content_type: "image/jpeg",
        base64: JPEG,
      })),
    );
    expect(error.code).toBe("validation_failed");
  });

  it("rejects a content_type outside the deliverable set", () => {
    const error = decodeError([{ content_type: "image/tiff", base64: JPEG }]);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toContain("content_type");
  });

  it("rejects SVG (active document, never deliverable)", () => {
    const error = decodeError([
      { content_type: "image/svg+xml", base64: b64("<svg></svg>") },
    ]);
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

describe("decodeOutboundMedia — #189 widened accept matrix", () => {
  it("accepts every deliverable kind whose bytes carry the right signature", () => {
    const decoded = decodeOutboundMedia([
      { content_type: "image/webp", base64: WEBP },
      { content_type: "application/pdf", base64: PDF },
      { content_type: "audio/mpeg", base64: MP3_ID3 },
    ]);
    expect(decoded.map((item) => item.contentType)).toEqual([
      "image/webp",
      "application/pdf",
      "audio/mpeg",
    ]);
  });

  it("accepts raw (ID3-less) MPEG audio, ogg, wav, and amr", () => {
    for (const [content_type, base64] of [
      ["audio/mpeg", MP3_RAW],
      ["audio/ogg", OGG],
      ["audio/wav", WAV],
      ["audio/amr", AMR],
    ] as const) {
      const decoded = decodeOutboundMedia([{ content_type, base64 }]);
      expect(decoded[0].contentType).toBe(content_type);
    }
  });

  it("accepts any declared mp4/3gpp/quicktime flavor for an ISO (ftyp) container", () => {
    for (const content_type of [
      "video/mp4",
      "audio/mp4",
      "video/3gpp",
      "audio/3gpp",
    ] as const) {
      const decoded = decodeOutboundMedia([
        { content_type, base64: FTYP_MP4 },
      ]);
      expect(decoded[0].contentType).toBe(content_type);
    }
    expect(
      decodeOutboundMedia([
        { content_type: "video/quicktime", base64: FTYP_QT },
      ])[0].contentType,
    ).toBe("video/quicktime");
  });

  it("accepts vCard and calendar under their own and text/plain-compatible declarations", () => {
    expect(
      decodeOutboundMedia([{ content_type: "text/vcard", base64: VCARD }])[0]
        .contentType,
    ).toBe("text/vcard");
    expect(
      decodeOutboundMedia([{ content_type: "text/x-vcard", base64: VCARD }])[0]
        .contentType,
    ).toBe("text/x-vcard");
    expect(
      decodeOutboundMedia([{ content_type: "text/calendar", base64: VCAL }])[0]
        .contentType,
    ).toBe("text/calendar");
  });

  it("accepts magic-less plain text declared as text/plain", () => {
    expect(
      decodeOutboundMedia([{ content_type: "text/plain", base64: PLAIN }])[0]
        .contentType,
    ).toBe("text/plain");
  });

  it("canonicalizes vendor MIME aliases onto the allow-list", () => {
    const decoded = decodeOutboundMedia([
      { content_type: "audio/x-wav", base64: WAV },
    ]);
    expect(decoded[0].contentType).toBe("audio/wav");
  });
});

describe("decodeOutboundMedia — #35/#189 byte sniffing", () => {
  it("rejects bytes of a DIFFERENT image type than declared (png-as-jpeg)", () => {
    const error = decodeError([{ content_type: "image/jpeg", base64: PNG }]);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toContain("do not match");
  });

  it("rejects a renamed executable (MZ) declared as an image or audio", () => {
    for (const content_type of ["image/png", "audio/mpeg"] as const) {
      const error = decodeError([
        { content_type, base64: b64("MZ\x90\x00 pe payload") },
      ]);
      expect(error.code).toBe("validation_failed");
    }
  });

  it("rejects a shell script (#!) even when declared as text/plain", () => {
    const error = decodeError([
      { content_type: "text/plain", base64: b64("#!/bin/sh\nrm -rf /") },
    ]);
    expect(error.code).toBe("validation_failed");
  });

  it("still admits AMR despite its #! magic (the one carved-out shebang)", () => {
    expect(
      decodeOutboundMedia([{ content_type: "audio/amr", base64: AMR }])[0]
        .contentType,
    ).toBe("audio/amr");
  });

  it("rejects magic-less bytes under a BINARY declaration (no null-sniff trust)", () => {
    for (const content_type of [
      "image/jpeg",
      "audio/mp4",
      "video/mp4",
      "application/pdf",
    ] as const) {
      const error = decodeError([
        { content_type, base64: b64("just some text bytes") },
      ]);
      expect(error.code).toBe("validation_failed");
    }
  });

  it("rejects an ISO container declared as an image", () => {
    const error = decodeError([
      { content_type: "image/jpeg", base64: FTYP_MP4 },
    ]);
    expect(error.code).toBe("validation_failed");
  });

  it("rejects audio bytes declared as a text type", () => {
    const error = decodeError([{ content_type: "text/plain", base64: OGG }]);
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
