"use client";

import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { HandoverConfirmDialog } from "@/components/ownership/handover-confirm-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  isGatedOwnershipAction,
  useOwnership,
  useOwnershipAction,
} from "@/lib/api/ownership";
import type { Member } from "@/lib/api/types";
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { useActionConfirmation } from "@/lib/hooks/use-action-confirmation";

/**
 * #332 — Ownership, on the Team page because that is where somebody already
 * is when they think about who runs this place.
 *
 * The card has three jobs and shows them in falling order of urgency:
 *
 *   1. A HANDOVER IN FLIGHT, if there is one. Unmissable, for everybody —
 *      including a plain member who is neither side of it — because the people
 *      best placed to notice a handover that should not be happening are the
 *      colleagues who know the owner is only on holiday.
 *   2. Who owns it, and the backup owner slot (owner only).
 *   3. The two actions: hand it over, or ask to take over.
 *
 * Everything about who-may-do-what comes from the server as a boolean. The
 * client never works out for itself whether somebody may claim a business.
 */
export function OwnershipCard({ members }: { members: Member[] }) {
  const t = useT();
  const ownership = useOwnership();
  const act = useOwnershipAction();
  // #581/#7: handing a business over is refused until the server knows who is
  // asking. Before this, the refusal arrived here as a toast about a code with
  // nowhere on the screen to type one — the action was simply impossible from the
  // Team page, which is the only place an owner can start one.
  const gate = useActionConfirmation();
  const [offerTo, setOfferTo] = useState<string>("");
  const [confirming, setConfirming] = useState<"offer" | "claim" | null>(null);

  const nameOf = (memberId: string | null) =>
    members.find((m) => m.id === memberId)?.display_name?.trim() ||
    t("settingsMore.ownershipTeammateFallback");

  if (ownership.isPending) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }
  if (ownership.isError || !ownership.data) return null;
  const state = ownership.data;

  const others = members.filter(
    (m) => m.deactivated_at === null && m.id !== state.owner_member_id,
  );

  function run(input: Parameters<typeof act.mutate>[0], done: string) {
    act.mutate(input, {
      onSuccess: () => {
        setConfirming(null);
        // The gate cannot see a mutation succeed, so it is told. Without this a
        // confirmed handover is left sitting behind its own code prompt.
        gate.dismiss();
        toast.success(done);
      },
      onError: (error) => {
        /**
         * The three the server can ask about — and only those three.
         *
         * `backup` and `cancel` are never gated: `useOwnershipAction` strips a code
         * off both, so collecting digits for them would collect digits it throws
         * away. Cancel especially, because vetoing a handover is the safe direction
         * and an owner who has lost their authenticator still has to be able to
         * stop one.
         *
         * Held as the whole INPUT rather than the action name, so the retry goes to
         * the person who was named when this started — rebuilding it from `offerTo`
         * would be a chance to hand the business to whoever the dropdown says by
         * then.
         */
        const gated = isGatedOwnershipAction(input) ? input : null;
        if (
          gated !== null &&
          gate.demanded(error, gated.action, (code) =>
            run({ ...gated, code }, done),
          )
        ) {
          return;
        }
        gate.dismiss();
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("settingsMore.ownershipActionFailed"),
        );
      },
    });
  }

  return (
    <SettingsCard
      title={t("settingsMore.ownershipTitle")}
      description={t("settingsMore.ownershipDescription")}
    >
      <div className="space-y-5">
        {state.pending && (
          <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <ShieldAlert
              className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500"
              strokeWidth={1.75}
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium">
                {state.pending.kind === "offer"
                  ? t("settingsMore.ownershipOffered", {
                      name: nameOf(state.pending.to_member_id),
                    })
                  : t("settingsMore.ownershipAskedToTakeOver", {
                      name: nameOf(state.pending.to_member_id),
                    })}
              </p>
              <p className="text-sm text-muted-foreground">
                {state.pending.kind === "offer" ? (
                  <>
                    {t("settingsMore.ownershipOfferExpires", {
                      when: formatAbsoluteDateTime(state.pending.expires_at),
                    })}
                  </>
                ) : state.pending.ready ? (
                  <>{t("settingsMore.ownershipWaitOver")}</>
                ) : (
                  <>
                    {t("settingsMore.ownershipCompletesAt", {
                      when: formatAbsoluteDateTime(state.pending.ripens_at),
                    })}
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {state.pending.mine && state.pending.ready && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={act.isPending}
                    onClick={() =>
                      run(
                        { action: "accept" },
                        t("settingsMore.ownershipNowYours"),
                      )
                    }
                  >
                    {state.pending.kind === "offer"
                      ? t("settingsMore.ownershipAccept")
                      : t("settingsMore.ownershipCompleteTakeover")}
                  </Button>
                )}
                {state.can_cancel && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={act.isPending}
                    onClick={() =>
                      run(
                        { action: "cancel" },
                        t("settingsMore.ownershipStopped"),
                      )
                    }
                  >
                    {/* The owner's veto and the recipient's decline are the
                        same button, because they are the same act: this is
                        not going ahead. */}
                    {state.i_am_owner && !state.pending?.mine
                      ? t("settingsMore.ownershipStopThis")
                      : t("settingsMore.ownershipDecline")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm text-muted-foreground">
            {t("settingsMore.ownershipOwnerLabel")}
          </span>
          <span className="text-sm font-medium">
            {state.i_am_owner
              ? t("settingsMore.ownershipYou")
              : nameOf(state.owner_member_id)}
          </span>
        </div>

        {state.i_am_owner && (
          <>
            <div className="space-y-2 border-t pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-medium">
                  {t("settingsMore.ownershipBackupOwner")}
                </span>
                {state.backup_member_id === null && (
                  <span className="text-xs text-amber-600 dark:text-amber-500">
                    {t("settingsMore.ownershipNobodyNamed")}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {/* Loss aversion, stated once and plainly: this is the
                    difference between a bad week and a business nobody can
                    run. */}
                {t("settingsMore.ownershipBackupBody")}
              </p>
              <Select
                value={state.backup_member_id ?? "none"}
                disabled={act.isPending || others.length === 0}
                onValueChange={(value) =>
                  run(
                    { action: "backup", memberId: value === "none" ? null : value },
                    value === "none"
                      ? t("settingsMore.ownershipBackupCleared")
                      : t("settingsMore.ownershipBackupSet", {
                          name: nameOf(value),
                        }),
                  )
                }
              >
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue
                    placeholder={t("settingsMore.ownershipChooseTeammate")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t("settingsMore.ownershipNobody")}
                  </SelectItem>
                  {others.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.display_name?.trim() ||
                        t("settingsMore.ownershipTeammateOption")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {others.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("settingsMore.ownershipInviteFirst")}
                </p>
              )}
            </div>

            {state.can_offer && others.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <span className="text-sm font-medium">
                  {t("settingsMore.ownershipHandOverTitle")}
                </span>
                <p className="text-sm text-muted-foreground">
                  {t("settingsMore.ownershipHandOverBody")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={offerTo}
                    disabled={act.isPending}
                    onValueChange={setOfferTo}
                  >
                    <SelectTrigger className="w-full sm:w-72">
                      <SelectValue
                        placeholder={t("settingsMore.ownershipChooseTeammate")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {others.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.display_name?.trim() ||
                            t("settingsMore.ownershipTeammateOption")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!offerTo || act.isPending}
                    onClick={() => setConfirming("offer")}
                  >
                    {t("settingsMore.ownershipHandItOver")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {state.can_claim && (
          <div className="space-y-2 border-t pt-4">
            <span className="text-sm font-medium">
              {t("settingsMore.ownershipYouAreBackup")}
            </span>
            <p className="text-sm text-muted-foreground">
              {t("settingsMore.ownershipClaimBody")}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={act.isPending}
              onClick={() => setConfirming("claim")}
            >
              {t("settingsMore.ownershipAskToTakeOver")}
            </Button>
          </div>
        )}
      </div>

      {/* Both of these hand a business to somebody. Neither gets a one-tap
          path — the pause is the point, and the copy is what somebody needs
          to have read before they press it. */}
      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === "offer"
                ? t("settingsMore.ownershipOfferDialogTitle", {
                    name: nameOf(offerTo),
                  })
                : t("settingsMore.ownershipClaimDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {confirming === "offer" ? (
                <>{t("settingsMore.ownershipOfferDialogBody")}</>
              ) : (
                <>{t("settingsMore.ownershipClaimDialogBody")}</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={act.isPending}
              onClick={() =>
                confirming === "offer"
                  ? run(
                      { action: "offer", memberId: offerTo },
                      t("settingsMore.ownershipOfferSent", {
                        name: nameOf(offerTo),
                      }),
                    )
                  : run(
                      { action: "claim" },
                      t("settingsMore.ownershipClaimSent"),
                    )
              }
            >
              {confirming === "offer"
                ? t("settingsMore.ownershipOfferIt")
                : t("settingsMore.ownershipAskToTakeOver")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* #581/#7: the proof the server asks for before the business moves. A
          sibling of the dialog above so it stacks over it — the consequences the
          person just read stay where they were, and cancelling here puts them back
          in front of them rather than throwing the whole decision away. */}
      <HandoverConfirmDialog
        kind={gate.kind}
        pending={act.isPending || gate.requesting}
        rejected={gate.rejected}
        onConfirm={gate.confirm}
        onResend={gate.resend}
        onCancel={gate.dismiss}
      />
    </SettingsCard>
  );
}
