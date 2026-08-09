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
    "a teammate";

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
            : "That didn't go through. Try again.",
        );
      },
    });
  }

  return (
    <SettingsCard
      title="Ownership"
      description="The owner controls billing, the spending cap, and your numbers. Only they can hand that on."
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
                  ? `Ownership has been offered to ${nameOf(state.pending.to_member_id)}.`
                  : `${nameOf(state.pending.to_member_id)} has asked to take over this workspace.`}
              </p>
              <p className="text-sm text-muted-foreground">
                {state.pending.kind === "offer" ? (
                  <>
                    Nothing changes until they accept. The offer expires{" "}
                    {formatAbsoluteDateTime(state.pending.expires_at)}.
                  </>
                ) : state.pending.ready ? (
                  <>The waiting period is over. They can complete this at any time.</>
                ) : (
                  <>
                    This completes{" "}
                    {formatAbsoluteDateTime(state.pending.ripens_at)} unless the
                    owner stops it. Stopping it takes effect immediately.
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
                      run({ action: "accept" }, "You now own this workspace.")
                    }
                  >
                    {state.pending.kind === "offer"
                      ? "Accept ownership"
                      : "Complete the takeover"}
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
                        "Stopped. Nothing changed hands.",
                      )
                    }
                  >
                    {/* The owner's veto and the recipient's decline are the
                        same button, because they are the same act: this is
                        not going ahead. */}
                    {state.i_am_owner && !state.pending?.mine
                      ? "Stop this"
                      : "Decline"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm text-muted-foreground">Owner</span>
          <span className="text-sm font-medium">
            {state.i_am_owner ? "You" : nameOf(state.owner_member_id)}
          </span>
        </div>

        {state.i_am_owner && (
          <>
            <div className="space-y-2 border-t pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-medium">Backup owner</span>
                {state.backup_member_id === null && (
                  <span className="text-xs text-amber-600 dark:text-amber-500">
                    Nobody named
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {/* Loss aversion, stated once and plainly: this is the
                    difference between a bad week and a business nobody can
                    run. */}
                If you ever can&apos;t get in — you lose your email, or worse —
                this is the one person who can ask to take over. They wait a
                week, you can stop it with one click, and everyone gets told.
                Nothing changes today.
              </p>
              <Select
                value={state.backup_member_id ?? "none"}
                disabled={act.isPending || others.length === 0}
                onValueChange={(value) =>
                  run(
                    { action: "backup", memberId: value === "none" ? null : value },
                    value === "none"
                      ? "Backup owner cleared."
                      : `${nameOf(value)} is your backup owner.`,
                  )
                }
              >
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Choose a teammate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nobody</SelectItem>
                  {others.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.display_name?.trim() || "A teammate"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {others.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Invite someone first — a backup has to be on the team.
                </p>
              )}
            </div>

            {state.can_offer && others.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <span className="text-sm font-medium">
                  Hand the workspace over
                </span>
                <p className="text-sm text-muted-foreground">
                  They have to accept. You stay on the team as an admin.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={offerTo}
                    disabled={act.isPending}
                    onValueChange={setOfferTo}
                  >
                    <SelectTrigger className="w-full sm:w-72">
                      <SelectValue placeholder="Choose a teammate" />
                    </SelectTrigger>
                    <SelectContent>
                      {others.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.display_name?.trim() || "A teammate"}
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
                    Hand it over
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {state.can_claim && (
          <div className="space-y-2 border-t pt-4">
            <span className="text-sm font-medium">You are the backup owner</span>
            <p className="text-sm text-muted-foreground">
              If the owner can&apos;t act, you can ask to take over. They get a
              week to stop it, and everyone on the team is told straight away.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={act.isPending}
              onClick={() => setConfirming("claim")}
            >
              Ask to take over
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
                ? `Hand this workspace to ${nameOf(offerTo)}?`
                : "Ask to take over this workspace?"}
            </DialogTitle>
            <DialogDescription>
              {confirming === "offer" ? (
                <>
                  Nothing changes until they accept. When they do, they control
                  billing, the spending cap, and your numbers — and you stay on
                  the team as an admin. You can cancel any time before they
                  accept, and everyone will be told either way.
                </>
              ) : (
                <>
                  The owner will be emailed straight away and can stop this
                  with one click for the next 7 days. Everyone on the team is
                  told too. If nobody stops it, you can complete the takeover
                  after 7 days. Only do this if the owner genuinely cannot act.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={act.isPending}
              onClick={() =>
                confirming === "offer"
                  ? run(
                      { action: "offer", memberId: offerTo },
                      `Offered to ${nameOf(offerTo)}. They have 7 days to accept.`,
                    )
                  : run(
                      { action: "claim" },
                      "Asked. The owner has 7 days to stop it.",
                    )
              }
            >
              {confirming === "offer" ? "Offer it" : "Ask to take over"}
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
