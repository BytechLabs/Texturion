/**
 * Inbox attachment wording. The founder's report was a voice message shown as
 * "Photo", so the naming rules are pinned here: every kind gets its own noun,
 * counts pluralize, and a mixed or unknown set falls back to the neutral word
 * rather than guessing.
 */
import { describe, expect, it } from "vitest";

import { attachmentLabel, sharedMediaKind } from "./media-label";

describe("attachmentLabel", () => {
  it("names an audio clip an audio message, never a photo", () => {
    expect(attachmentLabel("audio", 1)).toBe("Audio message");
    expect(attachmentLabel("audio", 1)).not.toContain("Photo");
  });

  it("names each kind", () => {
    expect(attachmentLabel("image", 1)).toBe("Photo");
    expect(attachmentLabel("video", 1)).toBe("Video");
    expect(attachmentLabel("contact", 1)).toBe("Contact card");
    expect(attachmentLabel("calendar", 1)).toBe("Calendar invite");
    expect(attachmentLabel("document", 1)).toBe("PDF");
    expect(attachmentLabel("text", 1)).toBe("Text file");
    expect(attachmentLabel("file", 1)).toBe("Attachment");
  });

  it("pluralizes with the count", () => {
    expect(attachmentLabel("image", 3)).toBe("3 photos");
    expect(attachmentLabel("audio", 2)).toBe("2 audio messages");
    expect(attachmentLabel("document", 2)).toBe("2 PDFs");
    expect(attachmentLabel("file", 4)).toBe("4 attachments");
  });

  it("falls back to the neutral noun for an unknown kind", () => {
    expect(attachmentLabel(null, 1)).toBe("Attachment");
    expect(attachmentLabel(null, 2)).toBe("2 attachments");
  });

  it("never reads as zero (a labelled row always has at least one)", () => {
    expect(attachmentLabel("image", 0)).toBe("Photo");
  });
});

describe("sharedMediaKind", () => {
  it("returns the kind when every attachment agrees", () => {
    expect(sharedMediaKind(["image", "image"])).toBe("image");
    expect(sharedMediaKind(["audio"])).toBe("audio");
  });

  it("returns null for a mixed set (caller uses the neutral noun)", () => {
    expect(sharedMediaKind(["image", "audio"])).toBeNull();
  });

  it("returns null for nothing at all", () => {
    expect(sharedMediaKind([])).toBeNull();
  });
});
