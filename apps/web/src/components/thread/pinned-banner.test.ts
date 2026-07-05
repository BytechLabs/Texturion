import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/api/types";

import { pinnedSnippet, sortPinned } from "./pinned-banner";

/** Minimal shape — the helpers only read body/attachments/pinned_at/id. */
const m = (over: Partial<Message>) => over as Message;

describe("pinnedSnippet", () => {
  it("shows the trimmed body when present", () => {
    expect(pinnedSnippet(m({ body: "  Gate code 4821 ", attachments: [] }))).toBe(
      "Gate code 4821",
    );
  });

  it("falls back to 'Photo' for an empty body with attachments", () => {
    expect(
      pinnedSnippet(
        m({ body: "", attachments: [{ id: "a" }] as Message["attachments"] }),
      ),
    ).toBe("Photo");
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
