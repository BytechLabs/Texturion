"use client";

import { toast } from "sonner";

import { useDeleteAttachment } from "@/lib/api/attachments";
import type { TaskAttachmentItem } from "@/lib/api/types";

import { AttachmentItem } from "./attachment-item";
import { taskAttachmentView } from "./derived-attachments";

/**
 * The task drawer's Attachments section, post-D28: a READ view of the derived
 * union (GET /v1/tasks/:id `attachments` — source-message MMS + files on
 * task-linked notes + legacy task rows). There is deliberately no upload here
 * — files enter through messages and notes only; the discussion composer
 * below is how a file gets "attached to a task". Each item carries its origin
 * tag (Message / Note / Legacy) and signs its own url via the shared per-item
 * hook.
 *
 * Delete stays available ONLY on generic rows (note/legacy-task — the D30
 * free-space path); MMS items are the conversation's carrier record and are
 * view/download only. The empty state teaches the D28 model instead of
 * pointing at a button that no longer exists.
 */
export function TaskAttachments({ items }: { items: TaskAttachmentItem[] }) {
  const del = useDeleteAttachment();

  if (items.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-app-muted">
        Files live on the messages and notes of this conversation — attach one
        in the discussion below.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const view = taskAttachmentView(item);
        return (
          <li key={item.id}>
            <AttachmentItem
              attachment={item}
              meta={view.sourceTag}
              onRemove={
                view.deletable
                  ? () =>
                      del.mutate(
                        { attachmentId: item.id },
                        {
                          onSuccess: () => toast.success("File deleted."),
                          onError: () =>
                            toast.error("Couldn't delete that file. Try again."),
                        },
                      )
                  : undefined
              }
              removing={
                del.isPending && del.variables?.attachmentId === item.id
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
