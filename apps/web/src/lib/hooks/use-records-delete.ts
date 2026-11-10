"use client";

import { roleHasCapability } from "@loonext/shared";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { undoableToast } from "@/components/ui/optimistic-undo";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useRestoreFromTrash, type TrashTarget } from "@/lib/api/trash";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * #691 — may this member delete records. Every delete control hides behind it;
 * the server refuses the call with a 403 regardless, so this is a courtesy that
 * keeps a dead button off the screen.
 */
export function useCanDeleteRecords(): boolean {
  return roleHasCapability(useActiveCompany().role, "records.delete");
}

/**
 * The undo half of every reversible delete: the "moved to Trash" toast whose
 * Undo restores exactly what was deleted. A restore that the server refuses
 * (the conversation went to the Trash in the meantime, for one) says so in the
 * server's own sentence instead of silently leaving the item deleted.
 */
export function useDeletedToast() {
  const t = useT();
  const router = useRouter();
  const restore = useRestoreFromTrash();
  return (message: string, targets: readonly TrashTarget[]) => {
    if (targets.length === 0) return;
    undoableToast({
      message,
      undoLabel: t("thread.undo"),
      // #710: the Trash is otherwise only under Settings > History.
      secondary: {
        label: t("trash.viewTrash"),
        onClick: () => router.push("/trash"),
      },
      onUndo: () =>
        restore.mutate(targets, {
          onSuccess: () => toast.success(t("trash.restored")),
          onError: (error) =>
            toast.error(
              error instanceof ApiError ? error.message : t("trash.restoreFailed"),
            ),
        }),
    });
  };
}
