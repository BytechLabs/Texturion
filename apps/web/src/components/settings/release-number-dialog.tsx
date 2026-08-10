"use client";

import { useState } from "react";
import { toast } from "sonner";

import type { NumberHoldState } from "@/components/settings/number-hold";
import { releaseNumberBody } from "@/components/settings/release-number";
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
import { useReleaseNumber } from "@/lib/api/numbers";
import { useActionConfirmation } from "@/lib/hooks/use-action-confirmation";
import { HandoverConfirmDialog } from "@/components/ownership/handover-confirm-dialog";
import type { PhoneNumberSummary } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";

/**
 * Typed-confirmation release (G8): the owner types the number to confirm.
 *
 * # Why this is its own module (#523)
 *
 * It used to live inside `number-card.tsx`, which was fine while the number card
 * was the only surface that could release anything. It is not any more: a
 * transferred-in number is de-duplicated out of the card list on purpose (see
 * `port-ui-state.ts`), so `PortCard` is the only card that line has — and the
 * only place its release can be offered. Two hand-kept copies of an irreversible
 * confirmation is the shape `NumberHoldNote` was already extracted to avoid, and
 * the copy that drifts is always the one on the surface nobody tests.
 */
export function ReleaseNumberDialog({
  number,
  hold,
  open,
  onOpenChange,
}: {
  number: PhoneNumberSummary;
  /**
   * #523: whether this number is on hold, and why — because the paragraph below
   * is FALSE under a hold. See `releaseNumberBody`. Told rather than re-derived
   * here: the words and the control that opens them have to be about the same
   * state, and the one thing worse than no Release button on a held number is
   * one whose confirmation describes a different number.
   */
  hold?: NumberHoldState | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const release = useReleaseNumber();
  // #537 audit: permanent, and whoever holds this number next receives the texts
  // this business's customers send it. Typing the number guards against a slip; it
  // is no guard at all against somebody who is not the owner.
  const gate = useActionConfirmation();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** One attempt. The number is closed over, so a retry releases the same one. */
  function attempt(code?: string) {
    setError(null);
    release.mutate(
      { numberId: number.id, code },
      {
        onSuccess: () => {
          gate.dismiss();
          close(false);
          toast.success(t("settingsMore.releaseDone", { number: display }));
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

  const display = number.number_e164 ? formatPhone(number.number_e164) : "";
  const expectedDigits = (number.number_e164 ?? "").replace(/\D/g, "");
  const typedDigits = typed.replace(/\D/g, "");
  const matches =
    expectedDigits !== "" &&
    (typedDigits === expectedDigits || `1${typedDigits}` === expectedDigits);

  function close(next: boolean) {
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  }

  return (
    <>
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("settingsMore.releaseTitle", { number: display })}
          </DialogTitle>
          <DialogDescription>{releaseNumberBody(hold, t)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="release-confirm">
            {t("settingsMore.releaseTypeToConfirm", { number: display })}
          </Label>
          <Input
            id="release-confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={display}
            autoComplete="off"
            inputMode="tel"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {t("settingsMore.releaseKeep")}
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || release.isPending}
            onClick={() => attempt()}
          >
            {release.isPending
              ? t("settingsMore.releasing")
              : t("settingsMore.releaseConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* #537 audit: the proof the server asks for before the number is gone for
        good. A sibling rather than a child, so it stacks over this dialog and
        outlives it — a Radix root expects triggers and portals as children. */}
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
