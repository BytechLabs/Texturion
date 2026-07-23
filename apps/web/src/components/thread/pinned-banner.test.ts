import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/api/types";

import {
  MobilePinnedDisclosure,
  pinnedSnippet,
  sortPinned,
} from "./pinned-banner";

/** Minimal shape — the helpers only read body/attachments/pinned_at/id. */
const m = (over: Partial<Message>) => over as Message;

describe("pinnedSnippet", () => {
  it("shows the trimmed body when present", () => {
    expect(pinnedSnippet(m({ body: "  Gate code 4821 ", attachments: [] }))).toBe(
      "Gate code 4821",
    );
  });

  it("falls back to 'Photo' for an empty body with an image attachment", () => {
    expect(
      pinnedSnippet(
        m({
          body: "",
          attachments: [
            { id: "a", content_type: "image/jpeg" },
          ] as Message["attachments"],
        }),
      ),
    ).toBe("Photo");
  });

  it("names the non-image kind for an empty body (#189)", () => {
    const withType = (content_type: string) =>
      pinnedSnippet(
        m({
          body: "",
          attachments: [{ id: "a", content_type }] as Message["attachments"],
        }),
      );
    expect(withType("audio/amr")).toBe("Audio");
    expect(withType("video/mp4")).toBe("Video");
    expect(withType("text/vcard")).toBe("Contact card");
    expect(withType("application/pdf")).toBe("PDF");
  });

  it("falls back to 'Attachment' for an empty body and no attachments", () => {
    expect(pinnedSnippet(m({ body: "   ", attachments: [] }))).toBe("Attachment");
  });
});

describe("sortPinned", () => {
  it("keeps only pinned messages", () => {
    const out = sortPinned([
      m({ id: "a", pinned_at: "2026-07-04T10:00:00Z" }),
      m({ id: "b", pinned_at: null }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });

  it("orders newest pin first (pinned_at desc)", () => {
    const out = sortPinned([
      m({ id: "old", pinned_at: "2026-07-04T09:00:00Z" }),
      m({ id: "new", pinned_at: "2026-07-04T12:00:00Z" }),
      m({ id: "mid", pinned_at: "2026-07-04T10:30:00Z" }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["new", "mid", "old"]);
  });

  it("returns empty when nothing is pinned", () => {
    expect(sortPinned([m({ id: "a", pinned_at: null })])).toEqual([]);
  });
});

describe("MobilePinnedDisclosure (#76 mobile collapse)", () => {
  const pins = [
    m({ id: "a", pinned_at: "2026-07-04T12:00:00Z", body: "Gate code 4821", attachments: [] }),
    m({ id: "b", pinned_at: "2026-07-04T10:00:00Z", body: "Dog is friendly", attachments: [] }),
  ];

  it("shows a compact 'Pinned · N' summary, collapsed by default", () => {
    const html = renderToStaticMarkup(
      createElement(MobilePinnedDisclosure, { messages: pins, onJump: () => {} }),
    );
    expect(html).toContain("Pinned · 2");
    // Collapsed → the jump list and its rows/affordance are not rendered yet.
    expect(html).not.toContain("Jump");
    expect(html).not.toContain("Gate code 4821");
    expect(html).toContain('aria-expanded="false"');
  });

  it("drops the count for a single pin", () => {
    const html = renderToStaticMarkup(
      createElement(MobilePinnedDisclosure, {
        messages: [pins[0]],
        onJump: () => {},
      }),
    );
    expect(html).toContain("Pinned");
    expect(html).not.toContain("Pinned ·");
  });

  it("renders nothing when there are no pinned messages", () => {
    const html = renderToStaticMarkup(
      createElement(MobilePinnedDisclosure, { messages: [], onJump: () => {} }),
    );
    expect(html).toBe("");
  });
});
