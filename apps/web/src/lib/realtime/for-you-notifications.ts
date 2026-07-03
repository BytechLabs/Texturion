"use client";

/**
 * Keeps the derived /for-you queue (D23) and the notifications bell (D24) live
 * without a second realtime channel. Both are server-derived over conversations
 * / messages / tasks; the shared RealtimeProvider (lib/realtime/provider.tsx)
 * already patches THOSE caches on every §8 broadcast (message.created,
 * message.status, conversation.updated) and refetches page 1 on reconnect.
 *
 * This hook rides that existing signal: it watches the Query cache and, when a
 * conversation list / thread / tasks query for the active company changes, it
 * invalidates the for-you queue and the notifications feed + unread count so
 * the server re-derives them. That means:
 *   - an inbound message (message.created patches a conversation list) →
 *     for-you + bell refresh,
 *   - a done toggle or status/assign change (message.status /
 *     conversation.updated patch the thread + detail) → for-you refresh,
 *   - a task create/assign/due (tasks lists/checklist change) → for-you refresh.
 *
 * One shared instance is enough; it is mounted once from the app shell region
 * that always renders (the bell). Invalidations are coalesced to a microtask so
 * a burst of cache events costs one refetch, and skipped while nothing that
 * feeds these read-models actually changed.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { keys } from "@/lib/api/keys";
import { useCompanyId } from "@/lib/company/provider";

/** Query-key roots whose changes can move the for-you queue or the bell feed. */
function feedsForYouOrBell(key: readonly unknown[], companyId: string): boolean {
  if (key[0] !== companyId) return false;
  // conversations list rows carry unread + assignment (waiting/unread sections);
  // message threads carry done state (task completion); tasks lists/checklist
  // carry the my_tasks / triage sections.
  return key[1] === "conversations" || key[1] === "messages" || key[1] === "tasks";
}

export function useForYouNotificationsRealtime() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    let scheduled = false;
    let disposed = false;

    const invalidate = () => {
      queryClient.invalidateQueries({
        queryKey: keys.forYou(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.notifications.unreadCount(companyId),
      });
      queryClient.invalidateQueries({
        queryKey: keys.notifications.feed(companyId),
        refetchType: "active",
      });
    };

    // Cache events fire synchronously (often mid-render of a list component);
    // defer to a microtask both to stay out of render and to coalesce bursts.
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) invalidate();
      });
    };

    const unsubscribe = cache.subscribe((event) => {
      if (feedsForYouOrBell(event.query.queryKey as readonly unknown[], companyId)) {
        schedule();
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [companyId, queryClient]);
}
