import Foundation

/// Contact rows. Detail + list share the shape; `opted_out` rides every read,
/// `last_activity_at` only on list rows (conversation activity, never edits).
struct Contact: Codable, Sendable {
    let id: String
    let phone_e164: String
    let name: String?
    let address: String?
    let notes: String?
    let consent_source: String?
    let consent_at: String?
    let consent_attested_by: String?
    let deleted_at: String?
    let created_at: String
    let updated_at: String
    @Default<DefaultFalse> var opted_out: Bool
    let last_activity_at: String?
    /// #191 record attribution — who created (or resurrected) and who last
    /// edited this contact. The detail + list reads resolve each actor to a
    /// company member's display name server-side; every field is nil for
    /// contacts that predate attribution (older rows), so the UI shows the
    /// line only when a name resolves — never "Added by unknown".
    ///
    /// Declared `var … = nil`, NOT `let`: a `let` with an initial value is
    /// excluded from Swift's synthesized decoding (the compiler treats it as a
    /// fixed constant), whereas a `var` with a default both decodes AND keeps
    /// the memberwise initializer backward-compatible for the preview
    /// constructors that predate these fields.
    var created_by_user_id: String? = nil
    var created_by_name: String? = nil
    var updated_by_user_id: String? = nil
    var updated_by_name: String? = nil
}

struct OptOut: Codable, Sendable {
    let id: String
    let phone_e164: String
    let source: String
    let created_at: String
    let revoked_at: String?
}

/// POST /v1/contacts/import + import-vcard response.
struct ImportResult: Codable, Sendable {
    struct ImportRowError: Codable, Sendable {
        let row: Int
        let reason: String
    }

    let imported: Int
    let updated: Int
    let skipped: Int
    @Default<DefaultEmptyList<ImportRowError>> var errors: [ImportRowError]
}
