"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
 *
 * #295 — THIS DELETE HAD NO GUARD OF ANY KIND. The audit classified every
 * destructive action as undoable, confirmed, or neither, and this is the one that
 * came back "neither": a single click on a row's remove control deleted a
 * customer's file and reported success. The other three deletes in the product
 * (task, contact, template) all confirm first, so it was an inconsistency as well
 * as a hazard.
 *
 * A CONFIRMATION rather than an undo, and the audit's rule is why: the house
 * pattern is undo for reversible STATE FLIPS (spam, assignment, done, close) and a
 * confirmation for DELETIONS that destroy data. A file is the second kind — the
 * bytes are the thing, and the customer may have sent the only copy they have.
 * See `docs/UNDO-AUDIT.md`.
 */
export function TaskAttachments({ items }: { items: TaskAttachmentItem[] }) {
  const del = useDeleteAttachment();
  const [pendingDelete, setPendingDelete] = useState<TaskAttachmentItem | null>(
    null,
  );

  if (items.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-app-muted">
        Files live on the messages and notes of this conversation. Attach one
        in the discussion below.
      </p>
    );
  }

  const runDelete = () => {
    if (!pendingDelete) return;
    del.mutate(
      { attachmentId: pendingDelete.id },
      {
        onSuccess: () => {
          setPendingDelete(null);
          toast.success("File deleted.");
        },
        // The dialog stays open on failure so the action can be retried from
        // where it was started, rather than dropping the user back to a list
        // that still shows the file with no explanation.
        onError: () => toast.error("Couldn't delete that file. Try again."),
      },
    );
  };

  return (
    <>
      <ul className="space-y-1.5">
        {items.map((item) => {
          const view = taskAttachmentView(item);
          return (
            <li key={item.id}>
              <AttachmentItem
                attachment={item}
                meta={view.sourceTag}
                onRemove={
                  view.deletable ? () => setPendingDelete(item) : undefined
                }
                removing={
                  del.isPending && del.variables?.attachmentId === item.id
                }
              />
            </li>
          );
        })}
      </ul>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !del.isPending) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this file?</DialogTitle>
            <DialogDescription>
              {pendingDelete?.file_name
                ? `"${pendingDelete.file_name}" is removed for everyone on the crew. This can't be undone.`
                : "This file is removed for everyone on the crew. This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={del.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={runDelete}
              disabled={del.isPending}
            >
              {del.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                "Delete file"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
