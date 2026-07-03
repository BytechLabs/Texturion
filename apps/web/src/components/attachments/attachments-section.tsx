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
import type { AttachmentOwnerType } from "@/lib/api/types";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_OWNER,
} from "@/lib/attachments/validate";
import { cn } from "@/lib/utils";

import { AttachmentItem } from "./attachment-item";

/**
 * The reusable note/task attachment surface (D19 / APP-FEATURES-V2 §2): a quiet
 * "Attach a file" affordance plus the list of existing attachments (image
 * previews + file chips, each opening/downloading via a signed URL). Used by
 * both the note bubble and the task checklist — the only difference is
 * `ownerType` ('note' | 'task') and the owner id (the note's `messages` id, or
 * the task id).
 *
 * Calm rules (APP-UI-ELEVATION): the attach control is a stone ghost button
 * (never petrol — attaching is routine, not the one obvious action of the
 * region); errors are a single plain sentence inline; the soft 10-per-owner cap
 * hides the button (with a quiet note) rather than failing on click; uploads
 * show a modest spinner and the list refetches on success.
 *
 * `enabled` gates the list fetch to when the surface is actually open (a note
 * area only renders when the note has attachments or is being added to; a task
 * row only when expanded).
 */
export function AttachmentsSection({
  ownerType,
  ownerId,
  enabled = true,
  /** Compact spacing for dense contexts (the task checklist row). */
  compact = false,
  className,
}: {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  enabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const list = useOwnerAttachments(ownerType, ownerId, enabled);
  const upload = useUploadAttachment(ownerType, ownerId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const attachments = list.data?.data ?? [];
  const atCap = attachments.length >= MAX_ATTACHMENTS_PER_OWNER;

  const openPicker = () => {
    setError(null);
    fileRef.current?.click();
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same file after an error
    if (!file) return;
    setError(null);
    upload.mutate(
      { file, currentCount: attachments.length },
      {
        onSuccess: () => {
          toast.success("File attached.");
        },
        onError: (err) => {
          // Both ApiError and the client-side AttachmentValidationError carry a
          // plain customer sentence — surface it inline (G10), no codes.
          setError(err.message);
        },
      },
    );
  };

  return (
    <div className={cn("space-y-2", className)}>
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
            {upload.isPending ? "Attaching…" : "Attach a file"}
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
          Images, PDFs, and documents up to 25 MB.
        </p>
      )}
    </div>
  );
}
