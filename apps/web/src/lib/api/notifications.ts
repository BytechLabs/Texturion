import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { NotificationPrefs, PushSubscriptionRow } from "./types";

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

/**
 * POST /v1/push-subscriptions — register a PushSubscription.toJSON() payload
 * (VAPID Web Push, SPEC §8). Permission is requested only from settings or
 * the first-visit card — never an ambush (G8).
 */
export function useCreatePushSubscription() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (input: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }) =>
      apiFetch<PushSubscriptionRow>("/v1/push-subscriptions", {
        method: "POST",
        companyId,
        body: input,
      }),
  });
}

/** DELETE /v1/push-subscriptions/:id — caller's own subscription only. */
export function useDeletePushSubscription() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (subscriptionId: string) =>
      apiFetch<void>(`/v1/push-subscriptions/${subscriptionId}`, {
        method: "DELETE",
        companyId,
      }),
  });
}
