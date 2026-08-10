"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import {
  useAccountDeletionPreview,
  useDeleteAccount,
} from "@/lib/api/account";
import { ApiError } from "@/lib/api/error";
import { endSessionOnThisDevice } from "@/lib/auth/end-session";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/** What has to be typed. Short, unambiguous, and not a name we might change. */
const CONFIRM_WORD = "delete";

/**
 * #346 — deleting your own account.
 *
 * Apple 5.1.1(v) requires this, but the reason to build it properly is that a
 * crew member who wants to leave has had no way to: workspace deletion is the
 * owner's alone, and being removed by somebody else is not the same thing.
 *
 * The copy draws the line the implementation actually draws — your identity
 * goes, the work stays. Someone deleting their account will assume their texts
 * to customers go with them; they do not, they cannot (the business owns that
 * record, and part of it is under a legal retention floor), and finding that
 * out afterwards would be a betrayal. So it is said first.
 */
export function DeleteAccountCard() {
  const t = useT();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const preview = useAccountDeletionPreview(expanded);
  const remove = useDeleteAccount();

  const blocked = preview.data?.blocked_by === "owner";
  const owned = preview.data?.owned_workspaces ?? [];
  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD;

  async function confirm() {
    remove.mutate(undefined, {
      onSuccess: async () => {
        await endSessionOnThisDevice(null);
        toast.success(t("settings.deleteAccountDone"));
        router.replace("/login");
      },
      onError: (cause) =>
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : t("settings.deleteAccountFailed"),
        ),
    });
  }

  return (
    <SettingsCard
      title={t("settings.deleteAccountTitle")}
      description={t("settings.deleteAccountDescription")}
    >
      <div className="space-y-4 p-4 pt-0">
        {!expanded ? (
          <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
            {t("settings.deleteAccountAction")}
          </Button>
        ) : preview.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : blocked ? (
          <div className="space-y-2 text-sm">
            <p>
              {t("settings.deleteAccountOwnerLead")}{" "}
              <strong>{owned.map((row) => row.name).join(", ")}</strong>
              {t("settings.deleteAccountOwnerTail")}
            </p>
            <p className="text-muted-foreground">
              {t("settings.deleteAccountOwnerWhere")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>{t("settings.deleteAccountSignedOut")}</li>
              {preview.data && preview.data.memberships > 0 && (
                <li>
                  {t("settings.deleteAccountLeaveLead")}{" "}
                  {preview.data.memberships === 1
                    ? t("settings.deleteAccountLeaveOne")
                    : t("settings.deleteAccountLeaveMany", {
                        count: preview.data.memberships,
                      })}
                  {preview.data.open_conversations + preview.data.open_tasks > 0
                    ? t("settings.deleteAccountLeaveHandoff")
                    : "."}
                </li>
              )}
              <li>{t("settings.deleteAccountRecordStays")}</li>
              {/* #371: said here rather than in a toast, because the moment
                  this succeeds you are signed out and there is no screen left
                  to read one on. */}
              <li>{t("settings.deleteAccountEmailNote")}</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setOpen(true)}
              >
                {t("settings.deleteAccountAction")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(false)}
              >
                {t("settings.neverMind")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTyped("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.deleteAccountConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.deleteAccountConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-account-confirm">
              {t("settings.typeToConfirmLead")}
              {" "}
              <span className="font-medium text-foreground">
                {CONFIRM_WORD}
              </span>
              {" "}
              {t("settings.typeToConfirmTail")}
            </Label>
            <Input
              id="delete-account-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              placeholder={CONFIRM_WORD}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("settings.deleteAccountKeep")}
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmed || remove.isPending}
              onClick={() => void confirm()}
            >
              {remove.isPending
                ? t("settings.deleteAccountDeleting")
                : t("settings.deleteAccountAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
