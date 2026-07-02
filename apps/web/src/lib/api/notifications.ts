import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { NotificationPrefs } from "./types";

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
