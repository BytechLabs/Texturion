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
///   {address}        — the contact's service address (#274).
///   {my_name}        — the crew member sending it (#274).
///   {our_number}     — the workspace number to reply to, formatted (#274).
///   {job_day}        — the day of the next scheduled visit, e.g. "Tuesday".
///   {job_time}       — the time of it, e.g. "2:00 PM".
///
/// An unknown token, or a supported token whose value is nil/empty, is dropped
/// CLEANLY — the literal never reaches the preview and no stray double-spaces
/// or dangling punctuation are left behind.
enum MergeFields {
    /// The literal tokens this substituter understands.
    static let tokens = [
        "first_name",
        "business_name",
        "address",
        "my_name",
        "our_number",
        "job_day",
        "job_time",
    ]

    /// The values a caller supplies. All optional — absent means "drop it".
    struct Values {
        var contactName: String?
        var businessName: String?
        var contactAddress: String?
        var senderName: String?
        var ourNumber: String?
        var jobDay: String?
        var jobTime: String?
    }

    /// #274 — one variable the template editor offers.
    struct Variable: Identifiable {
        let token: String
        let label: String
        let hint: String

        var id: String { token }
    }

    /// #274 — the tokens the editor offers, in order. MIRROR of
    /// MERGE_FIELD_VARIABLES in packages/shared.
    ///
    /// The list was duplicated in three editors before, and duplicated lists
    /// drift: a token offered on the phone and not the laptop means a template
    /// somebody writes here and then cannot maintain there.
    static let variables: [Variable] = [
        Variable(token: "first_name", label: "First name", hint: "The customer's first name"),
        Variable(token: "address", label: "Address", hint: "The address on their contact"),
        Variable(token: "job_day", label: "Day", hint: "The day of their next booked visit"),
        Variable(token: "job_time", label: "Time", hint: "The time of it"),
        Variable(token: "my_name", label: "My name", hint: "Your first name"),
        Variable(token: "business_name", label: "Business", hint: "Your business name"),
        Variable(token: "our_number", label: "Our number", hint: "The number they reply to"),
    ]

    /// #274 — stand-in values so a preview SHOWS each token working. MIRROR of
    /// MERGE_FIELD_SAMPLES in packages/shared.
    ///
    /// Obvious placeholders, not plausible data: a real-looking address in a
    /// preview gets mistaken for the customer's own and shipped unread.
    static let sampleContact = "Dana"
    static let sampleAddress = "18 Rosewood Ave"
    static let sampleSender = "Sam"
    static let sampleJobDay = "Tuesday"
    static let sampleJobTime = "2:00 PM"

    /// #274 — a NANP number as a person reads it. MIRROR of formatNanpNumber in
    /// packages/shared. The number lands inside a customer's message, so its
    /// formatting is a product fact rather than a display choice, and a preview
    /// formatted differently from the wire defeats the point of previewing.
    static func formatNanpNumber(_ e164: String) -> String {
        let digits = e164.hasPrefix("+1") ? String(e164.dropFirst(2)) : ""
        guard digits.count == 10, digits.allSatisfy(\.isNumber) else { return e164 }
        let area = digits.prefix(3)
        let exchange = digits.dropFirst(3).prefix(3)
        let line = digits.suffix(4)
        return "(\(area)) \(exchange)-\(line)"
    }

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

    private static func resolveToken(_ token: String, _ values: Values) -> String {
        switch token {
        case "first_name":
            return firstName(values.contactName)
        case "business_name":
            return (values.businessName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        case "address":
            // #274: one line, whatever the contact stored. Newlines are
            // collapsed because this lands mid-sentence ("on my way to
            // {address}") and a multi-line address would break the message in
            // two.
            return (values.contactAddress ?? "")
                .split(whereSeparator: \.isNewline)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .joined(separator: ", ")
        case "my_name":
            return firstName(values.senderName)
        case "our_number":
            return (values.ourNumber ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        case "job_day":
            return (values.jobDay ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        case "job_time":
            return (values.jobTime ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
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
        applyMergeFields(
            text,
            values: Values(contactName: contactName, businessName: businessName)
        )
    }

    /// #274 — the TEMPLATE preview: every token resolved, so each one is seen
    /// working. An unresolved {address} renders as nothing, which is exactly
    /// what a broken token looks like.
    static func previewTemplate(
        _ text: String,
        businessName: String?,
        ourNumberE164: String?
    ) -> String {
        applyMergeFields(
            text,
            values: Values(
                contactName: sampleContact,
                businessName: businessName,
                contactAddress: sampleAddress,
                senderName: sampleSender,
                ourNumber: ourNumberE164.map(formatNanpNumber),
                jobDay: sampleJobDay,
                jobTime: sampleJobTime
            )
        )
    }

    /// Substitute all {tokens} from the given values. Pure and side-effect
    /// free; unknown or empty tokens are dropped and whitespace tidied.
    static func applyMergeFields(_ text: String, values: Values) -> String {
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
            let replacement = resolveToken(token, values)
            if replacement.isEmpty { anyDropped = true }
            result += replacement
            cursor = match.range.location + match.range.length
        }
        result += ns.substring(from: cursor)
        return anyDropped ? tidyDroppedTokens(result) : result
    }

    /// #274 — the tokens a CLIENT cannot resolve honestly. MIRROR of
    /// SERVER_ONLY_TOKENS in packages/shared.
    ///
    /// {job_day}/{job_time} come from the conversation's next open due-dated
    /// task. A composer could look that up in its own cache and usually be
    /// right — and "usually right" is the worst possible property for a
    /// preview, whose whole reason to exist is being exactly what ships.
    static let serverOnlyTokens = ["job_day", "job_time"]

    /// The note a composer preview appends when it cannot show the whole truth.
    static let serverOnlyTokensNote = "The day and time fill in when you send."

    /// True when `text` uses a token only the send path can resolve.
    static func hasServerOnlyTokens(_ text: String) -> Bool {
        guard text.contains("{"), let pattern = tokenPattern() else { return false }
        let ns = text as NSString
        let matches = pattern.matches(in: text, range: NSRange(location: 0, length: ns.length))
        return matches.contains { match in
            serverOnlyTokens.contains(ns.substring(with: match.range(at: 1)).lowercased())
        }
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
