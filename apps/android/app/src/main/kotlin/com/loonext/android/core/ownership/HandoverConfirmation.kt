package com.loonext.android.core.ownership

/**
 * #537 — the words in front of a handover, and which of the two prompts to show.
 *
 * The hand-port of `packages/shared/src/handover-confirmation.ts`.
 *
 * The server asks for one of two things before the business changes hands: the code
 * from an authenticator, or a code emailed to the address on the account. Two
 * mechanisms, one dialog — and the difference matters entirely in the copy, because
 * sending somebody to open an app they never installed is a dead end.
 *
 * The refusal names which. `mfa_challenge_required` means "you have a factor, use
 * it"; `confirmation_code_required` means "you have none, so we posted one".
 */
object HandoverConfirmation {

    /** Which of the two prompts the server asked for. */
    enum class Kind { AUTHENTICATOR, EMAIL }

    /**
     * Read the kind out of an error code, or null when the refusal was about
     * something else entirely.
     *
     * Null is the important case: a handover is also refused because a transfer is
     * already in flight, or because the caller is not the owner. A client that
     * treated every refusal as "ask for a code" would prompt for a code that could
     * never help, and hide the real reason behind it.
     */
    fun kindOf(errorCode: String?): Kind? = when (errorCode) {
        "mfa_challenge_required" -> Kind.AUTHENTICATOR
        "confirmation_code_required" -> Kind.EMAIL
        else -> null
    }

    /** The dialog's heading. The same for both, because the ask is the same. */
    const val TITLE = "Confirm it's you"

    /**
     * Where to find the code.
     *
     * Deliberately different sentences rather than one that covers both: "enter your
     * code" is useless to somebody who does not know which code, and the two live in
     * completely different places.
     */
    fun where(kind: Kind): String = when (kind) {
        Kind.AUTHENTICATOR ->
            "Open your authenticator app and enter the six-digit code it shows."
        Kind.EMAIL ->
            "We've emailed a six-digit code to the address on your account. " +
                "It works once, and expires in ten minutes."
    }

    /** The field's label, and its accessible name. */
    const val FIELD = "Six-digit code"

    /** The button that goes through with it. */
    const val SUBMIT = "Confirm"

    /**
     * Only offered on the email path.
     *
     * There is nothing to resend to somebody using an authenticator — the app is
     * generating the codes — and a Resend button there would imply we could send
     * them one, which we cannot.
     */
    const val RESEND = "Send it again"

    /**
     * What to say when the code did not work.
     *
     * ONE MESSAGE for wrong, expired, already used, and out of attempts. The server
     * deliberately does not distinguish them — telling somebody which would tell an
     * attacker whether they had the right digits — so the client must not invent a
     * distinction the server refused to make.
     */
    const val REJECTED = "That code didn't work. Ask for a new one and try again."

    /**
     * Is this six digits?
     *
     * Checked on the client only to keep the button quiet until there is something
     * worth sending — the server validates the same shape, and this is not the
     * security boundary. Trimmed first, because a code pasted out of an email
     * arrives with whitespace more often than not.
     */
    fun isCode(value: String): Boolean = Regex("^[0-9]{6}$").matches(value.trim())
}
