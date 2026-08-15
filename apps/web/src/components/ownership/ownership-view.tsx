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
import { useT, type Translate } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  isGatedOwnershipAction,
  useOwnership,
  useOwnershipAction,
  type Ownership,
} from "@/lib/api/ownership";

import { HandoverConfirmDialog } from "@/components/ownership/handover-confirm-dialog";
import { useActiveCompany } from "@/lib/company/provider";
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { useActionConfirmation } from "@/lib/hooks/use-action-confirmation";

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
  const t = useT();
  const ownership = useOwnership();
  const act = useOwnershipAction();
  const { membership } = useActiveCompany();
  /**
   * #537/#581/#7: the proof the server wants before the business moves.
   *
   * This page used to carry its own copy of the gate — its own held action, its own
   * rejected flag, its own retry. Two copies of one rule is how the rule drifted:
   * this one posted the digits to our API for EVERY kind, and the kind that does not
   * want them there (`mfa_reprove_required`, where the digits are proved against
   * Supabase in the browser) came back refused every single time. An owner reading
   * their own correct code called wrong, forever, on the one page that can accept a
   * workspace. The shared hook exists so there is one copy of it.
   */
  const gate = useActionConfirmation();
  const [confirmingClaim, setConfirmingClaim] = useState(false);

  /**
   * One toast grammar for all five actions, as on the Team card.
   *
   * Except when the refusal is "prove it is you". That is not an error to report — it
   * is the next step — so it goes to the gate, which collects the digits, sends them
   * wherever that kind's digits belong, and re-runs the call held here.
   *
   * Only refusals that name a proof divert. A handover refused because one is already
   * in flight, or because the caller is not the owner, still toasts: a code prompt in
   * front of a reason no code can fix hides the real reason behind it.
   */
  function run(
    input: Parameters<typeof act.mutate>[0],
    done: string,
    // Named for what it is: this runs on success only, never on a refusal. Calling it
    // `onSettled` borrowed React Query's word for success-OR-error, which would invite
    // the next caller to put cleanup here that silently never runs — on the one page
    // whose entire job is handling refusals.
    onConfirmed?: () => void,
  ) {
    act.mutate(input, {
      onSuccess: () => {
        onConfirmed?.();
        // The gate cannot see a mutation succeed, so it is told. Without this an
        // accepted workspace is left sitting behind its own code prompt.
        gate.dismiss();
        toast.success(done);
      },
      onError: (error) => {
        /**
         * The actions the server can ask about, held as the whole INPUT.
         *
         * `cancel` is deliberately ungated — vetoing a handover is the safe
         * direction, and somebody who has lost their authenticator has to be able to
         * withdraw their own request. `useOwnershipAction` strips a code off it, so
         * asking for one would collect digits it then throws away. That strip is the
         * other half of this rule; the two have to say the same thing.
         *
         * This page only ever fires `claim` and `accept`; `offer` is named because
         * the mutation's input type includes it, and a list that quietly omitted one
         * would send it down the toast path the day somebody added the control.
         *
         * Kept whole rather than as the action name because an offer carries the
         * member it is going to; a rebuilt input would be a chance to retry the
         * handover at somebody else.
         */
        const gated = isGatedOwnershipAction(input) ? input : null;
        if (
          gated !== null &&
          gate.demanded(error, gated.action, (code) =>
            run({ ...gated, code }, done, onConfirmed),
          )
        ) {
          return;
        }
        gate.dismiss();
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("misc.ownershipActionFailed"),
        );
      },
    });
  }

  const workspace = membership.name?.trim() || t("misc.ownershipThisWorkspace");

  return (
    // Narrower than the working surfaces (max-w-2xl, not 5xl): one decision
    // per page, and a paragraph somebody has to actually read before they
    // press anything. Zen of Clarity.
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("misc.ownershipTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("misc.ownershipSubtitle", { workspace })}
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
          t={t}
          onAccept={() =>
            run({ action: "accept" }, t("misc.ownershipAccepted"))
          }
          onCancel={() =>
            run({ action: "cancel" }, t("misc.ownershipStopped"))
          }
          onAskToClaim={() => setConfirmingClaim(true)}
        />
      )}

      {/* #537: the proof the server asks for before the business moves. Mounted
          here rather than inside a branch, because every action that can demand
          it is above and the dialog shows nothing until one does.

          `gate.requesting` is part of `pending` and not decoration: it covers the
          seconds a factor is being proved against Supabase, which is what stops a
          second press burning the same six digits against a second challenge and
          being told they were wrong. */}
      <HandoverConfirmDialog
        kind={gate.kind}
        pending={act.isPending || gate.requesting}
        rejected={gate.rejected}
        onConfirm={gate.confirm}
        onResend={gate.resend}
        onCancel={gate.dismiss}
      />

      {/* Ethical friction: asking to take over a business is the one action
          here that starts something, so it gets the pause and the full
          consequences in writing. Accepting does not — by then the owner has
          already been told, has already had their week, and a second dialog
          would only be ceremony. */}
      <Dialog open={confirmingClaim} onOpenChange={setConfirmingClaim}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("misc.ownershipAskTitle", { workspace })}
            </DialogTitle>
            <DialogDescription>{t("misc.ownershipAskBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmingClaim(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={act.isPending}
              onClick={() =>
                run(
                  { action: "claim" },
                  t("misc.ownershipClaimAsked"),
                  () => setConfirmingClaim(false),
                )
              }
            >
              {t("misc.ownershipAskAction")}
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
  t,
  onAccept,
  onCancel,
  onAskToClaim,
}: {
  state: Ownership;
  busy: boolean;
  t: Translate;
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
        t={t}
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
      <SettingsCard title={t("misc.ownershipInProgress")}>
        <div className="space-y-4">
          <Notice>
            <p className="text-sm font-medium">
              {state.pending.kind === "offer"
                ? t("misc.ownershipOfferedOut")
                : t("misc.ownershipClaimedByBackup")}
            </p>
            <p className="text-sm text-muted-foreground">
              {detailFor(state, t)}
            </p>
          </Notice>
          {state.can_cancel && (
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              {t("misc.ownershipStopThis")}
            </Button>
          )}
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title={t("misc.ownershipSettled")}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {state.i_am_owner
            ? t("misc.ownershipYouOwnIt")
            : t("misc.ownershipUnchanged")}
        </p>
        {/* Only the owner is offered the link: they are the only role that
            holds team.manage by definition, so this is the one place it
            cannot dead-end. */}
        {state.i_am_owner && (
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/team">
              {state.backup_member_id
                ? t("misc.ownershipManageSuccession")
                : t("misc.ownershipNameBackup")}
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
  t,
  onAccept,
  onCancel,
  onAskToClaim,
}: {
  kind: HandoverPromptKind;
  state: Ownership;
  busy: boolean;
  t: Translate;
  onAccept: () => void;
  onCancel: () => void;
  onAskToClaim: () => void;
}) {
  const cancelLabel = handoverPromptCancelLabel(kind, t);
  const acceptLabel =
    kind === "accept_offer"
      ? t("misc.ownershipAcceptAction")
      : kind === "complete_claim"
        ? t("misc.ownershipCompleteAction")
        : null;

  return (
    <SettingsCard title={t("misc.ownershipForYou")}>
      <div className="space-y-4">
        <Notice>
          <p className="text-sm font-medium">{handoverPromptHeadline(kind, t)}</p>
          <p className="text-sm text-muted-foreground">
            {detailFor(state, t, kind)}
          </p>
        </Notice>
        <div className="flex flex-wrap gap-2">
          {acceptLabel && (
            <Button type="button" disabled={busy} onClick={onAccept}>
              {acceptLabel}
            </Button>
          )}
          {kind === "backup_standing" && (
            <Button type="button" variant="outline" disabled={busy} onClick={onAskToClaim}>
              {t("misc.ownershipAskAction")}
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
function detailFor(
  state: Ownership,
  t: Translate,
  kind?: HandoverPromptKind,
): string {
  const pending = state.pending;
  switch (kind) {
    case "accept_offer":
      return t("misc.ownershipDetailAcceptOffer", {
        when: formatAbsoluteDateTime(pending?.expires_at ?? ""),
      });
    case "complete_claim":
      return t("misc.ownershipDetailCompleteClaim");
    case "claim_waiting":
      return t("misc.ownershipDetailClaimWaiting", {
        when: formatAbsoluteDateTime(pending?.ripens_at ?? ""),
      });
    case "backup_standing":
      // Loss aversion, stated once and plainly — the same sentence the owner
      // read when they named this person, so both ends of the arrangement
      // understand it the same way.
      return t("misc.ownershipDetailBackupStanding");
    default:
      break;
  }
  if (!pending) return "";
  if (pending.kind === "offer") {
    return t("misc.ownershipDetailOfferPending", {
      when: formatAbsoluteDateTime(pending.expires_at),
    });
  }
  if (pending.ready) {
    return t("misc.ownershipDetailClaimReady");
  }
  return t("misc.ownershipDetailClaimPending", {
    when: formatAbsoluteDateTime(pending.ripens_at),
  });
}
