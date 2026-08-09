"use client";

import {
  HANDOVER_CODE_DESTINATION,
  handoverConfirmationKind,
  type HandoverConfirmationKind,
} from "@loonext/shared";
import { useRef, useState } from "react";

import { ApiError } from "@/lib/api/error";
import { useRequestHandoverCode } from "@/lib/api/ownership";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * #537 — proof of identity in front of the things that cannot be undone.
 *
 * ## Evaluation
 *
 * Four actions now refuse to happen on a role check alone: handing the workspace
 * over, closing it, releasing a number, and turning the crew's two-factor
 * requirement off. Each answers with one of three demands — use your authenticator,
 * prove your factor AGAIN because the last time was too long ago, or enter the code
 * we emailed — and every screen that can trigger one has to be able to answer it. A
 * screen that cannot does not merely lack a feature: the action becomes impossible
 * from there.
 *
 * ## The fork that is not about copy
 *
 * `authenticator` and `email` both end the same way: the six digits are posted to
 * OUR API as `code` on the retry, and it checks them.
 *
 * `reprove` (#581/#7) does not. The server is not checking a code there — it is
 * checking how long ago this session last proved a factor, read off the token's
 * `amr` claim — so the six digits go to SUPABASE, in this browser, which refreshes
 * the session and stamps a new proof time. Only then is the action retried, with NO
 * code at all, because the API's enrolled path has none to read.
 *
 * Posting a `reprove` code to our API instead would loop forever: the same refusal
 * would come back every time, because nothing about the session changed. That is a
 * hard lockout out of ownership transfer and workspace closure — strictly worse than
 * the freshness gap the whole change exists to close.
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
  /**
   * The original call, closed over its own arguments, waiting for the digits.
   *
   * Takes `string | undefined` rather than `string` because `reprove` re-runs it
   * with nothing: the digits were spent on Supabase, and the API's enrolled path
   * ignores a code anyway.
   */
  retry: (code: string | undefined) => void;
}

export interface ActionConfirmation {
  /** Which prompt to show, or null when nothing is being confirmed. */
  kind: HandoverConfirmationKind | null;
  /** True after a code came back refused, so the dialog says so once. */
  rejected: boolean;
  /**
   * True while the gate itself is busy: emailing a code, or proving a factor to
   * Supabase on the `reprove` path.
   *
   * Both live under one flag deliberately. Every caller already ORs this into the
   * dialog's `pending`, which is the thing that stops a second submit landing while
   * a verify is in flight — a separate flag would leave that hole open at every
   * call site until each one was taught the new name.
   */
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
    retry: (code: string | undefined) => void,
  ) => boolean;
  /**
   * Answer the demand with the digits.
   *
   * Where they go depends on the kind: to our API as `code` for `authenticator` and
   * `email`, to Supabase for `reprove` — after which the action is retried with no
   * code. Stays `void` rather than becoming a promise: no caller awaits it, and the
   * one branch that is asynchronous reports itself through `requesting` and
   * `rejected` like everything else here.
   */
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
  /**
   * The same value, readable from a STALE closure.
   *
   * `demanded` is called from the caller's `onError`, and every caller writes that
   * handler inside a function defined in one render — so the retry re-runs it against
   * THAT render's hook object, where `held` is still whatever it was before the first
   * refusal: null. Both of `demanded`'s decisions turn on "is the dialog already
   * open", so both got the wrong answer on precisely the attempt that matters. A
   * refused code said nothing at all, and on the email path it quietly mailed a NEW
   * code — invalidating the one the person was reading, so they could keep typing
   * correct digits from the older email forever.
   *
   * A ref rather than state because it has to be current within the tick, and state
   * captured in a closure never is.
   */
  const heldRef = useRef<Held | null>(null);
  const [rejected, setRejected] = useState(false);
  /** True from the moment a `reprove` code is submitted until Supabase answers. */
  const [verifying, setVerifying] = useState(false);
  /**
   * The verify currently in flight, or null. A ref because it has two jobs that
   * state cannot do:
   *
   *   - it is read SYNCHRONOUSLY to refuse a second submit. `verifying` is set in
   *     the same tick, so the closure already running cannot see it, and two
   *     submits would open two challenges and spend two codes;
   *   - it is compared again AFTER the awaits, so a verify that lands once the
   *     prompt has been dismissed does not fire the retry into a screen that has
   *     moved on. The existing invariant is that a dismissed prompt cannot still
   *     go off; an await must not be a way around it.
   */
  const verifyToken = useRef<object | null>(null);

  /**
   * Prove a factor to Supabase in this browser, then re-run the action with nothing.
   *
   * Same dance as the sign-in wall (`components/auth/mfa-challenge.tsx`): list the
   * factors, take the TOTP one, challenge and verify it. `challengeAndVerify` saves
   * the refreshed session before it resolves, so the retry's very next request
   * already carries a token whose proof time is seconds old.
   */
  async function proveFactorThenRetry(holding: Held, code: string) {
    const token = {};
    verifyToken.current = token;
    setVerifying(true);
    try {
      const supabase = getSupabaseBrowser();
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      // Only VERIFIED factors land in `totp`, and the server only asks for a
      // reprove of somebody it can already see enrolled — so the first is the one.
      const factor = data?.totp?.[0];
      if (!factor) throw new Error("no verified authenticator on this account");
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code,
      });
      if (verifyError) throw verifyError;
      if (verifyToken.current !== token) return;
      // NO code. The server never wanted one here — it wanted a recent proof, and
      // the session now has one. Passing the digits on would be harmless to the
      // server and confusing to read; passing them INSTEAD of doing this would be
      // the infinite loop.
      holding.retry(undefined);
    } catch {
      // One message for every failure — wrong digits, expired window, no factor,
      // Supabase unreachable — and the SAME message a code our own API refused
      // gets. Telling a wrong code apart from an expired one helps whoever is
      // guessing more than it helps the owner, who tries the next code either way.
      if (verifyToken.current === token) setRejected(true);
    } finally {
      if (verifyToken.current === token) {
        verifyToken.current = null;
        setVerifying(false);
      }
    }
  }

  return {
    kind: held?.kind ?? null,
    rejected,
    requesting: requestCode.isPending || verifying,

    demanded(error, action, retry) {
      if (!(error instanceof ApiError)) return false;
      const kind = handoverConfirmationKind(error.code);
      if (kind === null) return false;

      // Already open means the code we just sent came back refused. The dialog
      // stays up and says so once — the next thing to do is ask for another. Read
      // off the ref, because this runs from a closure that may be a render behind.
      const alreadyOpen = heldRef.current !== null;
      setRejected(alreadyOpen);
      heldRef.current = { kind, action, retry };
      setHeld(heldRef.current);
      if (!alreadyOpen && kind === "email") {
        // Asked for on open rather than behind a button: a dialog whose only
        // working control is "Send it again" has wasted somebody's time. Once only:
        // a second code minted behind somebody still reading the first is how a
        // correct code becomes a wrong one.
        requestCode.mutate(action);
      }
      return true;
    },

    confirm(raw) {
      if (!held) return;
      // Nothing while Supabase is still deciding. A second submit would open a
      // second challenge against a code the first one has already burned, and the
      // person would be told their own correct digits were wrong.
      if (verifyToken.current !== null) return;
      setRejected(false);
      // Trimmed ONCE, for every destination. `isHandoverCode` trims before it decides
      // whether to enable the button, so a code pasted out of an email with a trailing
      // space gets as far as being submitted — and then only the Supabase branch used
      // to clean it up. Our own server hashes what it is given, so the API branch
      // answered a correct code with "that code didn't work" and spent one of the five
      // attempts saying it.
      const code = raw.trim();

      if (HANDOVER_CODE_DESTINATION[held.kind] === "supabase") {
        // Deliberately NOT `held.retry(code)`. See the note at the top of the file:
        // the digits belong to Supabase on this path, and sending them to us
        // instead is a dialog that can never be satisfied.
        //
        // Read off the shared map rather than naming the kind, because the same
        // decision is made on three clients and the rule drifting between them is
        // exactly how this shipped broken the first time.
        void proveFactorThenRetry(held, code);
        return;
      }

      held.retry(code);
    },

    resend() {
      if (!held) return;
      setRejected(false);
      requestCode.mutate(held.action);
    },

    dismiss() {
      // Abandons any verify still in flight: its `retry` is skipped, and clearing
      // the flag here rather than in its `finally` is what stops the dialog being
      // left permanently mid-submit.
      verifyToken.current = null;
      setVerifying(false);
      heldRef.current = null;
      setHeld(null);
      setRejected(false);
    },
  };
}
