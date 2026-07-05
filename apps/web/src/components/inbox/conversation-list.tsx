"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  useConversations,
  usePinnedConversations,
} from "@/lib/api/conversations";
import type { ConversationFilters } from "@/lib/api/filters";
import { flattenPages } from "@/lib/api/pagination";
import { prefersReducedMotion } from "@/lib/motion";

import { ConversationRow, ROW_HEIGHT } from "./conversation-row";
import {
  ActivationEmptyState,
  FilteredEmptyState,
  ListSkeleton,
} from "./empty-states";

/** Vertical gap between elevated rows (mockup .rows gap). The virtualizer slot
 * is the row box + this gap so absolute offsets leave air between cards. */
const ROW_GAP = 4;
const ROW_SLOT = ROW_HEIGHT + ROW_GAP;

/**
 * FLIP the rows that moved (G4: realtime re-sort animated, subtle). Runs
 * against the virtualizer's absolute offsets: any row whose offset changed
 * since the last layout animates from its old position over 200ms ease-out.
 *
 * `prefers-reduced-motion` must be checked in JS here: this is a scripted
 * WAAPI animation, which the globals.css media query does NOT zero (that rule
 * only affects CSS transitions/animations). When the viewer asked to reduce
 * motion — or WAAPI is unavailable — the offsets are still recorded so the
 * next real move animates correctly, but no animation plays now.
 */
function useFlipRows(
  rowElements: React.RefObject<Map<string, HTMLElement>>,
  offsets: Map<string, number>,
) {
  const previous = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const prev = previous.current;
    const animate = !prefersReducedMotion();
    if (animate) {
      for (const [id, offset] of offsets) {
        const before = prev.get(id);
        const el = rowElements.current.get(id);
        if (
          before !== undefined &&
          before !== offset &&
          el &&
          typeof el.animate === "function"
        ) {
          el.animate(
            [
              { transform: `translateY(${before - offset}px)` },
              { transform: "translateY(0px)" },
            ],
            { duration: 200, easing: "ease-out" },
          );
        }
      }
    }
    previous.current = offsets;
  }, [offsets, rowElements]);
}

export function ConversationList({
  filters,
  hasUrlFilters,
  activeConversationId,
}: {
  filters: ConversationFilters;
  hasUrlFilters: boolean;
  activeConversationId: string | null;
}) {
  const query = useConversations(filters);
  // #13: pinned threads come complete + server-ordered (pinned_at desc) from
  // their own query, so a pin past the loaded pages still shows at the top. We
  // filter pins out of the main rows to avoid a duplicate; the main list + its
  // keyset cursor are unchanged.
  const pinnedQuery = usePinnedConversations(filters);
  const pinnedRows = pinnedQuery.data?.data ?? [];
  const pinnedIds = new Set(pinnedRows.map((row) => row.id));
  // Dedup by id (not "drop every pin") so a pin beyond the supplement's page
  // still shows via the main list rather than vanishing.
  const rows = [
    ...pinnedRows,
    ...flattenPages(query.data).filter((row) => !pinnedIds.has(row.id)),
  ];

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowElements = useRef<Map<string, HTMLElement>>(new Map());

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_SLOT,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // FLIP: current offsets per conversation id.
  const offsets = new Map<string, number>();
  for (const item of virtualItems) {
    const row = rows[item.index];
    if (row) offsets.set(row.id, item.start);
  }
  useFlipRows(rowElements, offsets);

  // Infinite scroll: fetch the next cursor page as the end approaches.
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (
      rows.length > 0 &&
      lastIndex >= rows.length - 5 &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      void query.fetchNextPage();
    }
  }, [lastIndex, rows.length, query]);

  // Skeleton on FIRST load only (G4) — realtime updates never skeleton.
  if (query.isPending) return <ListSkeleton />;

  if (query.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load your conversations. Check your connection and
          try again.
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return hasUrlFilters ? <FilteredEmptyState /> : <ActivationEmptyState />;
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-3 pt-1.5"
    >
      <div
        role="list"
        aria-label="Conversations"
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={item.key}
              role="listitem"
              data-index={item.index}
              ref={(el) => {
                if (el) rowElements.current.set(row.id, el);
                else rowElements.current.delete(row.id);
              }}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <ConversationRow
                conversation={row}
                active={row.id === activeConversationId}
                spamView={filters.is_spam === true}
              />
            </div>
          );
        })}
      </div>
      {query.isFetchingNextPage && (
        <p className="p-3 text-center text-xs text-muted-foreground">
          Loading more…
        </p>
      )}
    </div>
  );
}
