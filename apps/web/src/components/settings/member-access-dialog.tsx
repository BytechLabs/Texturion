"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sayWith, useT } from "@/i18n/provider";
import { useMemberNumberAccess } from "@/lib/api/numbers";
import { formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";
import {
  numberAccessIsRestricted,
  numberAccessLevelLabel,
  numberAccessReason,
  sortNumberAccessExplanations,
} from "@loonext/shared";

/**
 * #348 — what this person actually reaches, and why.
 *
 * The access model was complete and entirely invisible: nothing anywhere showed
 * an owner which numbers a member reaches, at what level, or which of three
 * interacting rules produced that answer. #348: *"A permission model that
 * cannot be inspected is one nobody trusts, and one where a misconfiguration is
 * found by a customer rather than by the person who made it."*
 *
 * A DIALOG, not a section on the team list. Most workspaces have one to three
 * numbers and several people; inlining this would put a paragraph under every
 * row to answer a question an owner asks about one person, occasionally. The
 * team screen stays a list of people and this opens on demand.
 *
 * RESTRICTED ROWS FIRST (`sortNumberAccessExplanations`). Somebody opening this
 * is checking a suspicion, not reading a report, and a list that opens with six
 * unrestricted rows buries the one that answers them.
 *
 * The reason line is the feature, not decoration — PORTAL-UX §3.1 asks a card to
 * name the signal that placed it, and here the signal IS the whole screen. It
 * also has to tell apart two states that look identical and are not: nobody has
 * restricted this number, versus somebody restricted it and left this person
 * out. Both leave the member un-named by any rule; only one is a mistake.
 */
export function MemberAccessDialog({
  userId,
  name,
  open,
  onOpenChange,
}: {
  userId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  // #228: these clauses are the one place a security rule is put into words,
  // and the shared module names them rather than writing them out.
  const say = sayWith(t);
  const access = useMemberNumberAccess(userId, open);
  const rows = sortNumberAccessExplanations(access.data?.numbers ?? []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.memberAccessTitle", { name })}</DialogTitle>
          <DialogDescription>
            {t("settings.memberAccessDescription")}
          </DialogDescription>
        </DialogHeader>

        {access.isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("settings.memberAccessChecking")}
          </p>
        ) : access.isError ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("settings.memberAccessLoadFailed")}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("settings.memberAccessNoNumbers")}
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row.phone_number_id}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium tabular-nums">
                    {row.number_e164
                      ? formatPhone(row.number_e164)
                      : t("settings.memberAccessUnnamedNumber")}
                  </p>
                  {/* The reason, quiet and directly under the number it
                      explains — a strong relationship gets tight spacing. */}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {numberAccessReason(row.decided_by, row.principal, say)}
                  </p>
                </div>
                {/* The level is the answer, so it is the one emphasized thing on
                    the row. Restricted is muted rather than red: this is a
                    settings readout, not an alarm, and most restrictions are
                    somebody's deliberate choice. */}
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                    numberAccessIsRestricted(row.level)
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {numberAccessLevelLabel(row.level, say)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
