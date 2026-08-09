import Foundation

/// #537 — the words in front of a handover, and which of the two prompts to show.
///
/// The hand-port of `packages/shared/src/handover-confirmation.ts`.
///
/// The server asks for one of two things before the business changes hands: the code
/// from an authenticator, or a code emailed to the address on the account. Two
/// mechanisms, one dialog — and the difference matters entirely in the copy, because
/// sending somebody to open an app they never installed is a dead end.
///
/// The refusal names which. `mfa_challenge_required` means "you have a factor, use
/// it"; `confirmation_code_required` means "you have none, so we posted one".
///
/// #581/#7 added a third, `mfa_reprove_required`, and it is the one worth reading
/// twice. Its COPY is identical to the authenticator prompt — the person opens the
/// same app and reads the same six digits — but what the client DOES with those
/// digits is completely different, which is why it is its own kind rather than an
/// alias.
///
///   `authenticator` — the workspace-wide wall, raised before the route ran. The
///                     six digits go TO OUR API, which passes them on.
///   `reprove`       — this act, right now, needs a factor proved in the last five
///                     minutes. The six digits go to SUPABASE, in the client, which
///                     refreshes the session and stamps a new proof time; the action
///                     is then retried with NO code at all.
///
/// Sending a `reprove` code to our API instead would loop forever: the server is not
/// checking a code there, it is checking how long ago the session last proved a
/// factor, and posting digits at it changes neither. The words alone cannot tell those
/// two apart, so `codeDestination(_:)` below is where the difference is written down,
/// and `Features/Settings/HandoverGate.swift` is what acts on the answer.
enum HandoverConfirmation {

    /// Which of the prompts the server asked for.
    ///
    /// `reprove` reads the same as `authenticator` and behaves nothing like it; see
    /// the note above before treating one as the other.
    enum Kind: String, CaseIterable {
        case authenticator
        case reprove
        case email
    }

    /// Read the kind out of an error code, or nil when the refusal was about
    /// something else entirely.
    ///
    /// Nil is the important case: a handover is also refused because a transfer is
    /// already in flight, or because the caller is not the owner. A client that
    /// treated every refusal as "ask for a code" would prompt for a code that could
    /// never help, and hide the real reason behind it.
    static func kind(of errorCode: String?) -> Kind? {
        switch errorCode {
        case "mfa_challenge_required": return .authenticator
        case "mfa_reprove_required": return .reprove
        case "confirmation_code_required": return .email
        default: return nil
        }
    }

    /// Where the six digits somebody types are actually checked.
    ///
    /// Raw-valued so a test can hold these against the shared module's own words
    /// instead of against a second list typed out over here.
    enum CodeDestination: String, CaseIterable {
        /// The code travels with the retry and OUR server checks it.
        case api
        /// The client proves the factor itself, against Supabase, which hands back a
        /// fresh session and so stamps a new proof time. The action is then retried
        /// carrying NO code.
        case supabase
    }

    /// The one thing about these three kinds that is not copy: who checks the digits.
    ///
    /// **Our API only ever checks the code it emailed.** That is the whole rule.
    ///
    /// An exhaustive switch rather than `kind != .email`, because a boolean would
    /// silently sort a fourth kind into whichever side the expression happened to
    /// favour. Here a new case does not compile until somebody has decided where its
    /// digits go — and that decision is the difference between a working dialog and one
    /// that can never be satisfied.
    ///
    /// Both authenticator kinds are `.supabase` for the same underlying reason: what the
    /// server refuses on there is a property of the SESSION, not a secret it is waiting
    /// to be told. One reads how long ago a factor was proved, the other whether one was
    /// proved at all. A six-digit code in a request body moves neither, so posting it
    /// returns the identical refusal every time and the person is told their own correct
    /// code was wrong. Only a Supabase challenge moves either.
    ///
    /// That was got wrong for `.reprove` first, on all three clients at once, and the fix
    /// then left `.authenticator` asserting the same falsehood — which is why both are
    /// spelled out here rather than one.
    static func codeDestination(_ kind: Kind) -> CodeDestination {
        switch kind {
        case .authenticator: return .supabase
        case .reprove: return .supabase
        case .email: return .api
        }
    }

    /// Do these six digits travel to our API with the retry?
    ///
    /// The question the gate actually asks, answered off the map above so that no call
    /// site works it out from the kind by hand. This rule was written three times
    /// first, and one of those three being wrong is what left an owner unable to hand
    /// over their own business.
    static func codeGoesToOurApi(_ kind: Kind) -> Bool {
        codeDestination(kind) == .api
    }

    /// The dialog's heading. The same every time, because the ask is the same.
    static let title = "Confirm it's you"

    /// Where to find the code.
    ///
    /// Deliberately different sentences rather than one that covers both: "enter your
    /// code" is useless to somebody who does not know which code, and the two live in
    /// completely different places.
    static func whereToLook(_ kind: Kind) -> String {
        switch kind {
        case .authenticator:
            return "Open your authenticator app and enter the six-digit code it shows."
        // Word for word the same as above, and deliberately so: the person is doing
        // the identical thing, and a second phrasing for the same physical act would
        // read as a different demand. What differs is entirely on our side of the
        // wire.
        case .reprove:
            return "Open your authenticator app and enter the six-digit code it shows."
        case .email:
            return "We've emailed a six-digit code to the address on your account. "
                + "It works once, and expires in ten minutes."
        }
    }

    /// The field's label, and its accessible name.
    static let field = "Six-digit code"

    /// The button that goes through with it.
    static let submit = "Confirm"

    /// Only offered on the email path.
    ///
    /// There is nothing to resend to somebody using an authenticator — the app is
    /// generating the codes — and a Resend button there would imply we could send
    /// them one, which we cannot. Same for `reprove`, for the same reason.
    static let resend = "Send it again"

    /// What to say when the code did not work.
    ///
    /// ONE MESSAGE for wrong, expired, already used, and out of attempts. The server
    /// deliberately does not distinguish them — telling somebody which would tell an
    /// attacker whether they had the right digits — so the client must not invent a
    /// distinction the server refused to make.
    static let rejected = "That code didn't work. Ask for a new one and try again."

    /// Is this six digits?
    ///
    /// Checked on the client only to keep the button quiet until there is something
    /// worth sending — the server validates the same shape, and this is not the
    /// security boundary. Trimmed first, because a code pasted out of an email
    /// arrives with whitespace more often than not.
    static func isCode(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count == 6 && trimmed.allSatisfy { $0.isASCII && $0.isNumber }
    }
}
