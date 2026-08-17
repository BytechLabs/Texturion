import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "./client";
import { useCompanyId } from "@/lib/company/provider";

/**
 * #245 — your own schedule feed.
 *
 * Every call here is about the CALLER's feed; there is no identifier to pass,
 * because the server has no route that acts on somebody else's. That absence is
 * deliberate — see routes/calendar.ts — and it is why these hooks take nothing.
 */

export interface CalendarFeedStatus {
  active: boolean;
  created_at?: string;
  /** When a calendar app last polled it. Null until something has. */
  last_read_at?: string | null;
}

export function useCalendarFeed() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: ["calendar-feed", companyId],
    queryFn: () =>
      apiFetch<CalendarFeedStatus>("/v1/calendar/feed", { companyId }),
  });
}

/**
 * Mint, replacing whatever was there.
 *
 * Returns the URL ONCE. Nothing stores the plaintext — only its hash — so this
 * is the only moment it exists, and the screen has to say so before somebody
 * closes the dialog expecting to find it later.
 */
export function useCreateCalendarFeed() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ url: string }>("/v1/calendar/feed", {
        method: "POST",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["calendar-feed", companyId] });
    },
  });
}

export function useRevokeCalendarFeed() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ revoked: boolean }>("/v1/calendar/feed", {
        method: "DELETE",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["calendar-feed", companyId] });
    },
  });
}
