"use client";

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
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useDeleteConversations } from "@/lib/api/trash";
import { useDeletedToast } from "@/lib/hooks/use-records-delete";

/**
 * #691 — delete one conversation, or the ones ticked in the inbox.
 *
 * A confirmation AND an undo, on purpose. The Trash makes this reversible, so
 * it is not the typed-word wall that Delete forever gets; but a thread is the
 * whole history with a customer, the inbox selection can be a hundred of them,
 * and a mis-tap on the bulk bar is the likeliest way to lose a morning. The
 * dialog names the count and what stays behind (texts already sent, a STOP),
 * and the toast afterwards is built from what the server says it deleted.
 */
export function DeleteConversationsDialog({
  ids,
  open,
  onOpenChange,
  onDeleted,
}: {
  ids: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the server accepted the delete, before the undo toast. */
  onDeleted?: (deletedIds: readonly string[]) => void;
}) {
  const t = useT();
  const remove = useDeleteConversations();
  const announceDeleted = useDeletedToast();
  const count = ids.length;

  const confirm = () => {
    remove.mutate(ids, {
      onSuccess: ({ deleted }) => {
        onOpenChange(false);
        onDeleted?.(deleted);
        if (deleted.length === 0) {
          toast.error(t("trash.conversationDeleteFailed"));
          return;
        }
        const targets = deleted.map((id) => ({
          kind: "conversation" as const,
          id,
        }));
        if (deleted.length < count) {
          // Some rows were on a hidden number or already gone: say what
          // happened rather than quoting the selection.
          toast.warning(
            t("trash.conversationsDeletedPartial", {
              done: deleted.length,
              total: count,
            }),
          );
        }
        announceDeleted(
          deleted.length === 1
            ? t("trash.conversationDeleted")
            : t("trash.conversationsDeleted", { count: deleted.length }),
          targets,
        );
      },
      onError: (error) =>
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("trash.conversationDeleteFailed"),
        ),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {count === 1
              ? t("trash.deleteConversationTitle")
              : t("trash.deleteConversationsTitle", { count })}
          </DialogTitle>
          <DialogDescription>{t("trash.deleteConversationBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("trash.keep")}
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending || count === 0}
            onClick={confirm}
          >
            {t("trash.moveToTrash")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
