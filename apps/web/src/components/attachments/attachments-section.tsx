"use client";

import { Loader2, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useOwnerAttachments,
  useUploadAttachment,
} from "@/lib/api/attachments";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_OWNER,
  partitionAttachmentFiles,
} from "@/lib/attachments/validate";
import { cn } from "@/lib/utils";

import { AttachmentItem } from "./attachment-item";
import { DropOverlay, useFileDrop } from "./use-file-drop";

/**
 * The NOTE attachment surface (D19 / D28 / APP-FEATURES-V2 §2): a quiet
 * "Attach files" affordance plus the list of the note's existing attachments
 * (image previews + file chips, each opening/downloading via a signed URL).
 * Post-D28 this is notes-only — files enter through messages and notes, so
 * the task surfaces render the derived read view (`TaskAttachments`) instead.
 * This section doubles as the RETRY surface when a composer's staged upload
 * partially fails: the note exists, so re-attaching here just works.
 *
 * Accepts multiple selection and dropped files (D28): each incoming batch is
 * validated client-side (25 MB / allow-list / the 10-per-note cap,
 * `partitionAttachmentFiles`) and uploads sequentially — a failure mid-batch
 * never drops the rest.
 *
 * Calm rules (APP-UI-ELEVATION): the attach control is a stone ghost button
 * (never petrol — attaching is routine, not the one obvious action of the
 * region); errors are a single plain sentence inline; the soft 10-per-owner cap
 * hides the button (with a quiet note) rather than failing on click; uploads
 * show a modest spinner and the list refetches on success.
 *
 * `enabled` gates the list fetch to when the surface is actually open (a note
 * area only renders when its disclosure is expanded).
 */
export function AttachmentsSection({
  noteId,
  enabled = true,
  /** Compact spacing for dense contexts (the note bubble's disclosure). */
  compact = false,
  className,
}: {
  noteId: string;
  enabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const list = useOwnerAttachments("note", noteId, enabled);
  const upload = useUploadAttachment(noteId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const attachments = list.data?.data ?? [];
  const atCap = attachments.length >= MAX_ATTACHMENTS_PER_OWNER;

  const openPicker = () => {
    setError(null);
    fileRef.current?.click();
  };

  /**
   * Validate a batch, upload the survivors one at a time, and surface the
   * outcome plainly: one success toast for what landed, one inline line for
   * what didn't (client rejects + API failures, deduped).
   */
  const runUploads = async (incoming: File[]) => {
    if (upload.isPending) {
      // One batch at a time keeps the running count honest — but say so instead
      // of dropping the files silently (the picker input has already reset, so
      // there'd be no other trace). They can re-drop once the spinner clears.
      setError("A file is still uploading — drop these again when it finishes.");
      return;
    }
    setError(null);
    const { accepted, rejected } = partitionAttachmentFiles(
      incoming,
      attachments.length,
    );
    const failures = rejected.map((r) => r.reason);
    let uploaded = 0;
    let count = attachments.length;
    for (const file of accepted) {
      try {
        await upload.mutateAsync({ file, currentCount: count });
        count += 1;
        uploaded += 1;
      } catch (err) {
        failures.push(
          err instanceof Error ? err.message : "That file didn't upload. Try again.",
        );
      }
    }
    if (uploaded > 0) {
      toast.success(uploaded === 1 ? "File attached." : `${uploaded} files attached.`);
    }
    if (failures.length > 0) {
      setError([...new Set(failures)].join(" "));
    }
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = ""; // allow re-picking the same file after an error
    if (files.length > 0) void runUploads(files);
  };

  const drop = useFileDrop((files) => void runUploads(Array.from(files)));

  return (
    <div
      className={cn("relative space-y-2", className)}
      {...drop.handlers}
    >
      <DropOverlay active={drop.active} pending={upload.isPending} />
      {list.isPending && enabled && (
        <div className={cn("space-y-1.5", compact && "space-y-1")} aria-hidden>
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      )}

      {attachments.length > 0 && (
        <ul className={cn("space-y-1.5", compact && "space-y-1")}>
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentItem attachment={attachment} />
            </li>
          ))}
        </ul>
      )}

      {list.isError && (
        <p className="text-[13px] text-muted-foreground">
          Couldn&apos;t load attachments.{" "}
          <button
            type="button"
            onClick={() => list.refetch()}
            className="underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </p>
      )}

      {atCap ? (
        <p className="text-[11px] text-muted-foreground">
          Up to {MAX_ATTACHMENTS_PER_OWNER} files — remove one to add another.
        </p>
      ) : (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            hidden
            onChange={onFileChange}
          />
          <Button
            type="button"
            variant="ghost"
            size={compact ? "xs" : "sm"}
            onClick={openPicker}
            disabled={upload.isPending}
            className="text-muted-foreground"
          >
            {upload.isPending ? (
              <Loader2 className="animate-spin" strokeWidth={1.75} aria-hidden />
            ) : (
              <Paperclip strokeWidth={1.75} aria-hidden />
            )}
            {upload.isPending ? "Attaching…" : "Attach files"}
          </Button>
        </>
      )}

      {error && (
        <p className="text-[13px] text-destructive dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {!compact && attachments.length === 0 && !list.isPending && !error && (
        <p className="text-[11px] text-muted-foreground">
          Images, PDFs, and documents up to 25 MB — or drop files here.
        </p>
      )}
    </div>
  );
}
