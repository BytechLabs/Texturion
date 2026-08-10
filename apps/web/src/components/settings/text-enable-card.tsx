"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FileField } from "@/components/settings/port-documents-form";
import {
  deriveTextEnableUiState,
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
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useReleaseNumber } from "@/lib/api/numbers";
import { useActionConfirmation } from "@/lib/hooks/use-action-confirmation";
import { HandoverConfirmDialog } from "@/components/ownership/handover-confirm-dialog";
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
  const t = useT();
  const upload = useUploadTextEnablementDocs(order.id);
  const [loa, setLoa] = useState<File | null>(null);
  const [bill, setBill] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onUpload() {
    setError(null);
    if (!loa && !bill) {
      setError(t("settingsMore.portDocNothingChosen"));
      return;
    }
    const fileError =
      (loa ? validateHostedDocument(loa, t) : null) ??
      (bill ? validateHostedDocument(bill, t) : null);
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
      toast.success(t("settingsMore.portDocUploaded"));
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.portDocUploadFailed"),
      );
    }
  }

  return (
    <div className="space-y-4">
      <FileField
        id={`te-loa-${order.id}`}
        label={t("settingsMore.portDocLoaLabel")}
        hint={t("settingsMore.hostedLoaHint")}
        filename={loa?.name ?? null}
        uploaded={order.has_loa && !loa}
        onFile={setLoa}
        accept={ACCEPT}
      />
      <FileField
        id={`te-bill-${order.id}`}
        label={t("settingsMore.portDocInvoiceLabel")}
        hint={t("settingsMore.hostedBillHint")}
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
        {upload.isPending
          ? t("settingsMore.portDocUploading")
          : t("settingsMore.portDocUploadAction")}
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
  const t = useT();
  const requestCode = useRequestTextEnablementCode(order.id);
  const verify = useVerifyTextEnablementCode(order.id);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const display = formatPhone(order.phone_e164);

  if (verified) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settingsMore.hostedVerified")}
      </p>
    );
  }

  function onRequest(method: TextEnablementVerificationMethod) {
    setError(null);
    requestCode.mutate(method, {
      onSuccess: () =>
        toast.success(
          method === "sms"
            ? t("settingsMore.hostedCodeTexted", { number: display })
            : t("settingsMore.hostedCodeCalling", { number: display }),
        ),
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : t("settingsMore.hostedCodeSendFailed"),
        ),
    });
  }

  function onVerify() {
    setError(null);
    verify.mutate(code.trim(), {
      onSuccess: () => {
        setVerified(true);
        setCode("");
        toast.success(t("settingsMore.hostedNumberVerified"));
      },
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : t("settingsMore.hostedCodeCheckFailed"),
        ),
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-border-subtle px-3 py-3">
      <div>
        <p className="text-sm font-medium">
          {t("settingsMore.hostedVerifyTitle")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settingsMore.hostedVerifyBody", { number: display })}
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
          {t("settingsMore.hostedTextACode")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={requestCode.isPending}
          onClick={() => onRequest("call")}
        >
          {t("settingsMore.hostedCallWithCode")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`te-code-${order.id}`} className="sr-only">
          {t("settingsMore.regOtpLabel")}
        </Label>
        <Input
          id={`te-code-${order.id}`}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t("settingsMore.regOtpLabel")}
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
          {verify.isPending
            ? t("settingsMore.hostedVerifying")
            : t("settingsMore.regOtpVerify")}
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
  const t = useT();
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  const release = useReleaseNumber();
  // #537 audit: this gives the number up for good, same as the settings release —
  // so it asks for the same proof. Typing the number guards against a slip, not
  // against somebody who is not the owner.
  const gate = useActionConfirmation();

  /** One attempt. The number is closed over, so a retry releases the same one. */
  function attempt(code?: string) {
    setError(null);
    release.mutate(
      { numberId: hostedNumber.id, code },
      {
        onSuccess: () => {
          // useReleaseNumber already patches the numbers cache and invalidates
          // the company view; the order row converges server-side too, so
          // refetch every affected surface.
          queryClient.invalidateQueries({
            queryKey: keys.numbers(companyId),
            refetchType: "active",
          });
          queryClient.invalidateQueries({
            queryKey: keys.textEnablements.all(companyId),
            refetchType: "active",
          });
          gate.dismiss();
          close(false);
          toast.success(
            t("settingsMore.hostedTextingRemoved", { number: display }),
          );
        },
        onError: (cause) => {
          if (gate.demanded(cause, "release_number", (digits) => attempt(digits))) {
            return;
          }
          gate.dismiss();
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("settingsMore.releaseFailed"),
          );
        },
      },
    );
  }
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
        {t("settingsMore.numberReleaseAction")}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settingsMore.hostedRemoveTitle", { number: display })}
            </DialogTitle>
            <DialogDescription>
              {t("settingsMore.hostedRemoveBody")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`te-release-${order.id}`}>
              {t("settingsMore.releaseTypeToConfirm", { number: display })}
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
              {t("settingsMore.hostedKeepTexting")}
            </Button>
            <Button
              variant="destructive"
              disabled={!matches || release.isPending}
              onClick={() => attempt()}
            >
              {release.isPending
                ? t("settingsMore.releasing")
                : t("settingsMore.hostedRemoveTexting")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* #537 audit: the proof the server asks for before the number is gone for
          good. A sibling of the dialog, so it stacks over it. */}
      <HandoverConfirmDialog
        kind={gate.kind}
        pending={release.isPending || gate.requesting}
        rejected={gate.rejected}
        onConfirm={gate.confirm}
        onResend={gate.resend}
        onCancel={gate.dismiss}
      />
    </>
  );
}

/** Owner-only cancel — abandon a non-terminal order; the number never moved. */
function CancelTextEnableDialog({ order }: { order: TextEnablement }) {
  const t = useT();
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
        {t("settingsMore.hostedCancelAction")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settingsMore.hostedCancelTitle", { number: display })}
            </DialogTitle>
            <DialogDescription>
              {t("settingsMore.hostedCancelBody")}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("settingsMore.hostedKeepGoing")}
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                setError(null);
                cancel.mutate(undefined, {
                  onSuccess: () => {
                    setOpen(false);
                    toast.success(t("settingsMore.hostedCancelled"));
                  },
                  onError: (cause) =>
                    setError(
                      cause instanceof ApiError
                        ? cause.message
                        : t("settingsMore.hostedCancelFailed"),
                    ),
                });
              }}
            >
              {cancel.isPending
                ? t("settingsMore.portCancelling")
                : t("settingsMore.hostedCancelConfirm")}
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
  const t = useT();
  const { role } = useActiveCompany();
  const resubmit = useResubmitTextEnablement(order.id);
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  const ui = deriveTextEnableUiState(order, t);
  const canEdit = role === "owner" || role === "admin";
  const display = formatPhone(order.phone_e164);
  // Honest elapsed-time context while the carrier reviews (created_at is on
  // the wire; guarded for stale caches that predate it).
  const startedLine =
    !ui.live && order.created_at
      ? t("settingsMore.hostedStartedOn", {
          date: new Date(order.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
        })
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
            {t("settingsMore.hostedCancelledPill")}
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
        toast.success(t("settingsMore.hostedResubmitted")),
      onError: (cause) =>
        setResubmitError(
          cause instanceof ApiError
            ? cause.message
            : t("settingsMore.regResubmitFailed"),
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
          {ui.live
            ? t("settingsMore.hostedLive")
            : t("settingsMore.hostedAdding")}
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
            {t("settingsMore.hostedOwnerUploads")}
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
              {resubmit.isPending
                ? t("settingsMore.portFixResubmitting")
                : t("settingsMore.hostedResubmit")}
            </Button>
          </div>
        ) : order.status === "failed" && !canEdit ? (
          <p className="text-sm text-muted-foreground">
            {t("settingsMore.hostedAskOwnerToFix")}
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
