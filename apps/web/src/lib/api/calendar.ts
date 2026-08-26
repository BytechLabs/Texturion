import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "./client";
import { keys } from "./keys";
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

export type CalendarProvider = "google" | "microsoft";
export type CalendarConnectionStatus =
  | "active"
  | "reauth_required"
  | "disconnected";

/**
 * One member-owned, writable calendar connection (#245).
 *
 * `status` names the API's three current states. The UI still carries a safe
 * runtime fallback so a rolling deployment that adds a state cannot leak a
 * server enum to a person before this client learns it.
 */
export interface CalendarConnection {
  id: string;
  provider: CalendarProvider;
  status: CalendarConnectionStatus;
  account_label: string;
  calendar_label: string;
  last_verified_at: string | null;
  last_sync_at: string | null;
  last_error_key: string | null;
  conflict_count: number;
}

export interface CalendarOwnerDisclosure {
  connection_id: string;
  provider: CalendarProvider;
  reason: "reauth_required" | "sync_stale" | "cleanup_failed";
  occurred_at: string;
  push_delivered_at: string | null;
}

export interface CalendarConnectionsView {
  connections: CalendarConnection[];
  disclosures: CalendarOwnerDisclosure[];
  configured: Record<CalendarProvider, boolean>;
}

export interface CalendarAttentionSnapshot {
  start: string;
  end: string;
  time_zone: string;
  title: string;
}

export type CalendarAttentionState =
  | "conflict"
  | "event_removed"
  | "refused";

/**
 * One scheduling decision that belongs to the signed-in member.
 *
 * Provider timestamps are display-only. The server resolves from the stored
 * three-way snapshots and, for "use calendar", a fresh provider read.
 */
export interface CalendarAttentionItem {
  id: string;
  state: CalendarAttentionState;
  /** Latest provider condition; may differ while conflict evidence is held. */
  provider_condition: CalendarAttentionState;
  task: {
    id: string;
    title: string;
    due_at: string | null;
  };
  connection: {
    id: string;
    provider: CalendarProvider;
    calendar_label: string;
    time_zone: string;
  };
  ours: CalendarAttentionSnapshot | null;
  theirs: CalendarAttentionSnapshot | null;
  differences: {
    start: boolean;
    end: boolean;
    time_zone: boolean;
    title: boolean;
    description: boolean;
  };
  display_timestamps: {
    ours_changed_at: string | null;
    provider_observed_at: string | null;
    attention_at: string;
  };
  ours_changed_by: { id: string; name: string | null } | null;
  refusal: { code: string; detail: string | null } | null;
}

export interface CalendarAttentionView {
  attention: CalendarAttentionItem[];
}

export type CalendarAttentionResolution =
  | { action: "use_app" | "use_calendar" | "cancelled" | "not_sure" }
  | { action: "moved"; new_due_at: string };

const calendarConnectionsKey = (companyId: string) =>
  [companyId, "calendar-connections"] as const;

const calendarAttentionKey = (companyId: string) =>
  [companyId, "calendar-attention"] as const;

export function useCalendarConnections() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: calendarConnectionsKey(companyId),
    queryFn: () =>
      apiFetch<CalendarConnectionsView>("/v1/calendar/connections", {
        companyId,
      }),
  });
}

export interface AuthorizeCalendarConnectionInput {
  provider: CalendarProvider;
}

export function useAuthorizeCalendarConnection() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: ({ provider }: AuthorizeCalendarConnectionInput) =>
      apiFetch<{ url: string }>(
        `/v1/calendar/connections/${provider}/authorize`,
        {
          companyId,
          method: "POST",
        },
      ),
  });
}

export function useDisconnectCalendarConnection() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/v1/calendar/connections/${id}`, {
        companyId,
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: calendarConnectionsKey(companyId),
      });
      // Revocation makes every attention item for the connection stale; do
      // not leave an action card on screen that can only fail when clicked.
      void queryClient.invalidateQueries({
        queryKey: calendarAttentionKey(companyId),
      });
    },
  });
}

export function useCalendarAttention() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: calendarAttentionKey(companyId),
    queryFn: () =>
      apiFetch<CalendarAttentionView>("/v1/calendar/attention", {
        companyId,
      }),
  });
}

export function useResolveCalendarAttention() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      resolution,
    }: {
      id: string;
      resolution: CalendarAttentionResolution;
    }) =>
      apiFetch<{ outcome: string }>(`/v1/calendar/attention/${id}/resolve`, {
        companyId,
        method: "POST",
        body: resolution,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: calendarAttentionKey(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: calendarConnectionsKey(companyId),
      });
      // Calendar resolutions can move/rename a task, complete its source
      // message, or change whether it belongs in For You. Invalidate every
      // cached view of those records before the user follows "Open job".
      void queryClient.invalidateQueries({ queryKey: [companyId, "tasks"] });
      void queryClient.invalidateQueries({ queryKey: keys.forYou(companyId) });
      void queryClient.invalidateQueries({ queryKey: keys.threads(companyId) });
    },
  });
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
