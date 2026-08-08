"use client";

import {
  explainRejection,
  isBeforePortCutover,
  roleHasCapability,
} from "@loonext/shared";
import { AlertTriangle, Check, CircleDashed, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  PORT_PRE_CUTOVER_CHECKLIST,
  PORT_STATE_COPY,
  PORT_STEP_COPY,
} from "@/components/porting/copy";
import {
  derivePortUiState,
  type PortStep,
} from "@/components/porting/port-ui-state";
import type { NumberHoldState } from "@/components/settings/number-hold";
import { NumberHoldNote } from "@/components/settings/number-hold-note";
import { PortDocumentsForm } from "@/components/settings/port-documents-form";
import { PortFixForm } from "@/components/settings/port-fix-form";
import { mayReleaseNumber } from "@/components/settings/release-number";
import { ReleaseNumberDialog } from "@/components/settings/release-number-dialog";
import { RejectionNotice } from "@/components/settings/rejection-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import {
  useCancelPortRequest,
  useSubmitPortRequest,
} from "@/lib/api/porting";
import type {
  Country,
  PhoneNumberSummary,
  PortRequest,
} from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

/** Human date for the confirmed switch-over (no time-of-day noise). */
function switchDate(iso: string | null): string {
  if (!iso) return "your switch-over date";
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** One tracker step — mirrors the registration-section stepper visual (§8.2). */
function StepRow({
  step,
  last,
  /** #523: false under a hold — see the tracker's comment in `PortCard`. */
  describe = true,
}: {
  step: PortStep;
  last: boolean;
  describe?: boolean;
}) {
  const { label, meaning } = PORT_STEP_COPY[step.key];
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border",
            step.state === "done" &&
              "border-transparent bg-success/15 text-success",
            step.state === "active" &&
              "border-primary/40 bg-primary/10 text-primary",
            step.state === "todo" && "border-border text-muted-foreground",
          )}
          aria-hidden
        >
          {step.state === "done" ? (
            <Check className="size-3.5" strokeWidth={2.5} />
          ) : step.state === "active" ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <CircleDashed className="size-3.5" strokeWidth={1.75} />
          )}
        </span>
        {!last && <span className="w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className={cn("pb-4", last && "pb-0")}>
        <p
          className={cn(
            "text-sm font-medium",
            step.state === "todo" && "text-muted-foreground",
          )}
        >
          {label}
          <span className="sr-only">
            {step.state === "done"
              ? ", done"
              : step.state === "active"
                ? ", in progress"
                : ", upcoming"}
          </span>
        </p>
        {describe ? (
          <p className="text-[13px] text-muted-foreground">{meaning}</p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * #319 — the short "do this before the switch" list, shown only while the
 * transfer is in flight.
 *
 * Until now this card told a customer who had just handed over the line their
 * business runs on that a transfer was in progress, and nothing else. The two
 * things that decide whether a port goes badly (don't cancel the old service,
 * export the history first) were written down only in a marketing post, which
 * is not a place anybody looks from inside the product.
 *
 * Deliberately quieter than the state banner above it: no tint, no icon, no
 * amber. Nothing has gone wrong here — an alert under a "locked in" banner
 * would read as a contradiction of it, and would out-shout the one line that
 * actually reports where the transfer is. What it borrows instead is the
 * tracker's own label/meaning pairing, so a skim catches the four bold leads
 * and can stop there.
 */
function PreCutoverChecklist() {
  return (
    <div className="border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium">
        {PORT_PRE_CUTOVER_CHECKLIST.heading}
      </h3>
      <ul className="mt-2 space-y-3">
        {PORT_PRE_CUTOVER_CHECKLIST.items.map((item) => (
          <li key={item.lead}>
            <p className="text-[13px] font-medium">{item.lead}</p>
            <p className="text-[13px] text-muted-foreground">{item.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Owner-only cancel (PORTING.md §3.8) — abandon a pre-completion transfer. */
function CancelPortDialog({ port }: { port: PortRequest }) {
  const cancel = useCancelPortRequest(port.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const display = formatPhone(port.phone_e164);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="px-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Cancel this transfer…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel the transfer of {display}?</DialogTitle>
            <DialogDescription>
              Your number stays with your current carrier and nothing changes.
              You can start the transfer again later.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep transferring
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                setError(null);
                cancel.mutate(undefined, {
                  onSuccess: () => {
                    setOpen(false);
                    toast.success("Transfer cancelled.");
                  },
                  onError: (cause) =>
                    setError(
                      cause instanceof ApiError
                        ? cause.message
                        : "Couldn't cancel the transfer. Try again.",
                    ),
                });
              }}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PortCard({
  port,
  country,
  number,
  hold,
  subscriptionActive = false,
}: {
  port: PortRequest;
  country: Country;
  /**
   * #523: the `phone_numbers` row this transfer delivered, or null while the
   * number has not arrived (`PortSection` resolves it with `numberForPort`).
   *
   * It carries the two things this card could not otherwise know. It is the row
   * a release acts on — a ported number is de-duplicated out of the `NumberCard`
   * list on purpose, so this card is the only place an owner can give the line
   * up, and without one there was no way to do it in a browser at all. And its
   * mere existence is the fact that decides which destructive control belongs
   * here: no row means the number is still with the old carrier and the transfer
   * can be called off; a row means the number is HERE and the transfer cannot.
   */
  number?: PhoneNumberSummary | null;
  /** Whether the subscription is live — half of the release rule. */
  subscriptionActive?: boolean;
  /**
   * #523: the line this transfer delivered is SUSPENDED, and why — resolved by
   * `PortSection` from the numbers list, null on every ordinary transfer.
   *
   * A ported number is de-duplicated out of the `NumberCard` list on purpose
   * (see `port-ui-state.ts`), so this card is the ONLY place its state is drawn.
   * Without this it went on saying "Live on Loonext" over a number that can
   * neither send nor answer, which is the one claim a card about a phone line
   * must never get wrong.
   */
  hold?: NumberHoldState | null;
}) {
  const { role, companyId, membership } = useActiveCompany();
  const company = useCompany().data;
  const submit = useSubmitPortRequest(port.id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  // #523: the same rule the number card applies, deliberately imported rather
  // than restated — a line that arrived by transfer must not be releasable on
  // different terms from one that was bought.
  const canRelease =
    number !== null &&
    number !== undefined &&
    roleHasCapability(role, "workspace.own") &&
    mayReleaseNumber(number.status, number.number_e164, subscriptionActive);
  // The fix form below, so the rejection notice can focus the flagged field
  // without a global query (#319, same wiring as the registration surface).
  const fixFormRef = useRef<HTMLDivElement | null>(null);

  const ui = derivePortUiState(port);
  const canEdit = role === "owner" || role === "admin";
  const display = formatPhone(port.phone_e164);
  // Null when the shared catalogue doesn't recognise the carrier's wording —
  // the raw banner below stays the honest answer for that case.
  const rejection = explainRejection("port", port.rejection_reason);
  // #319: the pre-cutover window — the request is with the carrier and the
  // number has not moved yet, which is the only stretch where the checklist is
  // still actionable. `in-process` belongs here too: it is the same "we've sent
  // it, the carrier is looking" state the banner below already folds into
  // `submitted`, so leaving it out would blank the guidance for the customers
  // most likely to be waiting. Excluded on purpose: `draft` (nothing is in
  // flight yet), `exception` (the rejection notice owns that screen and a
  // checklist under it would bury the fix), and everything from `ported`
  // onwards (too late to export, and moot once the switch has happened).
  // #248: the same four statuses, from the shared module, so a phone cannot show
  // this list at a different point in the transfer than the laptop does.
  const beforeCutover = isBeforePortCutover(port.status);

  // A cancelled/abandoned transfer collapses to a quiet released-style note.
  if (ui.cancelled && port.status === "cancelled") {
    return (
      <div className="rounded-lg border bg-card px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-lg font-medium tabular-nums text-muted-foreground line-through">
            {display}
          </p>
          <span className="text-[13px] text-muted-foreground">
            Transfer cancelled
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          This number stayed with your previous carrier. You can start a new
          transfer any time.
        </p>
      </div>
    );
  }

  function onSubmitPort() {
    setSubmitError(null);
    submit.mutate(undefined, {
      onSuccess: () =>
        toast.success("Transfer sent to your carrier. We'll keep you posted."),
      onError: (cause) =>
        setSubmitError(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't send the transfer. Try again in a moment.",
        ),
    });
  }

  return (
    <div className="rounded-lg border bg-card px-5 py-5 sm:px-6">
      {/* Heading: the number + a one-line state summary (no jargon).
          #523: a held line is neither live nor transferring, and the success
          green under "Live on Loonext" is the loudest claim on the card — so a
          hold takes both, rather than being appended as a footnote under a
          heading that already said the opposite. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p
          className={cn(
            "text-xl font-medium tabular-nums",
            ui.live && !hold && "text-success",
          )}
        >
          {display}
        </p>
        <span className="text-[13px] text-muted-foreground">
          {hold
            ? "On hold"
            : ui.live
              ? "Live on Loonext"
              : "Transferring to Loonext"}
        </span>
      </div>

      {/* The 4-step tracker (§8.2).

          #523: under a hold the milestones stay and their DESCRIPTIONS go. The
          labels name things that really happened, in order, and deleting them
          would erase a true account of the transfer to correct a false one. The
          descriptions are written in the present tense about what the line is
          doing now - "Turning on texting now", "Text your customers straight
          from Loonext" - and neither is true of a number nobody can send from.
          The hold note directly below says what IS true, which is why the
          milestones can stand without them. */}
      <ol className="mt-5">
        {ui.steps.map((step, index) => (
          <StepRow
            key={step.key}
            step={step}
            last={index === ui.steps.length - 1}
            describe={!hold}
          />
        ))}
      </ol>

      {/* One plain state banner (§9). */}
      <div className="mt-4 space-y-4">
        {/* #523: a hold REPLACES the transfer banner rather than joining it.
            Every branch below reports where the transfer is, and every one of
            them reads as good news or as patience; under a line that cannot
            send, all of them are wrong in the same direction. The stepper above
            still tells the transfer's own story truthfully — it did complete.

            Safe as an early exit because a hold and an in-flight transfer
            cannot coexist: `numberForPort` matches on the E.164, and a
            `phone_numbers` row only carries one after cutover. A transfer still
            with the carrier has no number to be suspended. */}
        {hold ? (
          <NumberHoldNote hold={hold} />
        ) : ui.live ? (
          <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            {PORT_STATE_COPY.textingLive}
          </p>
        ) : ui.exception === "voice" ? (
          // #319: the carrier's token said in plain language, plus the one
          // field to correct — the same catalogue and the same notice the
          // registration surface reads. It keeps the carrier's own words on
          // screen, demoted. An unrecognised reason keeps the raw banner
          // instead: a generic sentence would hide the only concrete thing the
          // customer was given.
          rejection ? (
            <RejectionNotice
              domain="port"
              reason={port.rejection_reason}
              submissionCount={port.submission_count}
              formRef={fixFormRef}
              company={{
                id: companyId,
                name: company?.name ?? membership.name,
                plan: company?.plan ?? null,
              }}
            />
          ) : (
            <div className="flex items-start gap-2.5 rounded-md bg-warning/10 px-3 py-2 text-sm">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-amber-800 dark:text-warning"
                strokeWidth={1.75}
                aria-hidden
              />
              {/* rejection_reason is carrier-authored — break long tokens at 375px. */}
              <span className="min-w-0 break-words">
                {PORT_STATE_COPY.voiceException(port.rejection_reason)}
              </span>
            </div>
          )
        ) : ui.exception === "messaging" ? (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
            {PORT_STATE_COPY.messagingException}
          </p>
        ) : port.status === "ported" ? (
          <p className="rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
            {PORT_STATE_COPY.numberSwitched}
          </p>
        ) : port.status === "foc-date-confirmed" ||
          port.status === "activation-in-progress" ? (
          <p className="rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
            {PORT_STATE_COPY.focConfirmed(switchDate(port.foc_date))}
          </p>
        ) : port.status === "in-process" || port.status === "submitted" ? (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {PORT_STATE_COPY.submitted}
          </p>
        ) : ui.documentsPending && port.status === "draft" ? (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {PORT_STATE_COPY.documentsPending}
          </p>
        ) : null}

        {/* #523: EVERY banner below this line predicts the number is about to
            work, and a held line is not about to work. They were gated one at a
            time and the next one was always missed: the pill was fixed, then
            the heading, then the state banner, while the bridge line still said
            "you can text today" and the blocked-assignment line still promised
            texting "switches on automatically". A reader who does what those
            sentences ask still cannot send, and now distrusts the note that
            told them so.
            So the gate is on the GROUP, not on the sentence. Anything that
            belongs to a transfer in motion goes here; a hold suppresses the
            lot, and the hold note plus the stepper are what remain. The stepper
            stays filled deliberately - the transfer really did complete, and
            emptying it would delete the true half to correct the false one. */}
        {hold ? null : (
          <>
        {/* D16: the opt-in temporary number is live — quiet good news
            alongside the state banner, so "you can text today" never gets
            lost while the real number is still transferring. */}
        {ui.bridge ? (
          <p className="rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
            {PORT_STATE_COPY.bridgeAvailable(formatPhone(ui.bridge))}
          </p>
        ) : null}

        {/* §8.2/§9: post-port 10DLC assignment blocked by the old provider's
            campaign — the one customer-actionable messaging holdup. Quiet
            amber (it's a to-do, not an alarm), alongside the state banner. */}
        {ui.assignmentBlocked ? (
          <div className="flex items-start gap-2.5 rounded-md bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-amber-800 dark:text-warning"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="min-w-0 break-words">
              {PORT_STATE_COPY.assignmentBlocked(display)}
            </span>
          </div>
        ) : null}

        {/* #319: what to do before the switch — under the state banner (which
            reports where the transfer *is*), above the cancel row. */}
        {beforeCutover ? <PreCutoverChecklist /> : null}
          </>
        )}

        {/* Draft: upload documents, then submit (documents-gated, §8.2). */}
        {port.status === "draft" && canEdit ? (
          <div className="space-y-4">
            {ui.documentsPending ? (
              <PortDocumentsForm port={port} country={country} />
            ) : null}
            {submitError ? (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            ) : null}
            <Button
              type="button"
              onClick={onSubmitPort}
              disabled={!ui.canSubmit || submit.isPending}
            >
              {submit.isPending ? "Sending…" : "Submit transfer"}
            </Button>
            {ui.documentsPending ? (
              <p className="text-[13px] text-muted-foreground">
                Upload your signed authorization and a recent bill above, then
                submit the transfer.
              </p>
            ) : null}
          </div>
        ) : port.status === "draft" && !canEdit ? (
          <p className="text-sm text-muted-foreground">
            An owner or admin uploads the documents and submits the transfer.
          </p>
        ) : null}

        {/* Exception: fix-and-resubmit (§8.2). */}
        {ui.exception === "voice" && canEdit ? (
          <div ref={fixFormRef} className="border-t border-border-subtle pt-4">
            <PortFixForm port={port} country={country} />
          </div>
        ) : ui.exception === "voice" && !canEdit ? (
          <p className="text-sm text-muted-foreground">
            Ask an owner or admin to fix the flagged details and resubmit.
          </p>
        ) : null}

        {/* #523: ONE destructive control at a time, and which one is decided by
            whether the number has arrived — not by taste.

            BEFORE IT ARRIVES the number is still the old carrier's, and calling
            the transfer off is the only thing to do with it; there is nothing to
            release. AFTER IT ARRIVES the reverse holds on both halves, and the
            server says so: `POST /v1/port-requests/:id/cancel` answers 409 on a
            `ported` order ("can no longer be cancelled"). So the cancel this
            card kept offering after cutover — voice switched, messaging still
            activating, `ui.live` therefore still false — was an action the API
            would have refused, and under a held line it additionally read as the
            way to get rid of it, which it is not.

            `port.status !== "ported"` is the server's own condition rather than
            a proxy for it. It subsumes both guards it replaces (`ui.live` needs
            a ported messaging track, and a hold needs a delivered row, which
            needs cutover) and it covers the one case a proxy misses: an owner
            who RELEASES the transferred number leaves a completed port with no
            number row at all, and a gate reasoning about the row would put
            "Cancel this transfer" back on it. */}
        {canRelease && number ? (
          <div className="border-t border-border-subtle pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="px-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
              onClick={() => setReleasing(true)}
            >
              Release this number…
            </Button>
            <ReleaseNumberDialog
              number={number}
              hold={hold}
              open={releasing}
              onOpenChange={setReleasing}
            />
          </div>
        ) : /* `workspace.own` rather than `role === "owner"`, matching the
               branch above and the capability the cancel route itself requires.
               The two are the same set today; asking one question two ways in
               adjacent branches is how they stop being. */
          roleHasCapability(role, "workspace.own") &&
          !ui.cancelled &&
          port.status !== "ported" ? (
          <div className="border-t border-border-subtle pt-3">
            <CancelPortDialog port={port} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
