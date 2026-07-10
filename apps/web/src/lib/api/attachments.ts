import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";
import {
  uploadFilesSequentially,
  type StagedUploadResult,
} from "@/lib/attachments/upload-chain";
import {
  buildAttachmentForm,
  validateAttachment,
} from "@/lib/attachments/validate";

import { invalidateAfterNoteUpload } from "./attachment-invalidation";
import { apiFetch } from "./client";
import { ApiError } from "./error";
import { keys } from "./keys";
import type {
  Attachment,
  AttachmentOwnerType,
  AttachmentUrl,
} from "./types";

// Re-exported for backwards compatibility — the pure invalidation helper now
// lives in ./attachment-invalidation (importable without this module's heavy
// hook/client/env graph; see that file for why).
export { invalidateAfterNoteUpload };

/**
 * GET /v1/attachments/:id/url — membership-checked signed Storage URL. Serves
 * both the MMS `message_attachments` (TTL 1 h) and the generic note/task
 * `attachments` (TTL 300 s, D19 §2.5) — one route, three sources
 * (routes/attachments.ts), so this is the single open/download signer for both.
 * Cached under the SHORTEST server TTL (the generic 300 s), not the MMS hour:
 * ~4 min stale/gc leaves a safety margin so a thumbnail or download link never
 * renders from a cache entry whose signature has already expired.
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
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
  });
}

/**
 * GET /v1/attachments?owner_type=&owner_id= — one owner's live (non-deleted)
 * generic attachments, newest-last (routes/attachments.ts orders ascending by
 * created_at). Note attachments pass `owner_type='note'` with the note's
 * `messages` id; READ paths still accept `owner_type='task'` for legacy
 * pre-D28 rows (upload is notes-only — see `useUploadAttachment`). `enabled`
 * gates the fetch to when the surface (a note bubble's attachment area) is
 * actually shown.
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
 * POST /v1/attachments — multipart upload of one NOTE attachment (D19 door,
 * D28 notes-only: files enter through messages and notes, never a task). The
 * form carries `owner_type='note'`, `owner_id`, and `file`; the browser sets
 * the multipart boundary (the client drops the JSON content-type for FormData
 * bodies). The 25 MB ceiling + MIME allow-list are validated client-side first
 * (a plain sentence, no round-trip) — the API re-validates and additionally
 * sniffs the bytes, so a stripped/forged type is still caught server-side.
 *
 * On success the note file's read surfaces are invalidated together
 * (`invalidateAfterNoteUpload`): the note's own attachment list, the tasks root
 * (a task-linked note feeds the D28 derived union), and the conversation
 * attachments gallery root (§5.2) so a new note file appears in-session.
 */
export function useUploadAttachment(noteId: string) {
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
        formData: buildAttachmentForm("note", noteId, file),
      });
    },
    onSuccess: () => {
      invalidateAfterNoteUpload(queryClient, companyId, noteId);
    },
  });
}

/**
 * The staged-note-upload chain (D28): after a composer creates a note, each
 * staged file POSTs to /v1/attachments with the returned note id, sequentially
 * (`uploadFilesSequentially` — the pure sequencer in
 * lib/attachments/upload-chain.ts). The owner id arrives at mutate time — unlike
 * `useUploadAttachment` the note doesn't exist when the hook mounts. Staged
 * files were already validated at admission (partitionAttachmentFiles), so no
 * client re-check here; the API remains the authority. Never rejects — the
 * result carries `failed` for the caller's plain-language toast.
 *
 * Settles by invalidating the note file's read surfaces together
 * (`invalidateAfterNoteUpload`): the note's attachment list (the bubble's Files
 * section), the tasks root (task-linked notes feed the D28 derived union), and
 * the conversation attachments gallery root (§5.2) so new note files appear
 * in-session.
 */
export function useUploadNoteFiles() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation<
    StagedUploadResult,
    never,
    { noteId: string; files: File[] }
  >({
    mutationFn: ({ noteId, files }) =>
      uploadFilesSequentially(
        (file) =>
          apiFetch<Attachment>("/v1/attachments", {
            method: "POST",
            companyId,
            formData: buildAttachmentForm("note", noteId, file),
          }),
        files,
      ),
    onSettled: (_result, _error, { noteId }) => {
      invalidateAfterNoteUpload(queryClient, companyId, noteId);
    },
  });
}

/**
 * DELETE /v1/attachments/:id — soft-delete one live GENERIC (note/legacy-task)
 * attachment (D19; the D19 sweep hard-deletes later). D30: deleting files is
 * how an owner frees plan storage, so this affordance matters. MMS media is
 * NOT deletable — the route only touches the generic table (a conversation's
 * carrier record stays intact); callers gate the control by source.
 *
 * A deleted row can surface in owner lists, the D28 task unions (detail +
 * checklist count), and the conversation gallery — the roots of all three are
 * invalidated.
 */
export function useDeleteAttachment() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { attachmentId: string }>({
    mutationFn: ({ attachmentId }) =>
      apiFetch<void>(`/v1/attachments/${attachmentId}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [companyId, "attachments"],
      });
      void queryClient.invalidateQueries({ queryKey: [companyId, "tasks"] });
      void queryClient.invalidateQueries({
        queryKey: [companyId, "conversations", "attachments"],
      });
    },
  });
}
