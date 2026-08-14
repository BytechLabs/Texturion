package com.loonext.android.core.ownership

import com.loonext.android.core.i18n.AppStrings

/**
 * #537 — the words in front of a handover, and which of the prompts to show.
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
 *
 * #581/#7 added a third, `mfa_reprove_required`, and it is the one worth reading
 * twice. Its COPY is identical to the authenticator prompt — the person opens the
 * same app and reads the same six digits — but what the client DOES with those
 * digits is completely different, which is why it is its own kind rather than an
 * alias.
 *
 *   `AUTHENTICATOR` — the workspace-wide wall, raised before the route ran. The six
 *                     digits go TO OUR API, which passes them on.
 *   `REPROVE`       — this act, right now, needs a factor proved in the last five
 *                     minutes. The six digits go to SUPABASE, in the client —
 *                     `SupabaseAuth.challengeFactor` then `verifyFactor`, whose
 *                     fresh session must be SAVED — and the action is then retried
 *                     with NO code at all.
 *
 * Sending a `reprove` code to our API instead would loop forever: the server is not
 * checking a code there, it is checking how long ago the session last proved a
 * factor, and posting digits at it changes neither. That is a hard lockout out of
 * ownership transfer and workspace closure, so a caller that cannot tell the two
 * apart must not be given the chance — hence two values and no shared alias.
 */
object HandoverConfirmation {

    /**
     * Which of the prompts the server asked for.
     *
     * `AUTHENTICATOR` and `REPROVE` say word-for-word the same sentence and are NOT
     * interchangeable: see the header for where their six digits go. They are two
     * values precisely so that branching on the copy is impossible and branching on
     * the kind is the only thing a caller can do.
     */
    enum class Kind { AUTHENTICATOR, REPROVE, EMAIL }

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
        "mfa_reprove_required" -> Kind.REPROVE
        "confirmation_code_required" -> Kind.EMAIL
        else -> null
    }

    /** Where the six digits somebody types are actually checked. */
    enum class Destination { API, SUPABASE }

    /**
     * The one thing about these three kinds that is not copy: who checks the digits.
     *
     * An exhaustive `when` rather than `kind != REPROVE`, because a boolean would
     * silently sort a fourth kind into whichever side the expression happened to
     * favour. Here a new kind does not compile until somebody has decided where its
     * digits go — and that decision is the difference between a working dialog and one
     * that can never be satisfied. (An exhaustive `when` is the Kotlin shape of the
     * shared module's `Record<HandoverConfirmationKind, …>`: both refuse to build with
     * a kind left out.)
     *
     * **Our API only ever checks the code it emailed.** That is the whole rule.
     *
     *   [Destination.API]      — the code travels with the retry and our server checks
     *                            it against the one it sent. True of [Kind.EMAIL], and
     *                            of nothing else.
     *   [Destination.SUPABASE] — the client proves the factor itself, which refreshes
     *                            the session and so both lifts it to `aal2` and stamps a
     *                            new proof time, and then retries carrying NO code.
     *
     * Both authenticator kinds are [Destination.SUPABASE] for the same underlying
     * reason: what the server refuses on there is a property of the SESSION, not a
     * secret it is waiting to be told. One reads how long ago a factor was proved, the
     * other whether one was proved at all. A six-digit code in a request body moves
     * neither, so posting it returns the identical refusal every time and the person is
     * told their own correct code was wrong. Only a Supabase challenge moves either.
     *
     * Stated here, once, and read by the gate — because it was written three times
     * first, and one of them being wrong is what made an owner unable to hand over
     * their own business. The fix for that then left [Kind.AUTHENTICATOR] asserting the
     * same falsehood, which is why both are spelled out above rather than one.
     */
    fun destination(kind: Kind): Destination = when (kind) {
        Kind.AUTHENTICATOR -> Destination.SUPABASE
        Kind.REPROVE -> Destination.SUPABASE
        Kind.EMAIL -> Destination.API
    }

    /**
     * Do these digits go to our API?
     *
     * The question a caller about to send a code actually has. Answered off
     * [destination] rather than by naming a kind, so there is one place in the app
     * where that is decided and no second opinion to drift from it.
     */
    fun goesToOurApi(kind: Kind): Boolean = destination(kind) == Destination.API

    /**
     * The dialog's heading. The same for both, because the ask is the same.
     *
     * #228: the KEY is the constant, because `t()` is `@Composable` and this
     * object is not. The old names stay as properties over the catalogue, so a
     * call site that has not been given the reader's language keeps its English.
     */
    const val TITLE_KEY = "domain.handoverTitle"
    val TITLE: String get() = AppStrings.translate(null, TITLE_KEY)

    /**
     * Where to find the code.
     *
     * Deliberately different sentences rather than one that covers both: "enter your
     * code" is useless to somebody who does not know which code, and the two live in
     * completely different places.
     */
    fun where(kind: Kind, locale: String? = null): String = AppStrings.translate(
        locale,
        when (kind) {
            Kind.AUTHENTICATOR -> "domain.handoverWhereAuthenticator"
            // The SAME KEY as above, and deliberately so: the person is doing the
            // identical thing, and a second phrasing for the same physical act
            // would read as a different demand. What differs is entirely on our
            // side of the wire, and nothing about that belongs in front of them.
            // One key rather than two identical sentences is also what stops the
            // two drifting apart the next time either is reworded.
            Kind.REPROVE -> "domain.handoverWhereAuthenticator"
            Kind.EMAIL -> "domain.handoverWhereEmail"
        },
    )

    /** The field's label, and its accessible name. */
    const val FIELD_KEY = "domain.handoverField"
    val FIELD: String get() = AppStrings.translate(null, FIELD_KEY)

    /** The button that goes through with it. */
    const val SUBMIT_KEY = "domain.handoverSubmit"
    val SUBMIT: String get() = AppStrings.translate(null, SUBMIT_KEY)

    /**
     * Only offered on the email path.
     *
     * There is nothing to resend to somebody using an authenticator — the app is
     * generating the codes — and a Resend button there would imply we could send
     * them one, which we cannot. Same for `REPROVE`, for the same reason.
     */
    const val RESEND_KEY = "domain.handoverResend"
    val RESEND: String get() = AppStrings.translate(null, RESEND_KEY)

    /**
     * What to say when the code did not work.
     *
     * ONE MESSAGE for wrong, expired, already used, and out of attempts. The server
     * deliberately does not distinguish them — telling somebody which would tell an
     * attacker whether they had the right digits — so the client must not invent a
     * distinction the server refused to make.
     */
    const val REJECTED_KEY = "domain.handoverRejected"
    val REJECTED: String get() = AppStrings.translate(null, REJECTED_KEY)

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
