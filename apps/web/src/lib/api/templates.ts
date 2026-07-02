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
export function useTemplates() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.templates(companyId),
    queryFn: () => apiFetch<Page<Template>>("/v1/templates", { companyId }),
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
        keys.templates(companyId),
        (page) =>
          page
            ? { ...page, data: sortByName([...page.data, template]) }
            : page,
      );
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
        keys.templates(companyId),
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
        keys.templates(companyId),
        (page) =>
          page
            ? { ...page, data: page.data.filter((t) => t.id !== templateId) }
            : page,
      );
    },
  });
}
