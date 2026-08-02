import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { Page, Tag } from "./types";

/** GET /v1/tags — single page (creation happens on attach, SPEC §7). */
export function useTags() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.tags(companyId),
    queryFn: () => apiFetch<Page<Tag>>("/v1/tags", { companyId }),
  });
}

/** PATCH /v1/tags/:id — rename / recolor. */
export function useUpdateTag() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      tagId: string;
      patch: { name?: string; color?: string | null };
    }) =>
      apiFetch<Tag>(`/v1/tags/${input.tagId}`, {
        method: "PATCH",
        companyId,
        body: input.patch,
      }),
    onSuccess: (tag) => {
      queryClient.setQueryData<Page<Tag>>(keys.tags(companyId), (page) =>
        page
          ? {
              ...page,
              data: page.data.map((t) => (t.id === tag.id ? tag : t)),
            }
          : page,
      );
      // Embedded tag chips (lists, details) show the old name until refetch.
      queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
        refetchType: "none",
      });
    },
  });
}

/** DELETE /v1/tags/:id — owner/admin; conversation_tags cascade (SPEC §7). */
export function useDeleteTag() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) =>
      apiFetch<void>(`/v1/tags/${tagId}`, { method: "DELETE", companyId }),
    onSuccess: (_void, tagId) => {
      queryClient.setQueryData<Page<Tag>>(keys.tags(companyId), (page) =>
        page
          ? { ...page, data: page.data.filter((t) => t.id !== tagId) }
          : page,
      );
      queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
        refetchType: "none",
      });
    },
  });
}

/**
 * #298 — GET /v1/tags/usage: how much each tag is actually used.
 *
 * Its own query rather than a field on the tag list, because the list is on
 * every screen that shows a tag chip and this is only ever read on one. Joining
 * it in would put a count aggregate on the inbox's hot path.
 */
export interface TagUsage {
  tag_id: string;
  name: string;
  uses: number;
  last_used: string | null;
}

export function useTagUsage(enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.tagUsage(companyId),
    queryFn: () => apiFetch<Page<TagUsage>>("/v1/tags/usage", { companyId }),
    enabled,
  });
}

/**
 * #298 — POST /v1/tags/:id/merge.
 *
 * Invalidates the tag list AND the conversation lists: a merge rewrites which
 * tag every affected thread carries, so a cached list would keep rendering a
 * chip for a tag that no longer exists.
 */
export function useMergeTags() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { fromTagId: string; intoTagId: string }) =>
      apiFetch<{ merged: true; moved: number; already_both: number }>(
        `/v1/tags/${input.fromTagId}/merge`,
        { method: "POST", companyId, body: { into_tag_id: input.intoTagId } },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tags(companyId) });
      void queryClient.invalidateQueries({ queryKey: keys.tagUsage(companyId) });
      // Every cached conversation list: a merge rewrites which tag an
      // affected thread carries, and a stale list keeps rendering a chip
      // for a tag that no longer exists.
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
      });
    },
  });
}
