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
