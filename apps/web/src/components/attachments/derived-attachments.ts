import type { TaskAttachmentItem } from "@/lib/api/types";

/**
 * Pure view logic for the task drawer's DERIVED attachments list (D28): a task
 * never owns uploads — its `attachments` union reads the source message's MMS
 * media, files on task-linked notes, and legacy pre-D28 task-owned rows. Kept
 * dependency-free so the rendering state table unit-tests without React (the
 * repo's component-test pattern).
 */

/** The minimal row shape every attachment renderer needs (generic OR derived). */
export interface AttachmentLike {
  id: string;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

/** A readable name for a row: the stored name, else a type-derived fallback. */
export function attachmentLabel(
  attachment: Pick<AttachmentLike, "file_name" | "content_type">,
): string {
  if (attachment.file_name && attachment.file_name.trim() !== "") {
    return attachment.file_name;
  }
  const subtype = attachment.content_type?.split("/")[1]?.toUpperCase();
  return subtype ? `${subtype} file` : "File";
}

/** True when the row is an image — drives preview vs. file-chip (D19). */
export function isImageAttachment(
  attachment: Pick<AttachmentLike, "content_type">,
): boolean {
  return (attachment.content_type ?? "").toLowerCase().startsWith("image/");
}

/**
 * The rendering descriptor for one derived union item — where the D28 read
 * view's per-item decisions live:
 *   - `sourceTag`: where the file actually lives — "Message" (the promoted
 *     text's MMS media), "Note" (a file on a note in the discussion), or
 *     "Legacy" (a pre-D28 direct task upload; that door is closed).
 *   - `deletable`: ONLY generic rows (note/legacy-task) can be deleted
 *     (DELETE /v1/attachments/:id — the D30 free-space path). MMS media is a
 *     conversation's carrier record: view/download only, never deletable.
 *   - `image`: preview vs. file chip, from the API's own `kind` split.
 */
export interface TaskAttachmentView {
  label: string;
  sourceTag: "Message" | "Note" | "Legacy";
  deletable: boolean;
  image: boolean;
}

export function taskAttachmentView(
  item: TaskAttachmentItem,
): TaskAttachmentView {
  return {
    label: attachmentLabel(item),
    sourceTag:
      item.source === "mms"
        ? "Message"
        : item.source === "note"
          ? "Note"
          : "Legacy",
    deletable: item.source !== "mms",
    image: item.kind === "image",
  };
}
