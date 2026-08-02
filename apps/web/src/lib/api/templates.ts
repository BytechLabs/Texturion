import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { Page, Template } from "./types";

/** GET /v1/templates — saved replies, name-sorted single page. */
/**
 * #274 — two orders, because two people are asking different questions.
 *
 * `"use"` is the composer's picker: somebody about to send wants the reply
 * they send twenty times a day, and alphabetical puts it wherever its name
 * falls. The default is the settings list, where a stable place to find a
 * template beats a list that reorders itself as the crew works.
 *
 * Separate query keys, because they are genuinely different lists — sharing
 * one would have a picker open in whatever order the settings page last
 * fetched.
 */
export function useTemplates(sort: "name" | "use" = "name") {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.templatesSorted(companyId, sort),
    queryFn: () =>
      apiFetch<Page<Template>>(
        sort === "use" ? "/v1/templates?sort=use" : "/v1/templates",
        { companyId },
      ),
  });
}

function sortByName(rows: Template[]): Template[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

/** POST /v1/templates — { name, body }. */
export function useCreateTemplate() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; body: string }) =>
      apiFetch<Template>("/v1/templates", {
        method: "POST",
        companyId,
        body: input,
      }),
    onSuccess: (template) => {
      queryClient.setQueryData<Page<Template>>(
        keys.templatesSorted(companyId, "name"),
        (page) =>
          page
            ? { ...page, data: sortByName([...page.data, template]) }
            : page,
      );
      // #274: the use-sorted list the picker reads is the SERVER's ordering,
      // so it is invalidated rather than patched — this side cannot know where
      // a new or edited template lands in it. The key is a prefix of both.
      void queryClient.invalidateQueries({ queryKey: keys.templates(companyId) });
    },
  });
}

/** PATCH /v1/templates/:id — { name?, body? }. */
export function useUpdateTemplate() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      templateId: string;
      patch: { name?: string; body?: string };
    }) =>
      apiFetch<Template>(`/v1/templates/${input.templateId}`, {
        method: "PATCH",
        companyId,
        body: input.patch,
      }),
    onSuccess: (template) => {
      queryClient.setQueryData<Page<Template>>(
        keys.templatesSorted(companyId, "name"),
        (page) =>
          page
            ? {
                ...page,
                data: sortByName(
                  page.data.map((t) => (t.id === template.id ? template : t)),
                ),
              }
            : page,
      );
      // #274: the use-sorted list the picker reads is the SERVER's ordering,
      // so it is invalidated rather than patched — this side cannot know where
      // a new or edited template lands in it. The key is a prefix of both.
      void queryClient.invalidateQueries({ queryKey: keys.templates(companyId) });
    },
  });
}

/** DELETE /v1/templates/:id */
export function useDeleteTemplate() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) =>
      apiFetch<void>(`/v1/templates/${templateId}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: (_void, templateId) => {
      queryClient.setQueryData<Page<Template>>(
        keys.templatesSorted(companyId, "name"),
        (page) =>
          page
            ? { ...page, data: page.data.filter((t) => t.id !== templateId) }
            : page,
      );
      // #274: the use-sorted list the picker reads is the SERVER's ordering,
      // so it is invalidated rather than patched — this side cannot know where
      // a new or edited template lands in it. The key is a prefix of both.
      void queryClient.invalidateQueries({ queryKey: keys.templates(companyId) });
    },
  });
}
