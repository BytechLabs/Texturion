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
 *
 * #581/#7 added a third, `mfa_reprove_required`, and it is the one worth reading
 * twice. Its COPY is identical to the authenticator prompt — the person opens the
 * same app and reads the same six digits — but what the client DOES with those
 * digits is completely different, which is why it is its own kind rather than an
 * alias.
 *
 *   `authenticator` — the workspace-wide wall, raised before the route ran. The
 *                     six digits go TO OUR API, which passes them on.
 *   `reprove`       — this act, right now, needs a factor proved in the last five
 *                     minutes. The six digits go to SUPABASE, in the client, which
 *                     refreshes the session and stamps a new proof time; the action
 *                     is then retried with NO code at all.
 *
 * Sending a `reprove` code to our API instead would loop forever: the server is not
 * checking a code there, it is checking how long ago the session last proved a
 * factor, and posting digits at it changes neither.
 */

/** Which of the two prompts the server asked for. */
export type HandoverConfirmationKind =
  | "authenticator"
  | "reprove"
  | "email";

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
  if (errorCode === "mfa_reprove_required") return "reprove";
  if (errorCode === "confirmation_code_required") return "email";
  return null;
}

/** Where the six digits somebody types are actually checked. */
export type HandoverCodeDestination = "api" | "supabase";

/**
 * The one thing about these three kinds that is not copy: who checks the digits.
 *
 * **Our API only ever checks the code it emailed.** That is the whole rule, and it is
 * shorter than the behaviour it replaced because the behaviour it replaced was wrong.
 *
 *   `api`      — the code travels with the retry and our server checks it against the
 *                one it sent. True of `email`, and of nothing else.
 *   `supabase` — the client proves the factor itself, which refreshes the session and
 *                so both lifts it to `aal2` and stamps a new proof time, and then
 *                retries carrying NO code.
 *
 * Both of the authenticator kinds are `supabase`, for the same underlying reason: what
 * the server is refusing on is a property of the SESSION, not a secret it is waiting to
 * be told. `mfa_reprove_required` reads how long ago a factor was proved;
 * `mfa_challenge_required` reads whether one was proved at all. A six-digit code in a
 * request body changes neither, so posting it returns the identical refusal every time
 * and the person is told their own correct code was wrong. Only a Supabase challenge
 * moves either property.
 *
 * That was got wrong for `reprove` first, on all three clients at once, and the fix
 * left `authenticator` asserting the same falsehood — reachable the day any handover
 * screen sees that code rather than the sign-in wall catching it first. Both say
 * `supabase` now.
 *
 * A map rather than `kind !== "email"`, because a boolean would silently sort a fourth
 * kind into whichever side the expression happened to favour. Here a new kind does not
 * compile until somebody has decided where its digits go — and that decision is the
 * difference between a working dialog and one that can never be satisfied.
 *
 * Read by all three clients so the rule is stated once instead of three times. It was
 * written three times first, and one of them being wrong is what made an owner unable
 * to hand over their business.
 */
export const HANDOVER_CODE_DESTINATION: Record<
  HandoverConfirmationKind,
  HandoverCodeDestination
> = {
  authenticator: "supabase",
  reprove: "supabase",
  email: "api",
};

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
  // Word for word the same as above, and deliberately so: the person is doing the
  // identical thing, and a second phrasing for the same physical act would read as
  // a different demand. What differs is entirely on our side of the wire.
  reprove:
    "Open your authenticator app and enter the six-digit code it shows.",
  email:
    "We've emailed a six-digit code to the address on your account. It works once, and expires in ten minutes.",
};

/** The field's label, and its accessible name. */
export const HANDOVER_CONFIRM_FIELD = "Six-digit code";

/** The button that goes through with it. */
export const HANDOVER_CONFIRM_SUBMIT = "Confirm";

/**
 * The same button while the answer is being checked.
 *
 * Lives here, next to the label it replaces, because it is the button's ACCESSIBLE
 * NAME for the whole time the gate is busy — which on the `reprove` path is a round
 * trip to Supabase, the longest the dialog is ever on screen. It is therefore the
 * name every test that pins the in-flight, disabled button has to ask for, and it
 * was the one string in this vocabulary still typed out by hand at each end: once in
 * `handover-confirm-dialog.tsx` and once in each suite that reaches for it. Rewording
 * it reddened tests that were not about the wording at all — a failure with no
 * customer behind it, in the file every other confirmation suite is copied from.
 *
 * The trailing character is a real ellipsis, not three periods, and that is exactly
 * the sort of difference a retyped copy loses: `getByRole` matches the accessible
 * name exactly, so the two spellings are simply different buttons.
 */
export const HANDOVER_CONFIRM_SUBMITTING = "Confirming…";

/**
 * Only offered on the email path.
 *
 * There is nothing to resend to somebody using an authenticator — the app is
 * generating the codes — and a Resend button there would imply we could send them
 * one, which we cannot. Same for `reprove`, for the same reason.
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
