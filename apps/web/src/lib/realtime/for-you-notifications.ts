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
 *   - a status/assign change (conversation.updated patches the list rows and
 *     the detail) → for-you + bell refresh,
 *   - a task create/assign/due (tasks lists/checklist change) → for-you refresh.
 *
 * Delivery receipts, done toggles and read echoes are written through
 * `patchQuietly`: the provider refreshes the queue itself when one of them can
 * move it, and none of them can move the bell.
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
  switch (key[1]) {
    case "conversations":
      return key[2] === "list" || key[2] === "pinned" || key[2] === "detail";
    case "messages":
      return true;
    case "tasks":
      return key[2] === "list" || key[2] === "checklist";
    default:
      return false;
  }
}

let quietWrites = 0;

/** Runs cache writes that move neither the queue nor the bell without the listener below reacting. */
export function patchQuietly(write: () => void): void {
  quietWrites += 1;
  try {
    write();
  } finally {
    quietWrites -= 1;
  }
}

/**
 * How long one refetch covers everything that follows it.
 *
 * A microtask is not enough: cache updates arrive on their OWN macrotasks, one
 * per query settling, and an app boot settles a lot of them — so each would
 * otherwise buy its own refetch of the queue and the badge, with a CORS
 * preflight apiece.
 *
 * This window is long enough to swallow a boot or a burst of broadcasts, and
 * short enough that a badge still moves while you are looking at it.
 */
const COALESCE_MS = 400;

/**
 * One subscription per company, however many components ask for it.
 *
 * The hook is mounted by more than one always-present component (the bell and
 * the mobile tab bar), and each mount used to build its OWN cache subscription
 * with its own coalescing window. They are independent, so they never collapse
 * into each other: every settling query bought a refetch of the queue and the
 * badge PER MOUNT. A page load fired six of each, in simultaneous pairs, with a
 * CORS preflight apiece.
 *
 * Ref-counted so the last consumer to leave tears it down.
 */
const subscriptions = new Map<
  string,
  { count: number; dispose: () => void }
>();

function acquireSubscription(
  companyId: string,
  start: () => () => void,
): () => void {
  const existing = subscriptions.get(companyId);
  if (existing) {
    existing.count += 1;
  } else {
    subscriptions.set(companyId, { count: 1, dispose: start() });
  }
  return () => {
    const entry = subscriptions.get(companyId);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) {
      entry.dispose();
      subscriptions.delete(companyId);
    }
  };
}

export function useForYouNotificationsRealtime() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();

  useEffect(() => {
    return acquireSubscription(companyId, () => {
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

    // The data each query held when last seen. 'updated' is dispatched for
    // every action on a query: a fetch starting, an invalidation, an error, a
    // refetch landing, a patch. Only a success can change data, and only when
    // it brings a new object: a refetch that returned the same JSON keeps its
    // reference, and so does a patch that changed nothing. Reacting to the rest
    // turned one thread open into four refetches of the queue and the badge.
    const seen = new WeakMap<object, unknown>();
    for (const query of cache.getAll()) seen.set(query, query.state.data);

    const unsubscribe = cache.subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const { query } = event;
      const before = seen.get(query);
      seen.set(query, query.state.data);
      if (before === query.state.data || quietWrites > 0) return;
      // A query loading for the FIRST time is not a change to react to, it is
      // the app arriving. On boot every watched list settles at once, and each
      // one bought a refetch of the queue and the badge that had just been
      // fetched anyway. Only a query that already had data and then changed
      // means something actually moved.
      if (query.state.dataUpdateCount <= 1) return;
      if (feedsForYouOrBell(query.queryKey as readonly unknown[], companyId)) {
        schedule();
      }
    });

    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
    });
  }, [companyId, queryClient]);
}
