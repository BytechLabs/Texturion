"use client";

import { explainRejection } from "@loonext/shared";
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
import { PortDocumentsForm } from "@/components/settings/port-documents-form";
import { PortFixForm } from "@/components/settings/port-fix-form";
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
import type { Country, PortRequest } from "@/lib/api/types";
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
}: {
  step: PortStep;
  last: boolean;
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
        <p className="text-[13px] text-muted-foreground">{meaning}</p>
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
}: {
  port: PortRequest;
  country: Country;
}) {
  const { role, companyId, membership } = useActiveCompany();
  const company = useCompany().data;
  const submit = useSubmitPortRequest(port.id);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
  const beforeCutover =
    port.status === "submitted" ||
    port.status === "in-process" ||
    port.status === "foc-date-confirmed" ||
    port.status === "activation-in-progress";

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
      {/* Heading: the number + a one-line state summary (no jargon). */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p
          className={cn(
            "text-xl font-medium tabular-nums",
            ui.live && "text-success",
          )}
        >
          {display}
        </p>
        <span className="text-[13px] text-muted-foreground">
          {ui.live ? "Live on Loonext" : "Transferring to Loonext"}
        </span>
      </div>

      {/* The 4-step tracker (§8.2). */}
      <ol className="mt-5">
        {ui.steps.map((step, index) => (
          <StepRow
            key={step.key}
            step={step}
            last={index === ui.steps.length - 1}
          />
        ))}
      </ol>

      {/* One plain state banner (§9). */}
      <div className="mt-4 space-y-4">
        {ui.live ? (
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

        {/* Owner-only cancel while pre-completion. */}
        {role === "owner" && !ui.live && !ui.cancelled ? (
          <div className="border-t border-border-subtle pt-3">
            <CancelPortDialog port={port} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
