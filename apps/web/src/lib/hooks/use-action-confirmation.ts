"use client";

import {
  handoverConfirmationKind,
  type HandoverConfirmationKind,
} from "@loonext/shared";
import { useState } from "react";

import { ApiError } from "@/lib/api/error";
import { useRequestHandoverCode } from "@/lib/api/ownership";

/**
 * #537 — proof of identity in front of the things that cannot be undone.
 *
 * ## Evaluation
 *
 * Four actions now refuse to happen on a role check alone: handing the workspace
 * over, closing it, releasing a number, and turning the crew's two-factor
 * requirement off. Each answers with one of two demands — use your authenticator, or
 * enter the code we emailed — and every screen that can trigger one has to be able
 * to answer it. A screen that cannot does not merely lack a feature: the action
 * becomes impossible from there.
 *
 * ## What this is
 *
 * The plumbing, so a screen adds the gate in three lines instead of reimplementing
 * the fork. It holds the RETRY, not the inputs — the caller closes over its own
 * arguments, so an offer is retried to the same person rather than to whoever the
 * form happens to name by then.
 *
 * ```tsx
 * const gate = useActionConfirmation();
 * release.mutate(id, {
 *   onSuccess: () => gate.dismiss(),
 *   onError: (error) => {
 *     if (gate.demanded(error, "release_number", (code) => release.mutate({ id, code }))) return;
 *     gate.dismiss();
 *     toast.error(message(error));
 *   },
 * });
 * // …and once, anywhere in the tree:
 * <HandoverConfirmDialog kind={gate.kind} rejected={gate.rejected} … />
 * ```
 */

/** The actions a code can be minted for. Mirrors the API's own list. */
export type ConfirmableAction =
  | "offer"
  | "claim"
  | "accept"
  | "close_workspace"
  | "release_number"
  | "relax_mfa";

interface Held {
  kind: HandoverConfirmationKind;
  action: ConfirmableAction;
  /** The original call, closed over its own arguments, waiting for the digits. */
  retry: (code: string) => void;
}

export interface ActionConfirmation {
  /** Which prompt to show, or null when nothing is being confirmed. */
  kind: HandoverConfirmationKind | null;
  /** True after a code came back refused, so the dialog says so once. */
  rejected: boolean;
  /** True while a code is being emailed. */
  requesting: boolean;
  /**
   * Did the server ask for proof?
   *
   * Returns true when it did — the caller should stop and show nothing, because the
   * dialog is now open and will re-run `retry`. Returns false for every other
   * failure, which the caller must still report: "a transfer is already in flight"
   * dressed up as a code prompt would hide the real reason behind a code that could
   * not have helped.
   */
  demanded: (
    error: unknown,
    action: ConfirmableAction,
    retry: (code: string) => void,
  ) => boolean;
  /** Retry with the digits. */
  confirm: (code: string) => void;
  /** Email another one. Only offered on the email path. */
  resend: () => void;
  /**
   * Put the dialog away — on success as well as on cancel.
   *
   * The hook cannot see a mutation succeed, so the caller says so. Forgetting it
   * leaves a confirmed action behind its own prompt.
   */
  dismiss: () => void;
}

export function useActionConfirmation(): ActionConfirmation {
  const requestCode = useRequestHandoverCode();
  const [held, setHeld] = useState<Held | null>(null);
  const [rejected, setRejected] = useState(false);

  return {
    kind: held?.kind ?? null,
    rejected,
    requesting: requestCode.isPending,

    demanded(error, action, retry) {
      if (!(error instanceof ApiError)) return false;
      const kind = handoverConfirmationKind(error.code);
      if (kind === null) return false;

      // Already open means the code we just sent came back refused. The dialog
      // stays up and says so once — the next thing to do is ask for another.
      setRejected(held !== null);
      setHeld({ kind, action, retry });
      if (held === null && kind === "email") {
        // Asked for on open rather than behind a button: a dialog whose only
        // working control is "Send it again" has wasted somebody's time.
        requestCode.mutate(action);
      }
      return true;
    },

    confirm(code) {
      if (!held) return;
      setRejected(false);
      held.retry(code);
    },

    resend() {
      if (!held) return;
      setRejected(false);
      requestCode.mutate(held.action);
    },

    dismiss() {
      setHeld(null);
      setRejected(false);
    },
  };
}
