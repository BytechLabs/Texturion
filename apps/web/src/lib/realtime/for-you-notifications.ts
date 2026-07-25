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

/**
 * How long one refetch covers everything that follows it.
 *
 * A microtask was not enough. Cache updates arrive on their OWN macrotasks —
 * one per query settling, and an app boot settles a lot of them (several
 * conversation lists, tasks, plus whatever the prefetched routes mount) — so
 * every single one got its own refetch. A page refresh made 27 identical
 * /for-you calls and 27 unread-count calls in 1.6 seconds, each with its own
 * CORS preflight: 108 requests where 2 would do.
 *
 * This window is long enough to swallow a boot or a burst of broadcasts, and
 * short enough that a badge still moves while you are looking at it.
 */
const COALESCE_MS = 400;

export function useForYouNotificationsRealtime() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let coolingDown = false;
    let missedDuringCooldown = false;

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

    /**
     * Leading edge, then a quiet window. The first change refetches straight
     * away so the queue and the badge stay responsive; anything that lands
     * during the window is collapsed into at most ONE further refetch when it
     * closes. Cache events fire synchronously, often mid-render of a list, so
     * the leading call is deferred to a microtask to stay out of render.
     */
    const schedule = () => {
      if (coolingDown) {
        missedDuringCooldown = true;
        return;
      }
      coolingDown = true;
      queueMicrotask(() => {
        if (!disposed) invalidate();
      });
      timer = setTimeout(() => {
        coolingDown = false;
        timer = null;
        if (missedDuringCooldown) {
          missedDuringCooldown = false;
          if (!disposed) schedule();
        }
      }, COALESCE_MS);
    };

    const unsubscribe = cache.subscribe((event) => {
      // Only real data changes should trigger a refetch. 'updated' covers
      // setQueryData patches AND fetch successes; skipping the rest drops the
      // observerAdded/observerRemoved/observerResultsUpdated churn that fired on
      // every mount/unmount and forced needless network round-trips.
      if (event.type !== "updated") return;
      if (feedsForYouOrBell(event.query.queryKey as readonly unknown[], companyId)) {
        schedule();
      }
    });

    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [companyId, queryClient]);
}
