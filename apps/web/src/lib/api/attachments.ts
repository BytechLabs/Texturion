import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, type MouseEvent } from "react";

import { useT } from "@/i18n/provider";
import { useCompanyId } from "@/lib/company/provider";
import {
  uploadFilesSequentially,
  type StagedUploadResult,
} from "@/lib/attachments/upload-chain";
import { makeAttachmentPreview } from "@/lib/attachments/preview";
import {
  buildAttachmentForm,
  validateAttachment,
} from "@/lib/attachments/validate";

import { invalidateAfterNoteUpload } from "./attachment-invalidation";
import { createAttachmentUrlBatcher } from "./attachment-url-batcher";
import { apiFetch } from "./client";
import { ApiError } from "./error";
import { keys } from "./keys";
import type {
  Attachment,
  AttachmentOwnerType,
  AttachmentUrl,
  AttachmentVariant,
} from "./types";

// Re-exported for backwards compatibility — the pure invalidation helper now
// lives in ./attachment-invalidation (importable without this module's heavy
// hook/client/env graph; see that file for why).
export { invalidateAfterNoteUpload };

/** Every mint in the app, so one render's thumbnails share a request. */
export const loadAttachmentUrl = createAttachmentUrlBatcher(apiFetch);

/** The lifetime assumed when an older Worker does not send one: the shorter, generic TTL. */
const FALLBACK_TTL_SECONDS = 300;
/** A URL with this little left is refetched on its next use. */
const STALE_MARGIN_MS = 60_000;
/** A URL with this little left is never rendered. */
const SPENT_MARGIN_MS = 30_000;
/** A file link with this little left is re-minted before it opens. */
const OPEN_MARGIN_MS = 60_000;

function lifetimeMs(url: AttachmentUrl | undefined): number {
  return (url?.ttl_seconds ?? FALLBACK_TTL_SECONDS) * 1000;
}

/** Time left on a cached URL, counted from when this client received it, so server clock skew changes nothing. */
export function attachmentUrlLifeLeft(
  url: AttachmentUrl,
  receivedAt: number,
  now: number,
): number {
  return lifetimeMs(url) - (now - receivedAt);
}

export function attachmentUrlOptions(
  companyId: string,
  attachmentId: string,
  variant: AttachmentVariant,
) {
  return queryOptions({
    queryKey: keys.attachmentUrl(companyId, attachmentId, variant),
    queryFn: () => loadAttachmentUrl(companyId, attachmentId, variant),
    staleTime: (query) =>
      Math.max(0, lifetimeMs(query.state.data) - STALE_MARGIN_MS),
    gcTime: 60 * 60_000,
  });
}

/**
 * A membership-checked signed Storage URL for one attachment, generic or MMS
 * (one route, three sources in routes/attachments.ts). Mints from one render
 * go out together as POST /v1/attachments/urls.
 *
 * Each URL is cached for the lifetime the server gave it (1 h for MMS, 300 s
 * for note/task files) less a minute. A cached URL within 30 s of expiring is
 * reported as pending and re-minted, so an expired URL is never rendered.
 */
export function useAttachmentUrl(
  attachmentId: string,
  enabled = true,
  /**
   * #240: which of a row's two objects to fetch. The default is the preview,
   * which is what a thread thumbnail and a gallery tile want — a 25 MB original
   * behind a 176px square was the single worst egress shape in the product, and
   * it is the tech's own mobile data too (#289).
   *
   * `"original"` is for a full-size view or a download: a deliberate act by a
   * caller that wants the FILE rather than a picture of it. A row with no
   * preview serves its original either way, so nothing uploaded before this
   * shipped changes behaviour.
   */
  variant: AttachmentVariant = "preview",
  /** Re-mint a minute before expiry while mounted, for a player that may be pressed at any time. */
  { refreshBeforeExpiry = false }: { refreshBeforeExpiry?: boolean } = {},
): UseQueryResult<AttachmentUrl> {
  const companyId = useCompanyId();
  const query = useQuery({
    ...attachmentUrlOptions(companyId, attachmentId, variant),
    enabled,
    refetchInterval: refreshBeforeExpiry
      ? (q) =>
          // A refused re-mint keeps its old data, which would otherwise re-mint every second.
          q.state.data && q.state.status === "success"
            ? Math.max(
                1000,
                attachmentUrlLifeLeft(q.state.data, q.state.dataUpdatedAt, Date.now()) -
                  STALE_MARGIN_MS,
              )
            : false
      : undefined,
  });

  const spent =
    query.data !== undefined &&
    attachmentUrlLifeLeft(query.data, query.dataUpdatedAt, Date.now()) <=
      SPENT_MARGIN_MS;
  const { refetch, isFetching, isError } = query;
  useEffect(() => {
    // A mount already refetches a stale URL; this covers one that ran out while on screen.
    if (spent && enabled && !isFetching && !isError) void refetch();
  }, [spent, enabled, isFetching, isError, refetch]);

  if (!spent) return query;
  return {
    ...query,
    data: undefined,
    ...(query.status === "success"
      ? {
          status: "pending",
          isPending: true,
          isSuccess: false,
          isLoading: query.isFetching,
        }
      : {}),
  } as UseQueryResult<AttachmentUrl>;
}

/** A file link near expiry re-mints into a tab opened during the click, since one opened after the request is blocked as a popup. */
export function openWithFreshUrl(
  event: MouseEvent<HTMLAnchorElement>,
  url: Pick<UseQueryResult<AttachmentUrl>, "data" | "dataUpdatedAt" | "refetch">,
): void {
  if (
    !url.data ||
    attachmentUrlLifeLeft(url.data, url.dataUpdatedAt, Date.now()) > OPEN_MARGIN_MS
  ) {
    return;
  }
  const tab = window.open("", "_blank");
  if (!tab) return;
  event.preventDefault();
  tab.opener = null;
  void url.refetch().then((result) => {
    if (result.status === "success") tab.location.href = result.data.url;
    else tab.close();
  });
}

/** One attachment's URL cache entries, both variants. */
function attachmentUrlsKey(companyId: string, attachmentId: string) {
  return [companyId, "attachments", attachmentId] as const;
}

/** A deleted file leaves its signed URLs and every cached owner list at once. */
export function forgetDeletedAttachment(
  queryClient: QueryClient,
  companyId: string,
  attachmentId: string,
): void {
  queryClient.removeQueries({ queryKey: attachmentUrlsKey(companyId, attachmentId) });
  queryClient.setQueriesData<{ data: Attachment[] }>(
    { queryKey: [companyId, "attachments", "owner"] },
    (list) =>
      list?.data.some((row) => row.id === attachmentId)
        ? { ...list, data: list.data.filter((row) => row.id !== attachmentId) }
        : list,
  );
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
  const t = useT();
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation<Attachment, ApiError | AttachmentValidationError, UploadAttachmentInput>({
    mutationFn: async ({ file, currentCount = 0 }) => {
      const check = validateAttachment(file, currentCount, t);
      if (!check.ok) {
        // Reject before the network — the caller shows check.reason inline.
        throw new AttachmentValidationError(check.reason);
      }
      // #240: the browser has already decoded this image — the person just
      // picked it — so the resize is a few milliseconds on a bitmap that
      // exists, and it saves the whole crew re-fetching the original on every
      // thread scroll. Null whenever one is not worth making or not possible.
      const preview = await makeAttachmentPreview(file);
      return apiFetch<Attachment>("/v1/attachments", {
        method: "POST",
        companyId,
        formData: buildAttachmentForm("note", noteId, file, preview),
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
  const t = useT();
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation<
    StagedUploadResult,
    never,
    { noteId: string; files: File[] }
  >({
    mutationFn: ({ noteId, files }) =>
      uploadFilesSequentially(
        async (file) =>
          apiFetch<Attachment>("/v1/attachments", {
            method: "POST",
            companyId,
            // #240: generated per file, inside the sequencer, so four staged
            // photos resize one at a time. Doing them all up front would hold
            // four decoded bitmaps at once, which on a phone browser is the
            // difference between a slow tab and a dead one.
            formData: buildAttachmentForm(
              "note",
              noteId,
              file,
              await makeAttachmentPreview(file),
            ),
          }),
        files,
        t,
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
 * checklist count), and the conversation gallery. It leaves the cached owner
 * lists and its own signed URLs at once; the task and gallery roots are
 * invalidated. Every other file's URL stays cached.
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
    onSuccess: (_data, { attachmentId }) => {
      forgetDeletedAttachment(queryClient, companyId, attachmentId);
      void queryClient.invalidateQueries({ queryKey: [companyId, "tasks"] });
      void queryClient.invalidateQueries({
        queryKey: [companyId, "conversations", "attachments"],
      });
    },
  });
}

/**
 * POST /v1/attachments/:id/report — #317: pull a file back for the WHOLE
 * workspace, not just for the person who noticed.
 *
 * The scan (D101) stops what it can recognise and is explicitly not antivirus,
 * so this is the path for what gets past it. It is available to any member on
 * purpose: behind owner-only, the person holding the phone cannot stop the
 * thing they just spotted, and waiting is how somebody ends up opening it to
 * check.
 *
 * Every list that can show or sign the file is invalidated, because the point
 * of reporting is that it disappears for everybody — a report that left the
 * thumbnail sitting in a teammate's gallery would be theatre.
 */
export function useReportAttachment() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { attachmentId: string; note?: string }>({
    mutationFn: ({ attachmentId, note }) =>
      apiFetch<void>(`/v1/attachments/${attachmentId}/report`, {
        method: "POST",
        companyId,
        body: note ? { note } : {},
      }),
    onSuccess: (_data, { attachmentId }) => {
      // Owner lists still list a held file; a reset, unlike a remove, re-mints a mounted row into its held state.
      void queryClient.resetQueries({
        queryKey: attachmentUrlsKey(companyId, attachmentId),
      });
      void queryClient.invalidateQueries({ queryKey: [companyId, "tasks"] });
      void queryClient.invalidateQueries({
        queryKey: [companyId, "conversations", "attachments"],
      });
    },
  });
}
