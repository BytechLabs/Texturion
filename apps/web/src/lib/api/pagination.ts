import type { InfiniteData } from "@tanstack/react-query";

import type { Page } from "./types";

/**
 * Cursor-page helpers (SPEC §7): lists are `{ data, next_cursor }` keyed on a
 * mutable sort key for conversations — so "clients dedupe by id" is part of
 * the API contract, implemented here once for every infinite list.
 */

/** First occurrence wins: earlier pages are fresher (page 1 is refetched first). */
export function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Flatten an infinite query's pages into one deduped array, page order kept. */
export function flattenPages<T extends { id: string }>(
  data: InfiniteData<Page<T>> | undefined,
): T[] {
  if (!data) return [];
  return dedupeById(data.pages.flatMap((page) => page.data));
}

/** `getNextPageParam` for every SPEC §7 cursor list. */
export function nextCursorParam<T>(lastPage: Page<T>): string | undefined {
  return lastPage.next_cursor ?? undefined;
}

/**
 * Drop everything after page 1 (used on realtime reconnect: refetch page 1
 * of active queries without re-walking every loaded page — G12).
 */
export function trimToFirstPage<T>(
  data: InfiniteData<Page<T>>,
): InfiniteData<Page<T>> {
  if (data.pages.length <= 1) return data;
  return {
    pages: data.pages.slice(0, 1),
    pageParams: data.pageParams.slice(0, 1),
  };
}
