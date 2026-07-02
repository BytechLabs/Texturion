import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  dedupeById,
  flattenPages,
  nextCursorParam,
  trimToFirstPage,
} from "./pagination";
import type { Page } from "./types";

interface Row {
  id: string;
  label?: string;
}

function infinite(pages: Page<Row>[]): InfiniteData<Page<Row>> {
  return {
    pages,
    pageParams: pages.map((_, index) =>
      index === 0 ? undefined : `cursor-${index}`,
    ),
  };
}

describe("cursor infinite-page merging (SPEC §7)", () => {
  it("flattens pages preserving order", () => {
    const data = infinite([
      { data: [{ id: "a" }, { id: "b" }], next_cursor: "c1" },
      { data: [{ id: "c" }, { id: "d" }], next_cursor: null },
    ]);
    expect(flattenPages(data).map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("dedupes by id across pages — first occurrence wins (mutable-key caveat)", () => {
    // A conversation bumped between page fetches appears on page 1 AND page 2;
    // page 1 was refetched more recently, so its copy is authoritative.
    const data = infinite([
      {
        data: [
          { id: "a", label: "fresh" },
          { id: "b", label: "fresh" },
        ],
        next_cursor: "c1",
      },
      {
        data: [
          { id: "b", label: "stale" },
          { id: "c", label: "fresh" },
        ],
        next_cursor: null,
      },
    ]);
    const rows = flattenPages(data);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows.find((row) => row.id === "b")?.label).toBe("fresh");
  });

  it("returns an empty array for undefined data", () => {
    expect(flattenPages<Row>(undefined)).toEqual([]);
  });

  it("dedupeById keeps duplicates out within a single list", () => {
    expect(
      dedupeById([{ id: "x" }, { id: "y" }, { id: "x" }]).map((r) => r.id),
    ).toEqual(["x", "y"]);
  });

  it("nextCursorParam maps null to undefined (stop paging)", () => {
    expect(nextCursorParam({ data: [], next_cursor: null })).toBeUndefined();
    expect(nextCursorParam({ data: [], next_cursor: "abc" })).toBe("abc");
  });

  it("trimToFirstPage drops pages and pageParams past the first", () => {
    const data = infinite([
      { data: [{ id: "a" }], next_cursor: "c1" },
      { data: [{ id: "b" }], next_cursor: null },
    ]);
    const trimmed = trimToFirstPage(data);
    expect(trimmed.pages).toHaveLength(1);
    expect(trimmed.pageParams).toHaveLength(1);
    expect(trimmed.pages[0].data[0].id).toBe("a");
    // Single-page data is returned by reference (no pointless copies).
    const single = infinite([{ data: [{ id: "a" }], next_cursor: null }]);
    expect(trimToFirstPage(single)).toBe(single);
  });
});
