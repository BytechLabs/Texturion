import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { NotificationItem, Page } from "./types";

// notifications.ts transitively imports the API client, whose env module
// validates NEXT_PUBLIC_* at import time. Stub the required values (test
// fixtures, not product configuration) before importing the module under test.
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.local");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key");
vi.stubEnv("NEXT_PUBLIC_API_URL", "https://stub-api.local");

const { feedUnreadAtOrBefore, markFeedReadBefore } = await import(
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
// markFeedReadBefore — the optimistic mirror of the mark-read watermark advance
// ---------------------------------------------------------------------------

describe("markFeedReadBefore", () => {
  it("clears the dot on the target and everything older, leaving newer unread", () => {
    const data = feed([
      item("a", T.newest, true),
      item("b", T.mid, true),
      item("c", T.old, true),
    ]);

    const next = markFeedReadBefore(data, T.mid);
    const flat = next!.pages.flatMap((page) => page.data);

    expect(flat.map((i) => [i.id, i.unread])).toEqual([
      ["a", true], // newer than the watermark: still unread
      ["b", false], // the clicked item
      ["c", false], // older than the watermark: reaches into page 2
    ]);
  });

  it("null watermark (mark-all) clears every unread dot", () => {
    const data = feed([
      item("a", T.newest, true),
      item("b", T.mid, false),
      item("c", T.old, true),
    ]);

    const flat = markFeedReadBefore(data, null)!.pages.flatMap((p) => p.data);
    expect(flat.every((i) => !i.unread)).toBe(true);
  });

  it("does not mutate the input data or its items", () => {
    const data = feed([item("a", T.newest, true), item("b", T.mid, true)]);
    markFeedReadBefore(data, T.newest);
    expect(data.pages[0].data[0].unread).toBe(true);
    expect(data.pages[0].data[1].unread).toBe(true);
  });

  it("returns undefined untouched when there is no cache entry", () => {
    expect(markFeedReadBefore(undefined, T.mid)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// feedUnreadAtOrBefore — the optimistic badge decrement
// ---------------------------------------------------------------------------

describe("feedUnreadAtOrBefore", () => {
  it("counts only unread items at or older than the watermark", () => {
    const data = feed([
      item("a", T.newest, true), // newer: excluded
      item("b", T.mid, true), // at watermark: counted
      item("c", T.old, false), // older but already read: excluded
    ]);
    expect(feedUnreadAtOrBefore(data, T.mid)).toBe(1);
  });

  it("null watermark counts every unread item across pages", () => {
    const data = feed([
      item("a", T.newest, true),
      item("b", T.mid, false),
      item("c", T.old, true),
    ]);
    expect(feedUnreadAtOrBefore(data, null)).toBe(2);
  });

  it("is zero when the cache is empty", () => {
    expect(feedUnreadAtOrBefore(undefined, T.mid)).toBe(0);
  });
});
