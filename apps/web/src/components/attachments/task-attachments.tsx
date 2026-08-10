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
import { groupJobPhotos } from "@loonext/shared";

import { useT } from "@/i18n/provider";
import { useDeleteAttachment } from "@/lib/api/attachments";
import type { TaskAttachmentItem } from "@/lib/api/types";

import { AttachmentItem } from "./attachment-item";
import { PhotoGroupHeader } from "./photo-group-header";
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
export function TaskAttachments({
  items,
  names,
}: {
  items: TaskAttachmentItem[];
  /**
   * #294: user id → display name, for saying WHO took a set of photos.
   *
   * Passed in rather than fetched: the drawer already resolved the crew for the
   * assignee picker and the activity timeline, and a third lookup for the same
   * names would be a third thing that can be a step behind them.
   */
  names?: Map<string, string>;
}) {
  const t = useT();
  const del = useDeleteAttachment();
  const [pendingDelete, setPendingDelete] = useState<TaskAttachmentItem | null>(
    null,
  );

  if (items.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-app-muted">
        {t("misc.taskAttachmentsEmpty")}
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
          toast.success(t("misc.fileDeleted"));
        },
        // The dialog stays open on failure so the action can be retried from
        // where it was started, rather than dropping the user back to a list
        // that still shows the file with no explanation.
        onError: () => toast.error(t("misc.fileDeleteFailed")),
      },
    );
  };

  return (
    <>
      {/* #294 — grouped into the visits they arrived on, oldest first.
          Before this it was one flat list: a job with four site visits looked
          identical to a job with one, and nothing said which pictures were the
          finished work. The grouping is free — every file already knows the note
          it came in on, and that note has a time, an author and a label. */}
      <div className="space-y-3">
        {groupJobPhotos(items).map((group) => (
          <section key={group.note_id ?? "customer"} className="space-y-1.5">
            <PhotoGroupHeader
              phase={group.work_phase}
              at={group.at}
              addedByUserId={group.added_by_user_id}
              fromCustomer={group.note_id === null}
              names={names}
            />
            <ul className="space-y-1.5">
              {group.items.map((item) => {
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
          </section>
        ))}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !del.isPending) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("misc.deleteFileTitle")}</DialogTitle>
            <DialogDescription>
              {pendingDelete?.file_name
                ? t("misc.deleteFileNamedBody", {
                    name: pendingDelete.file_name,
                  })
                : t("misc.deleteFileBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={del.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={runDelete}
              disabled={del.isPending}
            >
              {del.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                t("misc.deleteFileAction")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
