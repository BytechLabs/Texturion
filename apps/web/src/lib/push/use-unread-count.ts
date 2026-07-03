"use client";

/**
 * useUnreadConversationCount — the single derived unread-conversation count,
 * shared by the G9 document-title/favicon manager (use-unread-title.ts) and the
 * APP-LAYOUT-V2 §1.3 nav-rail Inbox numeral.
 *
 * One source of truth (G12): it keeps the default inbox list alive (same query
 * key as the inbox screen — no extra traffic when the inbox is open, realtime
 * patches reach it either way) and recomputes from EVERY cached conversation
 * list on any cache change, deduplicating by conversation id. The rail renders
 * this as a quiet stone tabular numeral; the row renders unread as a petrol dot
 * — the same fact at two altitudes (§1.3), both fed from here.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useConversations } from "@/lib/api/conversations";
import { keys } from "@/lib/api/keys";
import { useCompanyId } from "@/lib/company/provider";

import { countUnreadConversations, type UnreadCountableList } from "./title";

export function useUnreadConversationCount(): number {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();

  // Keep the default inbox list alive everywhere in the shell so the count
  // exists on /settings, /contacts, … — same query key as the inbox screen's
  // unfiltered list (normalizeFilters({}) === {}), so no extra traffic when
  // the inbox is open, and realtime patches reach it either way.
  useConversations({});

  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    let disposed = false;
    let scheduled = false;
    const compute = () => {
      const lists = cache
        .findAll({ queryKey: keys.conversations.lists(companyId) })
        .map((query) => query.state.data as UnreadCountableList | undefined);
      setUnread(countUnreadConversations(lists));
    };
    // Cache events fire synchronously — including from inside ANOTHER
    // component's render (list components seed queries while rendering).
    // setState there is a React error, so recomputes are deferred to a
    // microtask, which also coalesces event bursts into one recompute.
    const scheduleCompute = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) compute();
      });
    };
    compute();
    const unsubscribe = cache.subscribe((event) => {
      const key = event.query.queryKey as readonly unknown[];
      if (
        key[0] === companyId &&
        key[1] === "conversations" &&
        key[2] === "list"
      ) {
        scheduleCompute();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [companyId, queryClient]);

  return unread;
}
