import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type {
  MarkReadResult,
  NotificationItem,
  NotificationPrefs,
  Page,
  UnreadCount,
} from "./types";

/*
 * Push subscribe/unsubscribe (POST/DELETE /v1/push-subscriptions) is NOT a
 * mutation hook. The real path lives in the framework-free push machine
 * (lib/push/subscription-machine.ts) — it must interleave subscribe with the
 * browser permission prompt and PushManager calls, none of which a TanStack
 * mutation can express, so the machine calls apiFetch directly (unit-tested
 * with a stubbed PushManager). Standalone useCreate/useDeletePushSubscription
 * hooks were dead exports duplicating those calls and have been removed to
 * keep a single subscribe code path (see lib/push/use-push-subscription.ts).
 */

/** GET /v1/notification-prefs — per-user email/push toggles (G8). */
export function useNotificationPrefs() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.notificationPrefs(companyId),
    queryFn: () =>
      apiFetch<NotificationPrefs>("/v1/notification-prefs", { companyId }),
  });
}

/** PUT /v1/notification-prefs — upsert both toggles. */
export function useUpdateNotificationPrefs() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPrefs) =>
      apiFetch<NotificationPrefs>("/v1/notification-prefs", {
        method: "PUT",
        companyId,
        body: prefs,
      }),
    onMutate: async (prefs) => {
      // Toggles flip instantly; roll back on failure.
      const key = keys.notificationPrefs(companyId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationPrefs>(key);
      queryClient.setQueryData(key, prefs);
      return { previous };
    },
    onError: (_error, _prefs, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          keys.notificationPrefs(companyId),
          context.previous,
        );
      }
    },
    onSuccess: (prefs) => {
      queryClient.setQueryData(keys.notificationPrefs(companyId), prefs);
    },
  });
}

// ---------------------------------------------------------------------------
// D24 notifications read-model — the bell badge + popover feed. Everything is
// DERIVED server-side (no feed table); the read/unread dot rides a per-user
// last-seen watermark, so "mark read" is a watermark advance, not a per-row
// write. The client mirrors that: it stamps the watermark forward and clears
// its own `unread` dots optimistically, then re-reads.
// ---------------------------------------------------------------------------

/**
 * How often the bell badge polls when idle. Realtime is the LIVE path — the
 * for-you/notifications subscription invalidates this key on every inbound /
 * assign broadcast — so this poll is only a drift-correction fallback for the
 * rare thing that isn't broadcast. It was 60s, which meant every open tab hit
 * the API every minute forever (the single largest source of idle request
 * volume, and Workers bill per request). Five minutes keeps the fallback honest
 * at a fifth of the cost; a genuinely missed count self-heals on the next
 * broadcast, the next away-resync, or within 5 minutes.
 */
const UNREAD_POLL_MS = 5 * 60_000;

/**
 * GET /v1/notifications/unread-count — the bell badge count. Kept live by both
 * the realtime provider (invalidated on inbound/assign broadcasts) and a slow
 * background poll as a belt-and-suspenders for anything not broadcast.
 */
export function useNotificationsUnreadCount() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.notifications.unreadCount(companyId),
    queryFn: () =>
      apiFetch<UnreadCount>("/v1/notifications/unread-count", { companyId }),
    staleTime: 15_000,
    refetchInterval: UNREAD_POLL_MS,
  });
}

/**
 * GET /v1/notifications — the popover feed, cursor-paginated (created_at, id)
 * DESC (SPEC §7). Fetched lazily by the popover (the caller passes
 * `enabled: open`) so a closed bell costs nothing.
 */
export function useNotificationsFeed(enabled: boolean) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: keys.notifications.feed(companyId),
    queryFn: ({ pageParam }) =>
      apiFetch<Page<NotificationItem>>("/v1/notifications", {
        companyId,
        searchParams: { cursor: pageParam, limit: 25 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
    enabled,
    staleTime: 15_000,
  });
}

/** The bell popover's infinite-feed cache entry shape. */
type NotificationFeedData = InfiniteData<Page<NotificationItem>>;

/**
 * Mark-all-read: return feed data with every `unread` dot cleared. Pure — the
 * optimistic mirror of the watermark advance to now.
 */
export function markFeedAllRead(
  data: NotificationFeedData | undefined,
): NotificationFeedData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      data: page.data.map((item) =>
        item.unread ? { ...item, unread: false } : item,
      ),
    })),
  };
}

/** Flip every cached feed item's `unread` dot to false (watermark advanced). */
function clearFeedUnread(companyId: string, queryClient: QueryClient) {
  queryClient.setQueryData<NotificationFeedData>(
    keys.notifications.feed(companyId),
    (data) => markFeedAllRead(data),
  );
}

/**
 * POST /v1/notifications/mark-all-read — advance the watermark to now, so every
 * current item reads as read. Optimistic: the badge zeroes and every feed dot
 * clears at click; the server confirms the stamped watermark.
 */
export function useMarkAllNotificationsRead() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<MarkReadResult>("/v1/notifications/mark-all-read", {
        method: "POST",
        companyId,
      }),
    onMutate: async () => {
      const countKey = keys.notifications.unreadCount(companyId);
      await queryClient.cancelQueries({ queryKey: countKey });
      const previousCount = queryClient.getQueryData<UnreadCount>(countKey);
      // #343: SPREAD, never replace. A bare `{ count: 0 }` drops alert_pause,
      // so marking everything read would silently hide a "notifications are
      // paused" line that is still true.
      queryClient.setQueryData<UnreadCount>(countKey, (current) => ({
        ...current,
        count: 0,
      }));
      clearFeedUnread(companyId, queryClient);
      return { previousCount };
    },
    onError: (_error, _vars, context) => {
      if (context?.previousCount) {
        queryClient.setQueryData(
          keys.notifications.unreadCount(companyId),
          context.previousCount,
        );
      }
      // Re-read the feed so the dots we optimistically cleared come back right.
      queryClient.invalidateQueries({
        queryKey: keys.notifications.feed(companyId),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: keys.notifications.unreadCount(companyId),
      });
    },
  });
}

/**
 * Per-item read: return feed data with the `unread` dot cleared on the ONE item
 * with this id, leaving every other item — newer AND older — exactly as it was.
 * Pure — the optimistic mirror of POST /v1/notifications/:id/read.
 */
export function markFeedReadItem(
  data: NotificationFeedData | undefined,
  id: string,
): NotificationFeedData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      data: page.data.map((item) =>
        item.id === id && item.unread ? { ...item, unread: false } : item,
      ),
    })),
  };
}

/**
 * POST /v1/notifications/:id/read — mark ONE notification read (#188). Older
 * notifications stay unread, which is the whole point: opening the newest thing
 * in the list must not silently bury the three below it you have not looked at.
 * Both phone apps already read this way; this is the same behaviour on web.
 *
 * `created_at` rides along exactly as the feed returned it — the server matches
 * on it, and re-serializing a Date drops the milliseconds that make it match.
 * Optimistic: the tapped dot clears and the badge drops by one.
 */
export function useMarkNotificationReadItem() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: { id: string; created_at: string }) =>
      apiFetch<MarkReadResult>(
        `/v1/notifications/${encodeURIComponent(item.id)}/read`,
        {
          method: "POST",
          companyId,
          body: { created_at: item.created_at },
        },
      ),
    onMutate: async (item) => {
      const countKey = keys.notifications.unreadCount(companyId);
      const feedKey = keys.notifications.feed(companyId);
      await queryClient.cancelQueries({ queryKey: countKey });
      const previousCount = queryClient.getQueryData<UnreadCount>(countKey);
      queryClient.setQueryData<UnreadCount>(countKey, (current) =>
        // #343: spread, for the same reason as mark-all-read above.
        current ? { ...current, count: Math.max(0, current.count - 1) } : current,
      );
      queryClient.setQueryData<NotificationFeedData>(feedKey, (data) =>
        markFeedReadItem(data, item.id),
      );
      return { previousCount };
    },
    onError: (_error, _item, context) => {
      if (context?.previousCount) {
        queryClient.setQueryData(
          keys.notifications.unreadCount(companyId),
          context.previousCount,
        );
      }
      // Re-read the feed so the dot we optimistically cleared comes back right.
      queryClient.invalidateQueries({
        queryKey: keys.notifications.feed(companyId),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: keys.notifications.unreadCount(companyId),
      });
    },
  });
}
