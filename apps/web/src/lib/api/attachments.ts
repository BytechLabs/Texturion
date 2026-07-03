import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";
import {
  buildAttachmentForm,
  validateAttachment,
} from "@/lib/attachments/validate";

import { apiFetch } from "./client";
import { ApiError } from "./error";
import { keys } from "./keys";
import type {
  Attachment,
  AttachmentOwnerType,
  AttachmentUrl,
} from "./types";

/**
 * GET /v1/attachments/:id/url — membership-checked signed Storage URL, TTL
 * 1 hour (SPEC §7). Cached just under the TTL so thumbnails (G5 blur-up)
 * never render with an expired link. Serves both the MMS `message_attachments`
 * and the generic note/task `attachments` (routes/attachments.ts — one route,
 * three sources), so this is the single open/download signer for both.
 */
export function useAttachmentUrl(attachmentId: string, enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.attachmentUrl(companyId, attachmentId),
    queryFn: () =>
      apiFetch<AttachmentUrl>(`/v1/attachments/${attachmentId}/url`, {
        companyId,
      }),
    enabled,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
  });
}

/**
 * GET /v1/attachments?owner_type=&owner_id= — one owner's live (non-deleted)
 * generic attachments, newest-last (routes/attachments.ts orders ascending by
 * created_at). Note attachments pass `owner_type='note'` with the note's
 * `messages` id; task attachments pass `owner_type='task'` with the task id
 * (D19). `enabled` gates the fetch to when the surface (a note bubble's
 * attachment area, a task's expanded row) is actually shown.
 */
export function useOwnerAttachments(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  enabled = true,
) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.ownerAttachments(companyId, ownerType, ownerId),
    queryFn: () =>
      apiFetch<{ data: Attachment[] }>("/v1/attachments", {
        companyId,
        searchParams: { owner_type: ownerType, owner_id: ownerId },
      }),
    enabled,
  });
}

/** Thrown by the upload hook when the client-side D19 gate rejects a file. */
export class AttachmentValidationError extends Error {
  readonly code = "validation_failed" as const;
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

export interface UploadAttachmentInput {
  file: File;
  /** The owner's current live attachment count, for the soft per-owner cap. */
  currentCount?: number;
}

/**
 * POST /v1/attachments — multipart upload of one note/task attachment (D19).
 * The form carries `owner_type`, `owner_id`, and `file`; the browser sets the
 * multipart boundary (the client drops the JSON content-type for FormData
 * bodies). The 25 MB ceiling + MIME allow-list are validated client-side first
 * (a plain sentence, no round-trip) — the API re-validates and additionally
 * sniffs the bytes, so a stripped/forged type is still caught server-side.
 *
 * On success the owner's attachment list is invalidated so the new row appears;
 * the caller renders it (image preview or file chip) from that refetch.
 */
export function useUploadAttachment(
  ownerType: AttachmentOwnerType,
  ownerId: string,
) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation<Attachment, ApiError | AttachmentValidationError, UploadAttachmentInput>({
    mutationFn: ({ file, currentCount = 0 }) => {
      const check = validateAttachment(file, currentCount);
      if (!check.ok) {
        // Reject before the network — the caller shows check.reason inline.
        return Promise.reject(new AttachmentValidationError(check.reason));
      }
      return apiFetch<Attachment>("/v1/attachments", {
        method: "POST",
        companyId,
        formData: buildAttachmentForm(ownerType, ownerId, file),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.ownerAttachments(companyId, ownerType, ownerId),
      });
      // A task's checklist row shows an `attachment_count`; refresh the tasks
      // reads so the count stays honest after an upload. (Note attachments have
      // no such counter, so this is task-only.)
      if (ownerType === "task") {
        void queryClient.invalidateQueries({ queryKey: [companyId, "tasks"] });
      }
    },
  });
}
