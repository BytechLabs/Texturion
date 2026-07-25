import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { NotificationItem, Page } from "./types";

// notifications.ts transitively imports the API client, whose env module
// validates NEXT_PUBLIC_* at import time. Stub the required values (test
// fixtures, not product configuration) before importing the module under test.
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.local");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key");
vi.stubEnv("NEXT_PUBLIC_API_URL", "https://stub-api.local");

const { markFeedAllRead, markFeedReadItem } = await import(
  "./notifications"
);

// ---------------------------------------------------------------------------
// Fixtures — a newest-first derived feed (created_at, id) DESC (SPEC §7).
// ---------------------------------------------------------------------------

const T = {
  newest: "2026-06-01T12:00:00.000Z",
  mid: "2026-06-01T11:00:00.000Z",
  old: "2026-06-01T10:00:00.000Z",
} as const;

function item(
  id: string,
  createdAt: string,
  unread: boolean,
): NotificationItem {
  return {
    id,
    type: "inbound_message",
    conversation_id: `conv-${id}`,
    message_id: `msg-${id}`,
    task_id: null,
    contact: { id: `contact-${id}`, name: `Contact ${id}`, phone_e164: "+14165550100" },
    created_at: createdAt,
    unread,
  };
}

/** Two pages so we prove the transform reaches past page 1. */
function feed(items: NotificationItem[]): InfiniteData<Page<NotificationItem>> {
  return {
    pages: [
      { data: items.slice(0, 2), next_cursor: "cursor-1" },
      { data: items.slice(2), next_cursor: null },
    ],
    pageParams: [undefined, "cursor-1"],
  };
}

// ---------------------------------------------------------------------------
// markFeedReadItem — the optimistic mirror of the per-item read (#188)
// ---------------------------------------------------------------------------

describe("markFeedReadItem", () => {
  it("clears the dot on exactly one item, leaving newer AND older unread", () => {
    const data = feed([
      item("a", T.newest, true),
      item("b", T.mid, true),
      item("c", T.old, true),
    ]);

    const flat = markFeedReadItem(data, "b")!.pages.flatMap((p) => p.data);

    // The whole reason this replaced the watermark advance: reading one thing
    // must not bury the ones under it.
    expect(flat.map((i) => [i.id, i.unread])).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
    ]);
  });

  it("reaches items on later loaded pages", () => {
    const data = feed([
      item("a", T.newest, true),
      item("b", T.mid, true),
      item("c", T.old, true),
    ]);
    const flat = markFeedReadItem(data, "c")!.pages.flatMap((p) => p.data);
    expect(flat.find((i) => i.id === "c")!.unread).toBe(false);
  });

  it("does not mutate the input data or its items", () => {
    const data = feed([item("a", T.newest, true), item("b", T.mid, true)]);
    markFeedReadItem(data, "a");
    expect(data.pages[0].data[0].unread).toBe(true);
  });

  it("an unknown id changes nothing", () => {
    const data = feed([item("a", T.newest, true)]);
    const flat = markFeedReadItem(data, "nope")!.pages.flatMap((p) => p.data);
    expect(flat[0].unread).toBe(true);
  });

  it("returns undefined untouched when there is no cache entry", () => {
    expect(markFeedReadItem(undefined, "a")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// markFeedAllRead — the optimistic mirror of the watermark advance to now
// ---------------------------------------------------------------------------

describe("markFeedAllRead", () => {
  it("clears every unread dot across every loaded page", () => {
    const data = feed([
      item("a", T.newest, true),
      item("b", T.mid, false),
      item("c", T.old, true),
    ]);
    const flat = markFeedAllRead(data)!.pages.flatMap((p) => p.data);
    expect(flat.every((i) => !i.unread)).toBe(true);
  });

  it("does not mutate the input data or its items", () => {
    const data = feed([item("a", T.newest, true)]);
    markFeedAllRead(data);
    expect(data.pages[0].data[0].unread).toBe(true);
  });

  it("returns undefined untouched when there is no cache entry", () => {
    expect(markFeedAllRead(undefined)).toBeUndefined();
  });
});
