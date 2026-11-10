import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { parseReferenceTokens } from "@loonext/shared";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import type { ApiError } from "./error";
import { keys } from "./keys";
import type {
  LinkedTask,
  ResolvedReferences,
  TaskLink,
  TaskRelation,
} from "./types";

/**
 * #690: task relations, the tasks a thread or a contact links to, and the
 * chips in a piece of text. The rules are the server's (routes/task-references.ts);
 * these hooks only fetch and refresh.
 */

/** GET /v1/tasks/:id/links. */
export function useTaskLinks(taskId: string, enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.tasks.links(companyId, taskId),
    queryFn: () =>
      apiFetch<{ data: TaskLink[] }>(`/v1/tasks/${taskId}/links`, { companyId }),
    enabled,
  });
}

function useRefreshLinks(taskId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return (otherId: string) => {
    void queryClient.invalidateQueries({
      queryKey: keys.tasks.links(companyId, taskId),
    });
    void queryClient.invalidateQueries({
      queryKey: keys.tasks.links(companyId, otherId),
    });
    // Both timelines gain a line.
    void queryClient.invalidateQueries({
      queryKey: keys.tasks.activity(companyId, taskId),
    });
    void queryClient.invalidateQueries({
      queryKey: keys.tasks.activity(companyId, otherId),
    });
  };
}

interface LinkInput {
  relation: TaskRelation;
  otherTaskId: string;
}

/** POST /v1/tasks/:id/links. A loop is a 422 and a second parent a 409. */
export function useAddTaskLink(taskId: string) {
  const companyId = useCompanyId();
  const refresh = useRefreshLinks(taskId);
  return useMutation<{ data: TaskLink[] }, ApiError, LinkInput>({
    mutationFn: ({ relation, otherTaskId }) =>
      apiFetch<{ data: TaskLink[] }>(`/v1/tasks/${taskId}/links`, {
        method: "POST",
        companyId,
        body: { relation, task_id: otherTaskId },
      }),
    onSuccess: (_data, input) => refresh(input.otherTaskId),
  });
}

/** DELETE /v1/tasks/:id/links/:otherId. */
export function useRemoveTaskLink(taskId: string) {
  const companyId = useCompanyId();
  const refresh = useRefreshLinks(taskId);
  return useMutation<{ data: TaskLink[] }, ApiError, LinkInput>({
    mutationFn: ({ relation, otherTaskId }) =>
      apiFetch<{ data: TaskLink[] }>(
        `/v1/tasks/${taskId}/links/${otherTaskId}`,
        { method: "DELETE", companyId, searchParams: { relation } },
      ),
    onSuccess: (_data, input) => refresh(input.otherTaskId),
  });
}

/** The tasks a conversation or a contact links to. */
export function useLinkedTasks(
  kind: "conversation" | "contact",
  id: string,
  enabled = true,
) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.tasks.linked(companyId, kind, id),
    queryFn: () =>
      apiFetch<{ data: LinkedTask[] }>(
        `/v1/${kind === "contact" ? "contacts" : "conversations"}/${id}/linked-tasks`,
        { companyId },
      ),
    enabled,
  });
}

/**
 * What the chips in `texts` say right now. One request for every token in
 * every text; the answer is cached by the set it was asked for, and a task's
 * title or done state is refreshed with the rest of the task cache.
 */
export function useResolvedReferences(texts: string[]) {
  const companyId = useCompanyId();
  const tasks = new Set<string>();
  const contacts = new Set<string>();
  const conversations = new Set<string>();
  for (const text of texts) {
    for (const token of parseReferenceTokens(text)) {
      if (token.kind === "task") tasks.add(token.key);
      else if (token.kind === "contact") contacts.add(token.key);
      else conversations.add(token.key);
    }
  }
  const query = {
    tasks: [...tasks].sort(),
    contacts: [...contacts].sort(),
    conversations: [...conversations].sort(),
  };
  const wanted = JSON.stringify(query);
  const nothing =
    query.tasks.length + query.contacts.length + query.conversations.length === 0;
  return useQuery({
    queryKey: keys.tasks.references(companyId, wanted),
    queryFn: () =>
      apiFetch<ResolvedReferences>("/v1/references/resolve", {
        companyId,
        searchParams: {
          tasks: query.tasks.join(",") || undefined,
          contacts: query.contacts.join(",") || undefined,
          conversations: query.conversations.join(",") || undefined,
        },
      }),
    enabled: !nothing,
    staleTime: 30_000,
  });
}
