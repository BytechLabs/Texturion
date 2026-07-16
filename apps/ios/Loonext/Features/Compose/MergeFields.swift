import Foundation

/// Merge-field substitution — an exact Swift port of
/// packages/shared/src/merge-fields.ts (via the Android MergeFields.kt twin),
/// used for the composer's live preview. The server applies the same function
/// authoritatively at send time, so what the user previews is exactly what
/// ships.
///
/// Supported tokens (curly-brace delimited, case-insensitive name):
///   {first_name}     — the first whitespace-delimited token of the contact name.
///   {business_name}  — the company name.
///
/// An unknown token, or a supported token whose value is nil/empty, is dropped
/// CLEANLY — the literal never reaches the preview and no stray double-spaces
/// or dangling punctuation are left behind.
enum MergeFields {
    /// The literal tokens this substituter understands.
    static let tokens = ["first_name", "business_name"]

    /// {token} where token is one of the supported names OR any [a-z_] word.
    private static let tokenPatternSource = #"\{([a-z_][a-z0-9_]*)\}"#

    private static func tokenPattern() -> NSRegularExpression? {
        try? NSRegularExpression(pattern: tokenPatternSource, options: [.caseInsensitive])
    }

    /// First whitespace-delimited token of a name, or "" when there is none.
    private static func firstName(_ contactName: String?) -> String {
        let trimmed = (contactName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "" }
        return trimmed.split(whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? ""
    }

    private static func resolveToken(
        _ token: String,
        contactName: String?,
        businessName: String?
    ) -> String {
        switch token {
        case "first_name":
            return firstName(contactName)
        case "business_name":
            return (businessName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        default:
            // Unknown token: drop it (never render the literal braces).
            return ""
        }
    }

    /// Collapse the whitespace/punctuation artifacts left when a token resolves
    /// to "" — "Hi {first_name}, thanks" with no name becomes "Hi, thanks", not
    /// "Hi , thanks". Only runs when at least one token was dropped, so text
    /// with no empty tokens is returned byte-for-byte unchanged.
    private static func tidyDroppedTokens(_ text: String) -> String {
        text
            // " ," / " ." etc. left by a dropped token before punctuation.
            .replacingOccurrences(
                of: #"[ \t]+([,.;:!?])"#,
                with: "$1",
                options: .regularExpression
            )
            // Collapse runs of intra-line spaces/tabs to a single space.
            .replacingOccurrences(
                of: #"[ \t]{2,}"#,
                with: " ",
                options: .regularExpression
            )
            // Trim trailing spaces/tabs at end of each line.
            .replacingOccurrences(
                of: #"(?m)[ \t]+$"#,
                with: "",
                options: .regularExpression
            )
            // Trim leading spaces/tabs at start of each line.
            .replacingOccurrences(
                of: #"(?m)^[ \t]+"#,
                with: "",
                options: .regularExpression
            )
    }

    /// Substitute all {tokens} from the given values. Pure and side-effect
    /// free; unknown or empty tokens are dropped and whitespace tidied.
    static func applyMergeFields(
        _ text: String,
        contactName: String? = nil,
        businessName: String? = nil
    ) -> String {
        guard text.contains("{"), let pattern = tokenPattern() else { return text }

        let ns = text as NSString
        let matches = pattern.matches(in: text, range: NSRange(location: 0, length: ns.length))
        if matches.isEmpty { return text }

        var anyDropped = false
        var result = ""
        var cursor = 0
        for match in matches {
            result += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let token = ns.substring(with: match.range(at: 1)).lowercased()
            let replacement = resolveToken(token, contactName: contactName, businessName: businessName)
            if replacement.isEmpty { anyDropped = true }
            result += replacement
            cursor = match.range.location + match.range.length
        }
        result += ns.substring(from: cursor)
        return anyDropped ? tidyDroppedTokens(result) : result
    }

    /// True when `text` contains at least one {token} this substituter handles.
    static func hasMergeFields(_ text: String) -> Bool {
        guard text.contains("{"), let pattern = tokenPattern() else { return false }
        let ns = text as NSString
        let matches = pattern.matches(in: text, range: NSRange(location: 0, length: ns.length))
        return matches.contains { match in
            tokens.contains(ns.substring(with: match.range(at: 1)).lowercased())
        }
    }
}
