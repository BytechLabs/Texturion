"use client";

import {
  isDowngrade,
  type MemberRole,
  selfDowngradeWarning,
} from "@loonext/shared";

import { useT } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * #538 — does this role change have to stop and ask first?
 *
 * A named function rather than an inline condition, so the decision is testable
 * without driving a Radix dropdown through a headless DOM. That matters: the thing
 * worth asserting here is WHEN the product interrupts somebody, and a test that
 * could only reach it by simulating pointer events on a portal would be a test
 * about Radix.
 *
 * True only for the caller's own row, and only when the change takes something
 * away. An owner demoting somebody else can undo it, and a confirmation that fires
 * on everything is one people learn to dismiss before it matters.
 */
export function roleChangeNeedsConfirming(
  isSelf: boolean,
  from: MemberRole,
  to: MemberRole,
): boolean {
  return isSelf && isDowngrade(from, to);
}

export function GiveUpAccessDialog({
  from,
  to,
  pending,
  onCancel,
  onConfirm,
}: {
  from: MemberRole;
  /** The role being asked for, or null when nothing is being given up. */
  to: "admin" | "member" | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  // The warning comes from the shared rule, so the three clients and the server
  // agree about what a role costs — see packages/shared/src/self-downgrade.ts.
  const warning = to ? selfDowngradeWarning(from, to, t) : null;

  return (
    <Dialog open={to !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.giveUpAccessTitle")}</DialogTitle>
          <DialogDescription>{warning}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {t("settings.giveUpAccessKeep")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending
              ? t("settings.giveUpAccessChanging")
              : t("settings.giveUpAccessMakeMe", {
                  role:
                    to === "admin"
                      ? t("settings.roleAdminWord")
                      : t("settings.roleMemberWord"),
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
