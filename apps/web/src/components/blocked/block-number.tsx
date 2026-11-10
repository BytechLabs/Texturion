"use client";

import { roleHasCapability } from "@loonext/shared";
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
import {
  useBlockedSenders,
  useBlockSender,
  useUnblockSender,
  type BlockedSender,
} from "@/lib/api/blocked-senders";
import { ApiError } from "@/lib/api/error";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";

function onApiError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * Is this number on the workspace's block list, and may this person change it?
 * Gated like Mark spam: the API asks for `conversations.note` on both writes.
 */
export function useBlockedNumber(e164: string | null | undefined): {
  blocked: BlockedSender | undefined;
  canManage: boolean;
  unblock: () => void;
  unblocking: boolean;
} {
  const t = useT();
  const { role } = useActiveCompany();
  const list = useBlockedSenders();
  const unblockSender = useUnblockSender();
  const blocked = e164
    ? list.data?.data.find((row) => row.phone_e164 === e164)
    : undefined;
  return {
    blocked,
    canManage: roleHasCapability(role, "conversations.note"),
    unblock: () => {
      if (!blocked) return;
      unblockSender.mutate(blocked.id, {
        onSuccess: () => toast.success(t("blockedNumbers.unblocked")),
        onError: (e) => onApiError(e, t("blockedNumbers.unblockFailed")),
      });
    },
    unblocking: unblockSender.isPending,
  };
}

/** The confirmation before a block: it says what happens, and what does not. */
export function BlockNumberDialog({
  phone,
  open,
  onOpenChange,
}: {
  phone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const block = useBlockSender();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("blockedNumbers.blockTitle", { number: formatPhone(phone) })}
          </DialogTitle>
          <DialogDescription>{t("blockedNumbers.blockBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={block.isPending}
            onClick={() =>
              block.mutate(phone, {
                onSuccess: () => {
                  onOpenChange(false);
                  toast.success(t("blockedNumbers.blocked"));
                },
                onError: (e) => onApiError(e, t("blockedNumbers.blockFailed")),
              })
            }
          >
            {block.isPending
              ? t("blockedNumbers.blocking")
              : t("blockedNumbers.blockConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
