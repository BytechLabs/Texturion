import Foundation

/// #291 — the fields a workspace defines for itself.
///
/// A hand-port of `packages/shared/src/contact-fields.ts`, mirrored again in
/// android/core/contacts/ContactFields.kt. The equipment fields an HVAC
/// company needs are not the ones a plumber needs, and there is no set we
/// could ship that would be right for both.
///
/// THE PRIVACY LINE IS PRODUCT COPY, NOT A DISCLAIMER. Custom fields let a
/// workspace store data classes we have not declared to the stores (#254) and
/// could not honour under our retention policy (#284). A text column cannot
/// enforce that, so the product says it at the one moment somebody is thinking
/// about what goes in a field: when they are defining it.
enum ContactFields {
    /// How many fields a workspace may define. Mirrors `CONTACT_FIELDS_CAP`.
    static let cap = 10

    /// How many choices a dropdown may hold before it is a list nobody reads.
    static let optionsCap = 40

    /// The longest a stored value may be.
    static let valueMax = 200

    /// The types, deliberately few.
    ///
    /// Every one is something a crew can fill in from a van without thinking.
    /// A formula or a lookup is a spreadsheet feature that arrives with its
    /// own support burden and its own way of being wrong.
    static let kinds = ["text", "number", "date", "select", "checkbox"]

    /// What each type is called on screen.
    static func kindLabel(_ kind: String) -> String {
        switch kind {
        case "number": return "Number"
        case "date": return "Date"
        case "select": return "Dropdown"
        case "checkbox": return "Yes / no"
        default: return "Text"
        }
    }

    /// A label, turned into the key it will be stored under.
    ///
    /// The same string becomes a JSON key AND a CSV header for import mapping
    /// (#248) and export (#227), so it has to survive both: lower case, no
    /// spaces, no punctuation. Returns nil when nothing usable is left — "???"
    /// is not a field name, and inventing one would produce a column nobody
    /// can map back to anything.
    static func key(_ label: String) -> String? {
        var key = label
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(
                of: "[^a-z0-9]+",
                with: "_",
                options: .regularExpression
            )
            .replacingOccurrences(
                of: "^_+|_+$",
                with: "",
                options: .regularExpression
            )
        key = String(key.prefix(40))
            .replacingOccurrences(of: "_+$", with: "", options: .regularExpression)
        // Must start with a letter: a key beginning with a digit is legal JSON
        // and an awkward column head, and the database refuses it anyway.
        guard
            key.range(of: "^[a-z][a-z0-9_]*$", options: .regularExpression) != nil
        else { return nil }
        return key
    }

    /// Is this value acceptable for this kind?
    ///
    /// Returns the reason it is not, or nil when it is. A REASON rather than a
    /// boolean because the caller shows it to somebody who typed the value,
    /// and "invalid" tells them nothing they did not already suspect.
    static func valueError(
        kind: String,
        options: [String]?,
        label: String,
        value: String
    ) -> String? {
        // Empty is always allowed, and it is not the same as absent: "we asked
        // and there is no gate code" is a fact worth recording.
        if value.isEmpty { return nil }
        if value.count > valueMax { return "\(label) is too long" }

        switch kind {
        case "number":
            return Double(value) != nil ? nil : "\(label) should be a number"
        case "date":
            // ISO date only. A crew typing "next Tuesday" into a date field is
            // a value nothing downstream can sort, filter or remind on.
            let iso = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
            return value.range(of: iso, options: .regularExpression) != nil
                ? nil : "\(label) should be a date"
        case "select":
            return (options ?? []).contains(value)
                ? nil : "\(label) is not one of the choices"
        case "checkbox":
            return value == "yes" || value == "no"
                ? nil : "\(label) should be yes or no"
        default:
            return nil
        }
    }

    /// What the settings screen says, in one place — catalogue KEYS since #228.
    ///
    /// `capReached` names {count} rather than interpolating `ContactFields.cap`,
    /// and that fixed a real mismatch: the card gates on the cap the SERVER
    /// sent, while this sentence always said the client's constant.
    enum Copy {
        static let heading = "settings.contactFieldsHeading"
        static let intro = "settings.contactFieldsIntro"

        /// THE LINE THAT MATTERS. Said where fields are defined, because that
        /// is the only moment somebody is deciding what goes in one.
        static let privacy = "settings.contactFieldsPrivacy"

        static let capReached = "settings.contactFieldsCapReached"

        /// Deleting a definition does not delete what people typed into it.
        static let deleteWarning = "settings.contactFieldsDeleteWarning"
    }
}
