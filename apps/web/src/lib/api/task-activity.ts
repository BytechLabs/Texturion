import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { useT } from "@/i18n/provider";
import {
  uploadFilesSequentially,
  type StagedUploadResult,
} from "@/lib/attachments/upload-chain";
import { makeAttachmentPreview } from "@/lib/attachments/preview";
import { buildAttachmentForm } from "@/lib/attachments/validate";
import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import type { ApiError } from "./error";
import { keys } from "./keys";
import { dedupeById, nextCursorParam } from "./pagination";
import type { Attachment, Page, TaskFeedItem } from "./types";

/**
 * GET /v1/tasks/:id/activity: pages come newest first and each page reads
 * oldest first, so the whole list is the pages reversed and then each page as
 * it came. Returns oldest first, deduped.
 */
export function useTaskActivity(taskId: string, enabled = true) {
  const companyId = useCompanyId();
  const query = useInfiniteQuery({
    queryKey: keys.tasks.activity(companyId, taskId),
    queryFn: ({ pageParam }) =>
      apiFetch<Page<TaskFeedItem>>(`/v1/tasks/${taskId}/activity`, {
        companyId,
        searchParams: pageParam ? { cursor: pageParam } : undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
    enabled,
  });
  const items = dedupeById(
    [...(query.data?.pages ?? [])].reverse().flatMap((page) => page.data),
  );
  return { ...query, items };
}

function useRefreshActivity(taskId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: keys.tasks.activity(companyId, taskId),
    });
}

/** POST /v1/tasks/:id/comments. */
export function useAddTaskComment(taskId: string) {
  const companyId = useCompanyId();
  const refresh = useRefreshActivity(taskId);
  return useMutation<TaskFeedItem, ApiError, { body: string }>({
    mutationFn: ({ body }) =>
      apiFetch<TaskFeedItem>(`/v1/tasks/${taskId}/comments`, {
        method: "POST",
        companyId,
        body: { body },
      }),
    onSuccess: () => void refresh(),
  });
}

/** PATCH /v1/tasks/:id/comments/:commentId, the author only. */
export function useEditTaskComment(taskId: string) {
  const companyId = useCompanyId();
  const refresh = useRefreshActivity(taskId);
  return useMutation<TaskFeedItem, ApiError, { commentId: string; body: string }>({
    mutationFn: ({ commentId, body }) =>
      apiFetch<TaskFeedItem>(`/v1/tasks/${taskId}/comments/${commentId}`, {
        method: "PATCH",
        companyId,
        body: { body },
      }),
    onSuccess: () => void refresh(),
  });
}

/** DELETE /v1/tasks/:id/comments/:commentId. */
export function useDeleteTaskComment(taskId: string) {
  const companyId = useCompanyId();
  const refresh = useRefreshActivity(taskId);
  return useMutation<void, ApiError, { commentId: string }>({
    mutationFn: ({ commentId }) =>
      apiFetch<void>(`/v1/tasks/${taskId}/comments/${commentId}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: () => void refresh(),
  });
}

/**
 * The staged files of a new comment, uploaded one after another once the
 * comment exists. Never rejects: the result lists what failed.
 */
export function useUploadCommentFiles(taskId: string) {
  const t = useT();
  const companyId = useCompanyId();
  const refresh = useRefreshActivity(taskId);
  return useMutation<
    StagedUploadResult,
    never,
    { commentId: string; files: File[] }
  >({
    mutationFn: ({ commentId, files }) =>
      uploadFilesSequentially(
        async (file) =>
          apiFetch<Attachment>("/v1/attachments", {
            method: "POST",
            companyId,
            formData: buildAttachmentForm(
              "task_comment",
              commentId,
              file,
              await makeAttachmentPreview(file),
            ),
          }),
        files,
        t,
      ),
    onSettled: () => void refresh(),
  });
}
