import { describe, expect, it } from "vitest";

import type { GalleryItem } from "@/lib/api/types";

import {
  dateGroupLabel,
  fileLabel,
  formatBytes,
  groupByDate,
  itemsForTab,
  sourceLabel,
} from "./gallery-grouping";

function item(partial: Partial<GalleryItem>): GalleryItem {
  return {
    id: "id",
    source: "mms",
    kind: "image",
    file_name: null,
    content_type: "image/jpeg",
    size_bytes: null,
    created_at: "2026-07-02T10:00:00+00:00",
    url: "https://example/x",
    ...partial,
  };
}

describe("itemsForTab", () => {
  it("splits on the API's own kind field", () => {
    const items = [
      item({ id: "a", kind: "image" }),
      item({ id: "b", kind: "file" }),
      item({ id: "c", kind: "image" }),
    ];
    expect(itemsForTab(items, "images").map((i) => i.id)).toEqual(["a", "c"]);
    expect(itemsForTab(items, "files").map((i) => i.id)).toEqual(["b"]);
  });
});

describe("sourceLabel", () => {
  it("maps the canonical source enum to display tags", () => {
    expect(sourceLabel("mms")).toBe("Message");
    expect(sourceLabel("note")).toBe("Note");
    expect(sourceLabel("task")).toBe("Task");
  });
});

// Anchor test timestamps to the runner's LOCAL calendar days (the grouping,
// like the user's view, is in local time via date-fns isToday/isYesterday).
// Building the ISO strings from local Date components keeps the day boundaries
// unambiguous regardless of the runner's timezone offset.
function atLocal(daysAgo: number, hour: number, base = new Date()): string {
  const d = new Date(base);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe("dateGroupLabel", () => {
  const now = new Date(2026, 6, 2, 12, 0, 0); // Jul 2 2026, local noon
  it("labels today / yesterday relatively", () => {
    expect(dateGroupLabel(atLocal(0, 9, now), now)).toBe("Today");
    expect(dateGroupLabel(atLocal(1, 9, now), now)).toBe("Yesterday");
  });
  it("drops the year within the current year, keeps it otherwise", () => {
    expect(dateGroupLabel(new Date(2026, 4, 4, 9).toISOString(), now)).toBe(
      "May 4",
    );
    expect(
      dateGroupLabel(new Date(2025, 11, 31, 9).toISOString(), now),
    ).toBe("December 31, 2025");
  });
});

describe("groupByDate", () => {
  it("folds a DESC-sorted list into contiguous groups without re-sorting", () => {
    const now = new Date(2026, 6, 2, 23, 0, 0);
    const items = [
      item({ id: "1", created_at: atLocal(0, 11, now) }),
      item({ id: "2", created_at: atLocal(0, 9, now) }),
      item({ id: "3", created_at: atLocal(1, 9, now) }),
    ];
    const groups = groupByDate(items, now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["1", "2"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["3"]);
  });
});

describe("formatBytes", () => {
  it("scales B / KB / MB and null-guards", () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("fileLabel", () => {
  it("prefers the stored name, else derives from the content type", () => {
    expect(fileLabel(item({ file_name: "quote.pdf" }))).toBe("quote.pdf");
    expect(fileLabel(item({ file_name: null, content_type: "application/pdf" }))).toBe(
      "PDF file",
    );
    expect(fileLabel(item({ file_name: null, content_type: null }))).toBe("File");
  });
});
