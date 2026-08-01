import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { SavedViewFilters, SavedViewSurface } from "@loonext/shared";
import { SAVED_VIEW_COUNT_MAX_VIEWS } from "@loonext/shared";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";

/**
 * #280 — saved views.
 *
 * Counts are a SEPARATE query from the list on purpose. The list is what the
 * sidebar renders and should never wait on anything; the badges are an
 * enrichment that costs bounded server work, so they refetch on their own
 * schedule and a failure there leaves the views themselves on screen.
 */

export interface SavedView {
  id: string;
  surface: SavedViewSurface;
  name: string;
  filters: SavedViewFilters;
  position: number;
  /** True when the whole workspace sees it. */
  shared: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SavedViewList {
  data: SavedView[];
  next_cursor: null;
  defaults: Record<SavedViewSurface, string | null>;
}

export function useSavedViews(surface: SavedViewSurface) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.savedViews(companyId, surface),
    queryFn: () =>
      apiFetch<SavedViewList>(`/v1/saved-views?surface=${surface}`, {
        companyId,
      }),
  });
}

/**
 * Queue badges for the views on screen.
 *
 * Capped client-side as well as server-side. Two bounds rather than one because
 * the server's cap silently truncating would leave some chips permanently
 * without a badge and no way to tell why; asking for only what will be answered
 * keeps the two ends honest with each other.
 */
export function useSavedViewCounts(
  surface: SavedViewSurface,
  ids: string[],
  enabled = true,
) {
  const companyId = useCompanyId();
  const asked = ids.slice(0, SAVED_VIEW_COUNT_MAX_VIEWS);
  return useQuery({
    queryKey: keys.savedViewCounts(companyId, surface, asked),
    queryFn: () =>
      apiFetch<{ counts: Record<string, number> }>(
        `/v1/saved-views/counts?surface=${surface}&ids=${asked.join(",")}`,
        { companyId },
      ),
    enabled: enabled && surface === "conversations" && asked.length > 0,
    // A badge is a rough signal, not a live counter. Refetching it on every
    // focus would make the cheapest thing on the screen the most frequent.
    staleTime: 60_000,
  });
}

interface CreateInput {
  surface: SavedViewSurface;
  name: string;
  filters: SavedViewFilters;
  shared?: boolean;
}

export function useCreateSavedView() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInput) =>
      apiFetch<SavedView>("/v1/saved-views", {
        method: "POST",
        companyId,
        body: input,
      }),
    onSuccess: (view) => {
      void queryClient.invalidateQueries({
        queryKey: keys.savedViews(companyId, view.surface),
      });
    },
  });
}

interface UpdateInput {
  id: string;
  surface: SavedViewSurface;
  name?: string;
  filters?: SavedViewFilters;
  shared?: boolean;
}

export function useUpdateSavedView() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateInput) => {
      // `surface` is carried for the invalidation below, not sent: the row
      // already knows which surface it is on, and PATCHing it would be offering
      // to move a view between two lists that hold different filters.
      const { id, surface, ...patch } = input;
      void surface;
      return apiFetch<SavedView>(`/v1/saved-views/${id}`, {
        method: "PATCH",
        companyId,
        body: patch,
      });
    },
    onSuccess: (_view, input) => {
      void queryClient.invalidateQueries({
        queryKey: keys.savedViews(companyId, input.surface),
      });
    },
  });
}

export function useDeleteSavedView() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; surface: SavedViewSurface }) =>
      apiFetch<void>(`/v1/saved-views/${id}`, { method: "DELETE", companyId }),
    onSuccess: (_void, input) => {
      void queryClient.invalidateQueries({
        queryKey: keys.savedViews(companyId, input.surface),
      });
    },
  });
}

export function useSetDefaultSavedView() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { surface: SavedViewSurface; view_id: string | null }) =>
      apiFetch<{ surface: SavedViewSurface; view_id: string | null }>(
        "/v1/saved-views/default",
        { method: "PUT", companyId, body: input },
      ),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({
        queryKey: keys.savedViews(companyId, input.surface),
      });
    },
  });
}

export function useReorderSavedViews() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { surface: SavedViewSurface; ids: string[] }) =>
      apiFetch<{ moved: number }>("/v1/saved-views/reorder", {
        method: "POST",
        companyId,
        body: input,
      }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({
        queryKey: keys.savedViews(companyId, input.surface),
      });
    },
  });
}
