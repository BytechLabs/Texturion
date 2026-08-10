"use client";

import {
  HANDOVER_CONFIRM_FIELD,
  HANDOVER_CONFIRM_REJECTED,
  HANDOVER_CONFIRM_RESEND,
  HANDOVER_CONFIRM_SUBMIT,
  HANDOVER_CONFIRM_SUBMITTING,
  HANDOVER_CONFIRM_TITLE,
  HANDOVER_CONFIRM_WHERE,
  type HandoverConfirmationKind,
  isHandoverCode,
} from "@loonext/shared";
import { useEffect, useState } from "react";

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

/**
 * #537 — the confirmation in front of a handover.
 *
 * ## Evaluation
 *
 * The server now refuses to move a business without proof it is really the owner
 * asking. Three demands answer that — use your authenticator, prove your factor
 * again because the last time was too long ago (#581/#7), or enter the code emailed
 * to the account — and without this dialog the refusal was a dead end: the action
 * failed with a message about a code nobody could enter.
 *
 * All three collect the same thing here, and there is deliberately no branch for the
 * third: the person opens the same app and reads the same six digits, so a second
 * phrasing for the identical physical act would read as a different demand. What
 * differs is where the digits GO, which is `useActionConfirmation`'s business — for
 * `reprove` they are proved against Supabase in the browser and the action is
 * retried with none. This component never needs to know which.
 *
 * ## What binds it
 *
 * *Zen of Clarity* — one field and one sentence. The sentence differs by mechanism,
 * because "enter your code" is useless to somebody who does not know which code,
 * and the two live in completely different places.
 *
 * *Smart Defaults* — the field is focused on open and accepts a pasted code with
 * the whitespace an email carries. Nobody should have to clean up a copy-paste to
 * confirm a handover.
 *
 * *Ethical Friction, deliberately* — this is the friction, and it belongs here.
 * Everything about the dialog is therefore about making the legitimate path fast
 * rather than making it feel weighty: no typed confirmation, no second checkbox,
 * no countdown.
 *
 * Resend appears only on the email path. There is nothing to resend to somebody
 * using an authenticator — the app generates the codes — and offering it would
 * imply we could send them one. Same for `reprove`, which is why the test is
 * `kind === "email"` rather than a list of the kinds that do not get it.
 */
export function HandoverConfirmDialog({
  kind,
  pending,
  rejected,
  onConfirm,
  onResend,
  onCancel,
}: {
  /** Which prompt the server asked for, or null when nothing is being confirmed. */
  kind: HandoverConfirmationKind | null;
  pending: boolean;
  /** True after a code came back refused, so the copy can say so once. */
  rejected: boolean;
  onConfirm: (code: string) => void;
  onResend: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [code, setCode] = useState("");

  // Cleared whenever the dialog opens for a new demand. Without this, a second
  // attempt starts pre-filled with the digits that were just refused — which
  // reads as though the app is retrying by itself.
  useEffect(() => {
    if (kind !== null) setCode("");
  }, [kind]);

  // And cleared when a code comes back refused, which is the case the sentence above
  // was actually written for and did not cover: a refusal does not change the KIND, so
  // nothing re-ran and the rejected digits sat there with Confirm still lit. An
  // authenticator code has rotated by then, so pressing it again was guaranteed to fail
  // — and on the emailed path it spent another of the five attempts doing so.
  useEffect(() => {
    if (rejected) setCode("");
  }, [rejected]);

  const valid = isHandoverCode(code);

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{HANDOVER_CONFIRM_TITLE}</DialogTitle>
          <DialogDescription>
            {kind ? HANDOVER_CONFIRM_WHERE[kind] : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="handover-code">{HANDOVER_CONFIRM_FIELD}</Label>
          <Input
            id="handover-code"
            // `text` with a numeric keypad rather than `number`: a number input
            // strips leading zeros, and a code beginning 0 is one in ten.
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && valid && !pending) onConfirm(code);
            }}
          />
          {rejected && (
            <p role="status" className="text-[12.5px] text-app-clay">
              {HANDOVER_CONFIRM_REJECTED}
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {kind === "email" ? (
            <Button variant="ghost" onClick={onResend} disabled={pending}>
              {HANDOVER_CONFIRM_RESEND}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!valid || pending}
              onClick={() => onConfirm(code)}
            >
              {pending ? HANDOVER_CONFIRM_SUBMITTING : HANDOVER_CONFIRM_SUBMIT}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
