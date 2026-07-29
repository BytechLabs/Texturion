import Foundation

/// First-text signature (#393) — a Swift port of the CLIENT arm of
/// packages/shared/src/first-message-identification.ts.
///
/// When the owner turns "Sign your texts" on, the first text to a customer is
/// signed server-side with `- {Business name}. Reply STOP to opt out`. This file
/// does NOT build that string: the API hands over the exact suffix
/// (`CompanyView.first_message_identification_suffix`), because a client-composed
/// copy that drifted would show a part count the customer is not billed for.
///
/// What IS ported is the append RULE, so the composer's meter measures the same
/// body the send path builds — merge fields first, then the signature, then the
/// estimate (apps/api/src/routes/compose.ts).
enum Signature {
    /// Append an already-resolved signature to a body, idempotently.
    ///
    /// A nil/blank signature returns the body untouched, as does a body that
    /// already ends with it — which covers an owner whose own sign-off happens
    /// to match, and keeps the preview stable rather than growing a second copy.
    static func append(_ body: String, suffix: String?) -> String {
        guard let suffix, !suffix.trimmingCharacters(in: .whitespaces).isEmpty else {
            return body
        }
        let trimmedSuffix = String(suffix.drop(while: { $0 == " " }))
        if bodyEndsWith(body, trimmedSuffix) { return body }
        return body + suffix
    }

    /// The signature THIS send will carry, or nil.
    ///
    /// Both conditions matter. The company setting decides whether signing
    /// happens at all; `alreadySignedAt` is the once-per-customer ledger, so a
    /// customer who has had one gets a plain text. A recipient with no contact
    /// row yet (a raw number) has never been signed to, so pass nil.
    static func pending(companySuffix: String?, alreadySignedAt: String?) -> String? {
        guard let companySuffix,
              !companySuffix.trimmingCharacters(in: .whitespaces).isEmpty
        else { return nil }
        return alreadySignedAt == nil ? companySuffix : nil
    }

    /// `body.trimEnd().endsWith(suffix)` — spelled out because Swift has no
    /// trailing-only trim, and `trimmingCharacters` would strip the front too.
    private static func bodyEndsWith(_ body: String, _ suffix: String) -> Bool {
        var end = body.endIndex
        while end > body.startIndex {
            let previous = body.index(before: end)
            if body[previous] == " " || body[previous] == "\n" || body[previous] == "\t" {
                end = previous
            } else {
                break
            }
        }
        return body[body.startIndex..<end].hasSuffix(suffix)
    }
}
