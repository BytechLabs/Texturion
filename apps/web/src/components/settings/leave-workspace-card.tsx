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
import { useT } from "@/i18n/provider";
import { useLeaveWorkspace } from "@/lib/api/team";
import { ApiError } from "@/lib/api/error";
import { endSessionOnThisDevice } from "@/lib/auth/end-session";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { CompanyView } from "@/lib/api/types";

/**
 * #406 — leaving a workspace yourself.
 *
 * Every membership action was something done TO a member and never BY one, so
 * a tech who quit on Friday still had the customer list on Monday: the app kept
 * working until the owner remembered to open settings. The person with the
 * strongest reason to sever the connection was the only one who could not.
 *
 * Deliberately NOT in the destructive-red family that closing a workspace uses.
 * Leaving is not destruction — nothing is deleted, everything the person sent
 * stays attributed to them, and the workspace carries on without them. Dressing
 * it as demolition would misdescribe it.
 *
 * It still confirms, because it is disruptive and one tap on a phone in a truck
 * should not end somebody's access to their own work.
 * *Applying: Ethical Friction, and the Safety Principle — a consequential
 * action states its consequences before it happens, in the words they happen
 * in.*
 */
export function LeaveWorkspaceCard({ company }: { company: CompanyView }) {
  const t = useT();
  const router = useRouter();
  const leave = useLeaveWorkspace();
  const [open, setOpen] = useState(false);

  async function confirm() {
    try {
      const result = await leave.mutateAsync();
      // The seat is gone server-side; clear this device so a stale push cannot
      // arrive for a workspace the person has left.
      await endSessionOnThisDevice(company.id);
      toast.success(
        result.conversations_released + result.tasks_released > 0
          ? t("settings.leaveWorkspaceDoneHandoff")
          : t("settings.leaveWorkspaceDone"),
      );
      router.replace("/login");
    } catch (cause) {
      setOpen(false);
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settings.leaveWorkspaceFailed"),
      );
    }
  }

  return (
    <SettingsCard
      title={t("settings.leaveWorkspaceTitle")}
      description={t("settings.leaveWorkspaceDescription")}
    >
      <div className="space-y-4">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>{t("settings.leaveWorkspaceAccessEnds")}</li>
          <li>{t("settings.leaveWorkspaceHandoff")}</li>
          <li>{t("settings.leaveWorkspaceRecordStays")}</li>
          <li>{t("settings.leaveWorkspaceComeBack")}</li>
        </ul>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t("settings.leaveWorkspaceAction")}
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.leaveWorkspaceConfirmTitle", { name: company.name })}
            </DialogTitle>
            <DialogDescription>
              {t("settings.leaveWorkspaceConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={leave.isPending}
            >
              {t("settings.leaveWorkspaceStay")}
            </Button>
            <Button onClick={confirm} disabled={leave.isPending}>
              {leave.isPending
                ? t("settings.leaveWorkspaceLeaving")
                : t("settings.leaveWorkspaceAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
