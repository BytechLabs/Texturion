"use client";

import {
  handoverPromptCancelLabel,
  handoverPromptHeadline,
  viewerHandoverPrompt,
  type HandoverPromptKind,
} from "@loonext/shared";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { LoadError, SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/error";
import { useOwnership, useOwnershipAction, type Ownership } from "@/lib/api/ownership";
import { useActiveCompany } from "@/lib/company/provider";
import { formatAbsoluteDateTime } from "@/lib/format/time";

/**
 * /ownership (#515) — the handover surface for whoever is reading it.
 *
 * The Team settings card is where an OWNER manages succession, and it stays
 * there: it needs the roster, it names people, and it carries the controls
 * only an owner has. This page is the other half — what the handover looks
 * like to the person it is happening TO. It lives outside /settings on
 * purpose:
 *
 *   - the nominee is routinely a plain member (the DB allows any active
 *     member, and #332's whole premise is that succession does not track
 *     rank), so anything behind `team.manage` is invisible to them;
 *   - every ownership email links here, and an email that lands on a 403 is
 *     the same as no email at all.
 *
 * It asks for NOTHING a member does not already have: `GET /v1/company/
 * ownership` is mounted at `workspace.access` and decides every button
 * server-side. In particular this page never loads the member roster — the
 * copy is first-person throughout, so it has no names to look up and no
 * dependency on how the roster is gated.
 */
export function OwnershipView() {
  const ownership = useOwnership();
  const act = useOwnershipAction();
  const { membership } = useActiveCompany();
  const [confirmingClaim, setConfirmingClaim] = useState(false);

  const workspace = membership.name?.trim() || "this workspace";

  return (
    // Narrower than the working surfaces (max-w-2xl, not 5xl): one decision
    // per page, and a paragraph somebody has to actually read before they
    // press anything. Zen of Clarity.
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Ownership</h1>
        <p className="text-sm text-muted-foreground">
          Who {workspace} belongs to, and anything in the middle of changing
          that.
        </p>
      </header>

      {ownership.isPending && <Skeleton className="h-48 w-full rounded-lg" />}
      {ownership.isError && (
        <LoadError onRetry={() => void ownership.refetch()} />
      )}
      {ownership.data && (
        <Body
          state={ownership.data}
          busy={act.isPending}
          onAccept={() =>
            run(act, { action: "accept" }, "You now own this workspace.")
          }
          onCancel={() =>
            run(act, { action: "cancel" }, "Stopped. Nothing changed hands.")
          }
          onAskToClaim={() => setConfirmingClaim(true)}
        />
      )}

      {/* Ethical friction: asking to take over a business is the one action
          here that starts something, so it gets the pause and the full
          consequences in writing. Accepting does not — by then the owner has
          already been told, has already had their week, and a second dialog
          would only be ceremony. */}
      <Dialog open={confirmingClaim} onOpenChange={setConfirmingClaim}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask to take over {workspace}?</DialogTitle>
            <DialogDescription>
              The owner will be emailed straight away and can stop this with one
              click for the next 7 days. Everyone on the team is told too. If
              nobody stops it, you can complete the takeover after 7 days. Only
              do this if the owner genuinely cannot act.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmingClaim(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={act.isPending}
              onClick={() =>
                run(
                  act,
                  { action: "claim" },
                  "Asked. The owner has 7 days to stop it.",
                  () => setConfirmingClaim(false),
                )
              }
            >
              Ask to take over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Body({
  state,
  busy,
  onAccept,
  onCancel,
  onAskToClaim,
}: {
  state: Ownership;
  busy: boolean;
  onAccept: () => void;
  onCancel: () => void;
  onAskToClaim: () => void;
}) {
  const prompt = viewerHandoverPrompt(state);

  if (prompt) {
    return (
      <PromptCard
        kind={prompt}
        state={state}
        busy={busy}
        onAccept={onAccept}
        onCancel={onCancel}
        onAskToClaim={onAskToClaim}
      />
    );
  }

  // Not their handover — but every ownership email goes to the WHOLE crew, so
  // whoever follows one lands here, and the owner's veto has to be on this
  // page or the loudest email in the product points at a button they cannot
  // reach. Shown without names: this surface never loads the roster.
  if (state.pending) {
    return (
      <SettingsCard title="A handover is in progress">
        <div className="space-y-4">
          <Notice>
            <p className="text-sm font-medium">
              {state.pending.kind === "offer"
                ? "Ownership of this workspace has been offered to a teammate."
                : "The backup owner has asked to take over this workspace."}
            </p>
            <p className="text-sm text-muted-foreground">
              {detailFor(state)}
            </p>
          </Notice>
          {state.can_cancel && (
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              Stop this
            </Button>
          )}
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title="Nothing is changing hands">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {state.i_am_owner
            ? "You own this workspace. If you ever can't get in, a backup owner is the one person who can ask to take over — name one before you need one."
            : "This workspace has the owner it has always had. If that ever needs to change, whoever it involves will find it here."}
        </p>
        {/* Only the owner is offered the link: they are the only role that
            holds team.manage by definition, so this is the one place it
            cannot dead-end. */}
        {state.i_am_owner && (
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/team">
              {state.backup_member_id ? "Manage succession" : "Name a backup owner"}
            </Link>
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}

function PromptCard({
  kind,
  state,
  busy,
  onAccept,
  onCancel,
  onAskToClaim,
}: {
  kind: HandoverPromptKind;
  state: Ownership;
  busy: boolean;
  onAccept: () => void;
  onCancel: () => void;
  onAskToClaim: () => void;
}) {
  const cancelLabel = handoverPromptCancelLabel(kind);
  const acceptLabel =
    kind === "accept_offer"
      ? "Accept ownership"
      : kind === "complete_claim"
        ? "Complete the takeover"
        : null;

  return (
    <SettingsCard title="This is for you">
      <div className="space-y-4">
        <Notice>
          <p className="text-sm font-medium">{handoverPromptHeadline(kind)}</p>
          <p className="text-sm text-muted-foreground">{detailFor(state, kind)}</p>
        </Notice>
        <div className="flex flex-wrap gap-2">
          {acceptLabel && (
            <Button type="button" disabled={busy} onClick={onAccept}>
              {acceptLabel}
            </Button>
          )}
          {kind === "backup_standing" && (
            <Button type="button" variant="outline" disabled={busy} onClick={onAskToClaim}>
              Ask to take over
            </Button>
          )}
          {cancelLabel && state.can_cancel && (
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

/**
 * The tinted block. Same amber the Team card uses for a handover in flight —
 * somebody scrolling past should not be able to mistake this for a settings
 * row, and the two surfaces describing the same event should look like each
 * other.
 */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <ShieldAlert
        className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500"
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  );
}

/** What happens next, and by when. First-person when it is theirs. */
function detailFor(state: Ownership, kind?: HandoverPromptKind): string {
  const pending = state.pending;
  switch (kind) {
    case "accept_offer":
      return (
        "Accepting makes you responsible for billing, the spending cap and your " +
        "numbers; the current owner stays on the team as an admin. Everyone is " +
        "told either way. The offer expires " +
        formatAbsoluteDateTime(pending?.expires_at ?? "") +
        "."
      );
    case "complete_claim":
      return (
        "The waiting period is over and nobody stopped it. Completing this makes " +
        "you the owner — billing, the spending cap and your numbers — and puts " +
        "the previous owner on the team as an admin."
      );
    case "claim_waiting":
      return (
        "The owner has been emailed and can stop this until " +
        formatAbsoluteDateTime(pending?.ripens_at ?? "") +
        ". If nobody stops it, you can complete the takeover after that."
      );
    case "backup_standing":
      // Loss aversion, stated once and plainly — the same sentence the owner
      // read when they named this person, so both ends of the arrangement
      // understand it the same way.
      return (
        "If the owner ever can't get in — they leave, they lose access to their " +
        "email, or worse — you're the one person who can ask to take over. They " +
        "get a week to say no, and everyone on the team is told. Nothing " +
        "changes until you ask."
      );
    default:
      break;
  }
  if (!pending) return "";
  if (pending.kind === "offer") {
    return `Nothing changes until they accept. The offer expires ${formatAbsoluteDateTime(pending.expires_at)}.`;
  }
  if (pending.ready) {
    return "The waiting period is over. They can complete this at any time.";
  }
  return `This completes ${formatAbsoluteDateTime(pending.ripens_at)} unless the owner stops it. Stopping it takes effect immediately.`;
}

/** One toast grammar for all five actions, as on the Team card. */
function run(
  act: ReturnType<typeof useOwnershipAction>,
  input: Parameters<ReturnType<typeof useOwnershipAction>["mutate"]>[0],
  done: string,
  onSettled?: () => void,
) {
  act.mutate(input, {
    onSuccess: () => {
      onSettled?.();
      toast.success(done);
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError
          ? error.message
          : "That didn't go through. Try again.",
      ),
  });
}
