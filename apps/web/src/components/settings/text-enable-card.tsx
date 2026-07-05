"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FileField } from "@/components/settings/port-documents-form";
import {
  deriveTextEnableUiState,
  HOSTED_DOCUMENT_HINTS,
  validateHostedDocument,
} from "@/components/settings/text-enable-state";
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
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useReleaseNumber } from "@/lib/api/numbers";
import {
  useCancelTextEnablement,
  useRequestTextEnablementCode,
  useResubmitTextEnablement,
  useUploadTextEnablementDocs,
  useVerifyTextEnablementCode,
} from "@/lib/api/text-enablement";
import type {
  PhoneNumberSummary,
  TextEnablement,
  TextEnablementVerificationMethod,
} from "@/lib/api/types";
import { useActiveCompany, useCompanyId } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

/**
 * One text-enablement order on Settings → Numbers (FEATURE-GAPS voice wave,
 * path B). No stepper and no invented progress — a hosted-SMS order has one
 * honest status at a time (text-enable-state.ts), so the card shows the
 * number, one plain banner, and only the action the state supports: upload
 * documents, verify number ownership while under review, resubmit after a
 * failure, (owner) cancel — or, once texting is live, the owner-only release
 * that removes texting again (type-to-confirm, same discipline as
 * number-card.tsx; DELETE /v1/numbers/:id on the linked hosted row, matched
 * by E.164 since vendor/row ids never ride the order payload).
 */

/** PDF only — the carrier's hosted-SMS document action accepts nothing else. */
const ACCEPT = ".pdf,application/pdf";

/** LOA + bill upload (PUT /v1/text-enablements/:id/documents). */
function TextEnableDocumentsForm({ order }: { order: TextEnablement }) {
  const upload = useUploadTextEnablementDocs(order.id);
  const [loa, setLoa] = useState<File | null>(null);
  const [bill, setBill] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onUpload() {
    setError(null);
    if (!loa && !bill) {
      setError(
        "Choose your signed authorization and/or a recent bill to upload.",
      );
      return;
    }
    const fileError =
      (loa ? validateHostedDocument(loa) : null) ??
      (bill ? validateHostedDocument(bill) : null);
    if (fileError) {
      setError(fileError);
      return;
    }
    try {
      await upload.mutateAsync({
        ...(loa ? { loa } : {}),
        ...(bill ? { bill } : {}),
      });
      setLoa(null);
      setBill(null);
      toast.success("Documents uploaded.");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Couldn't upload your documents. Try again in a moment.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <FileField
        id={`te-loa-${order.id}`}
        label="Signed authorization (LOA)"
        hint={HOSTED_DOCUMENT_HINTS.loa}
        filename={loa?.name ?? null}
        uploaded={order.has_loa && !loa}
        onFile={setLoa}
        accept={ACCEPT}
      />
      <FileField
        id={`te-bill-${order.id}`}
        label="Recent bill"
        hint={HOSTED_DOCUMENT_HINTS.bill}
        filename={bill?.name ?? null}
        uploaded={order.has_bill && !bill}
        onFile={setBill}
        accept={ACCEPT}
      />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        onClick={() => void onUpload()}
        disabled={upload.isPending || (!loa && !bill)}
      >
        {upload.isPending ? "Uploading…" : "Upload documents"}
      </Button>
    </div>
  );
}

/**
 * Number-ownership verification (owner/admin) — the carrier's optional proof
 * step while the order is under review: a one-time code is sent TO the number
 * (text, or an automated call for a landline), then entered here. Nothing is
 * stored locally — the Telnyx order is the source of truth — so this stays a
 * quiet two-control block, no invented "verified" badge on the card.
 */
function TextEnableVerification({ order }: { order: TextEnablement }) {
  const requestCode = useRequestTextEnablementCode(order.id);
  const verify = useVerifyTextEnablementCode(order.id);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const display = formatPhone(order.phone_e164);

  if (verified) {
    return (
      <p className="text-sm text-muted-foreground">
        Number ownership verified — nothing else to do for this step.
      </p>
    );
  }

  function onRequest(method: TextEnablementVerificationMethod) {
    setError(null);
    requestCode.mutate(method, {
      onSuccess: () =>
        toast.success(
          method === "sms"
            ? `Code texted to ${display}.`
            : `Calling ${display} with your code.`,
        ),
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't send a code. Try again in a moment.",
        ),
    });
  }

  function onVerify() {
    setError(null);
    verify.mutate(code.trim(), {
      onSuccess: () => {
        setVerified(true);
        setCode("");
        toast.success("Number verified.");
      },
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't check that code. Try again in a moment.",
        ),
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-border-subtle px-3 py-3">
      <div>
        <p className="text-sm font-medium">Verify you own this number</p>
        <p className="mt-1 text-sm text-muted-foreground">
          If the carrier asks for proof, get a one-time code at {display} — by
          text, or an automated call if it can&apos;t receive texts — and enter
          it below.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={requestCode.isPending}
          onClick={() => onRequest("sms")}
        >
          Text a code
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={requestCode.isPending}
          onClick={() => onRequest("call")}
        >
          Call with a code
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`te-code-${order.id}`} className="sr-only">
          Verification code
        </Label>
        <Input
          id={`te-code-${order.id}`}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Verification code"
          className="h-8 w-44"
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <Button
          type="button"
          size="sm"
          disabled={verify.isPending || code.trim() === ""}
          onClick={onVerify}
        >
          {verify.isPending ? "Verifying…" : "Verify"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Owner-only release of a COMPLETED enablement — the hosted counterpart of
 * number-card.tsx's ReleaseNumberDialog (same type-to-confirm discipline,
 * same DELETE /v1/numbers/:id via useReleaseNumber) with honest hosted copy:
 * releasing removes TEXTING from the landline and frees the plan slot; calls
 * never moved, so they stay with the current carrier untouched.
 */
function ReleaseHostedNumberDialog({
  order,
  hostedNumber,
}: {
  order: TextEnablement;
  hostedNumber: PhoneNumberSummary;
}) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  const release = useReleaseNumber();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const display = formatPhone(order.phone_e164);
  const expectedDigits = order.phone_e164.replace(/\D/g, "");
  const typedDigits = typed.replace(/\D/g, "");
  const matches =
    expectedDigits !== "" &&
    (typedDigits === expectedDigits || `1${typedDigits}` === expectedDigits);

  function close(next: boolean) {
    if (!next) {
      setTyped("");
      setError(null);
    }
    setOpen(next);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="px-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Release this number…
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove texting from {display}?</DialogTitle>
            <DialogDescription>
              This releases the number from Loonext: texting stops and its plan
              slot frees up. Calls aren&apos;t affected — the number itself
              stays with your current carrier. Text-enabling it again later
              means a fresh carrier review. Type the number to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`te-release-${order.id}`}>
              Type {display} to confirm
            </Label>
            <Input
              id={`te-release-${order.id}`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={display}
              autoComplete="off"
              inputMode="tel"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Keep texting
            </Button>
            <Button
              variant="destructive"
              disabled={!matches || release.isPending}
              onClick={() =>
                release.mutate(hostedNumber.id, {
                  onSuccess: () => {
                    // useReleaseNumber already patches the numbers cache and
                    // invalidates the company view; the order row converges
                    // server-side too, so refetch every affected surface.
                    queryClient.invalidateQueries({
                      queryKey: keys.numbers(companyId),
                      refetchType: "active",
                    });
                    queryClient.invalidateQueries({
                      queryKey: keys.textEnablements.all(companyId),
                      refetchType: "active",
                    });
                    close(false);
                    toast.success(`Texting removed from ${display}.`);
                  },
                  onError: (cause) =>
                    setError(
                      cause instanceof ApiError
                        ? cause.message
                        : "Couldn't release the number. Try again.",
                    ),
                })
              }
            >
              {release.isPending ? "Releasing…" : "Remove texting"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Owner-only cancel — abandon a non-terminal order; the number never moved. */
function CancelTextEnableDialog({ order }: { order: TextEnablement }) {
  const cancel = useCancelTextEnablement(order.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const display = formatPhone(order.phone_e164);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="px-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Cancel text-enablement…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop adding texting to {display}?</DialogTitle>
            <DialogDescription>
              Your number is untouched — calls and service stay with your
              current carrier. You can start again any time.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep going
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                setError(null);
                cancel.mutate(undefined, {
                  onSuccess: () => {
                    setOpen(false);
                    toast.success("Text-enablement cancelled.");
                  },
                  onError: (cause) =>
                    setError(
                      cause instanceof ApiError
                        ? cause.message
                        : "Couldn't cancel this. Try again.",
                    ),
                });
              }}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel text-enablement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TextEnableCard({
  order,
  hostedNumber = null,
}: {
  order: TextEnablement;
  /**
   * The linked `phone_numbers[source=hosted]` row (matched by E.164 in
   * TextEnableSection — the order payload carries no row id). Powers the
   * owner-only release once texting is live; null while unmatched.
   */
  hostedNumber?: PhoneNumberSummary | null;
}) {
  const { role } = useActiveCompany();
  const resubmit = useResubmitTextEnablement(order.id);
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  const ui = deriveTextEnableUiState(order);
  const canEdit = role === "owner" || role === "admin";
  const display = formatPhone(order.phone_e164);
  // Honest elapsed-time context while the carrier reviews (created_at is on
  // the wire; guarded for stale caches that predate it).
  const startedLine =
    !ui.live && order.created_at
      ? `Started ${new Date(order.created_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}.`
      : null;

  // A cancelled order collapses to a quiet released-style note.
  if (ui.cancelled) {
    return (
      <div className="rounded-lg border bg-card px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-lg font-medium tabular-nums text-muted-foreground line-through">
            {display}
          </p>
          <span className="text-[13px] text-muted-foreground">
            Text-enablement cancelled
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{ui.statusLine}</p>
      </div>
    );
  }

  function onResubmit() {
    setResubmitError(null);
    resubmit.mutate(undefined, {
      onSuccess: () =>
        toast.success("Resubmitted — we'll run it past the carrier again."),
      onError: (cause) =>
        setResubmitError(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't resubmit. Try again in a moment.",
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
          {ui.live ? "Texting live — calls unchanged" : "Adding texting"}
        </span>
      </div>
      {startedLine ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{startedLine}</p>
      ) : null}

      {/* One plain state banner — honest states only, no invented progress. */}
      <div className="mt-4 space-y-4">
        {ui.tone === "success" ? (
          <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            {ui.statusLine}
          </p>
        ) : ui.tone === "warning" ? (
          <div className="flex items-start gap-2.5 rounded-md bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-amber-800 dark:text-warning"
              strokeWidth={1.75}
              aria-hidden
            />
            {/* last_error is carrier-authored — break long tokens at 375px. */}
            <span className="min-w-0 break-words">{ui.statusLine}</span>
          </div>
        ) : (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {ui.statusLine}
          </p>
        )}

        {/* The upload window (pending with missing docs / action-required / failed). */}
        {ui.showDocumentsForm && canEdit ? (
          <TextEnableDocumentsForm order={order} />
        ) : ui.showDocumentsForm && ui.documentsPending && !canEdit ? (
          <p className="text-sm text-muted-foreground">
            An owner or admin uploads the authorization and bill.
          </p>
        ) : null}

        {/* Number-ownership verification while under review (owner/admin). */}
        {ui.canVerify && canEdit ? (
          <TextEnableVerification order={order} />
        ) : null}

        {/* Resubmit: failed, or action-required with the documents fixed. */}
        {ui.canResubmit && canEdit ? (
          <div className="space-y-2">
            {resubmitError ? (
              <p role="alert" className="text-sm text-destructive">
                {resubmitError}
              </p>
            ) : null}
            <Button
              type="button"
              onClick={onResubmit}
              disabled={resubmit.isPending}
            >
              {resubmit.isPending ? "Resubmitting…" : "Resubmit"}
            </Button>
          </div>
        ) : order.status === "failed" && !canEdit ? (
          <p className="text-sm text-muted-foreground">
            Ask an owner or admin to fix the documents and resubmit.
          </p>
        ) : null}

        {/* Owner-only cancel while non-terminal. */}
        {role === "owner" && ui.cancellable ? (
          <div className="border-t border-border-subtle pt-3">
            <CancelTextEnableDialog order={order} />
          </div>
        ) : null}

        {/* Owner-only release once live: removes texting, frees the slot —
            calls stay with the current carrier (they never moved). */}
        {role === "owner" &&
        ui.live &&
        hostedNumber &&
        hostedNumber.status !== "released" ? (
          <div className="border-t border-border-subtle pt-3">
            <ReleaseHostedNumberDialog
              order={order}
              hostedNumber={hostedNumber}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
