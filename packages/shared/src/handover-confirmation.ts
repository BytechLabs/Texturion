/**
 * #537 — the words in front of a handover, and which of the two prompts to show.
 *
 * The server asks for one of two things before the business changes hands: the
 * code from an authenticator, or a code emailed to the address on the account. Two
 * mechanisms, one dialog — and the difference matters entirely in the copy, because
 * sending somebody to open an app they never installed is a dead end.
 *
 * The refusal names which. `mfa_challenge_required` means "you have a factor, use
 * it"; `confirmation_code_required` means "you have none, so we posted one". This
 * module turns that into the sentences three clients show, so a phone and a laptop
 * cannot describe the same demand differently.
 */

/** Which of the two prompts the server asked for. */
export type HandoverConfirmationKind = "authenticator" | "email";

/**
 * Read the kind out of an error code, or null when the refusal was about
 * something else entirely.
 *
 * Null is the important case: a handover can also be refused because a transfer is
 * already in flight, or because the caller is not the owner. A client that treated
 * every 403 as "ask for a code" would prompt for a code that could never help.
 */
export function handoverConfirmationKind(
  errorCode: string | null | undefined,
): HandoverConfirmationKind | null {
  if (errorCode === "mfa_challenge_required") return "authenticator";
  if (errorCode === "confirmation_code_required") return "email";
  return null;
}

/** The dialog's heading. The same for both, because the ask is the same. */
export const HANDOVER_CONFIRM_TITLE = "Confirm it's you";

/**
 * Where to find the code.
 *
 * Deliberately different sentences rather than one that covers both: "enter your
 * code" is useless to somebody who does not know which code, and the two live in
 * completely different places.
 */
export const HANDOVER_CONFIRM_WHERE: Record<HandoverConfirmationKind, string> = {
  authenticator:
    "Open your authenticator app and enter the six-digit code it shows.",
  email:
    "We've emailed a six-digit code to the address on your account. It works once, and expires in ten minutes.",
};

/** The field's label, and its accessible name. */
export const HANDOVER_CONFIRM_FIELD = "Six-digit code";

/** The button that goes through with it. */
export const HANDOVER_CONFIRM_SUBMIT = "Confirm";

/**
 * Only offered on the email path.
 *
 * There is nothing to resend to somebody using an authenticator — the app is
 * generating the codes — and a Resend button there would imply we could send them
 * one, which we cannot.
 */
export const HANDOVER_CONFIRM_RESEND = "Send it again";

/**
 * What to say when the code did not work.
 *
 * ONE MESSAGE for wrong, expired, already used, and out of attempts. The server
 * deliberately does not distinguish them — telling somebody which would tell an
 * attacker whether they had the right digits — so the client must not invent a
 * distinction the server refused to make.
 */
export const HANDOVER_CONFIRM_REJECTED =
  "That code didn't work. Ask for a new one and try again.";

/**
 * Is this six digits?
 *
 * Checked client-side only to keep the button quiet until there is something worth
 * sending — the server validates the same shape, and this is not the security
 * boundary. Trimmed first, because a code pasted out of an email arrives with
 * whitespace more often than not.
 */
export function isHandoverCode(value: string): boolean {
  return /^\d{6}$/.test(value.trim());
}
