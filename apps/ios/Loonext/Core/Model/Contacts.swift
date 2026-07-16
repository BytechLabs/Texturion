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
