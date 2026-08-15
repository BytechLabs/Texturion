/**
 * #330 — handing the phone to whoever is covering the rest of the shift.
 *
 * D12's customer is a crew of one to ten texting customers from PERSONAL handsets,
 * and a spare phone lives in the truck. It gets handed to whoever is on this evening.
 * Until now the only way to do that honestly was Settings, then Profile, then scroll,
 * then "Sign out on this device" — so the fast path was to hand the phone over signed
 * in as somebody else, which attributes every reply to the wrong person and gives
 * them permissions that are not theirs.
 *
 * ## Why there is no stored account switcher
 *
 * The obvious feature is two signed-in accounts and a toggle. It is the wrong one
 * here: keeping the previous person's session on the device is exactly what this
 * issue exists to stop, and it would contradict what the privacy policy now promises
 * — everything goes when the session ends. So a handover is a full, clean exit, made
 * fast rather than made partial.
 *
 * ## The one thing it must not do quietly
 *
 * Ending the session clears the offline outbox, because a message half-written to a
 * homeowner must not sit on a phone the business does not own. That means a handover
 * DISCARDS anything still waiting for signal — and the person tapping it is the only
 * one who can be told, since a session the server revokes has nobody to ask.
 */

/** The action, named for what somebody is actually doing. */
import type { SayKey } from "./support";

export const HAND_OVER_PHONE_ACTION = "shell.handOverAction";

/** The confirmation's heading. */
export const HAND_OVER_PHONE_TITLE = "shell.handOverTitle";

/** Goes through with it. */
export const HAND_OVER_PHONE_CONFIRM = "shell.handOverConfirm";

/** Backs out. */
export const HAND_OVER_PHONE_CANCEL = "shell.handOverCancel";

/**
 * What happens, in the order it matters to the person holding the phone.
 *
 * `unsent` is how many messages are still waiting for signal. Naming the number
 * rather than saying "any unsent messages" is the difference between a warning
 * somebody reads past and one they act on — and if it is wrong in the safe
 * direction, they go and find signal first.
 */
export function handOverPhoneBody(unsent: number, say: SayKey): string {
  const lines = [say("shell.handOverBody")];
  if (unsent > 0) {
    /*
     * #228: singular and plural are SEPARATE KEYS. French agrees "message" and
     * its verb with the count, and the one-message case carries no numeral at
     * all in either language — "1 message" would read as a form field on the
     * screen where somebody is deciding whether to lose it.
     */
    lines.push(
      unsent === 1
        ? say("shell.handOverUnsentOne")
        : say("shell.handOverUnsentMany").replace("{count}", String(unsent)),
    );
  }
  return lines.join("\n\n");
}

/**
 * Is there anything to lose by handing the phone over right now?
 *
 * Split out so a client can colour the confirmation as a warning rather than a
 * routine question, without re-deriving the rule from the copy.
 */
export function handOverPhoneCosts(unsent: number): boolean {
  return unsent > 0;
}
