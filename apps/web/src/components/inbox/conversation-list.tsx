"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useConversations } from "@/lib/api/conversations";
import type { ConversationFilters } from "@/lib/api/filters";
import { flattenPages } from "@/lib/api/pagination";
import { prefersReducedMotion } from "@/lib/motion";

import { ConversationRow } from "./conversation-row";
import {
  ActivationEmptyState,
  FilteredEmptyState,
  ListSkeleton,
} from "./empty-states";

const ROW_HEIGHT = 68;

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
  const rows = flattenPages(query.data);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowElements = useRef<Map<string, HTMLElement>>(new Map());

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
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
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
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
