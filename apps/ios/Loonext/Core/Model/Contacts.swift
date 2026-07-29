import Foundation

/// The customer texted STOP and our webhook saw it: a block only they can lift.
let optOutSourceStop = "stop_keyword"

/// #331: the same block, learned afterwards — Telnyx refused a send with
/// 40300, or the nightly reconciliation found the number on their list and not
/// ours. The customer still said stop; we just were not told at the time.
let optOutSourceCarrier = "carrier"

/// Whether this opt-out is enforced by the carrier, and so cannot be undone
/// from in here whatever the screen offers. A function rather than a
/// comparison because there are now two such sources, and every site that
/// named one would quietly start offering a revoke the server answers with a
/// 409.
func isCarrierEnforcedOptOut(_ source: String?) -> Bool {
    source == optOutSourceStop || source == optOutSourceCarrier
}

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
    /// #393: nil means a first text to this customer would be SIGNED, so the
    /// composer folds the signature into its part count. Non-nil means they have
    /// already been told who we are and it is not added again.
    let first_identification_sent_at: String?
    let deleted_at: String?
    let created_at: String
    let updated_at: String
    @Default<DefaultFalse> var opted_out: Bool
    /// Which kind of opt-out this is, because only some of them can be undone
    /// from inside the app. "stop_keyword" and "carrier" are both CARRIER
    /// blocks: clearing our record would not clear theirs, so every send would
    /// still be rejected. Ask `isCarrierEnforcedOptOut` rather than comparing
    /// to one of them. "manual" and "import" are records someone in the office
    /// made, with no carrier involved. Nil when not opted out.
    var opt_out_source: String?
    /// #292/D49: a person's CORRECTION to the area-code inference, or nil to
    /// keep inferring. Never a cached copy of the inferred zone — that would
    /// go stale the day the area-code table is fixed, with nothing to tell it
    /// apart from a deliberate choice.
    var timezone: String?
    /// What the server actually resolved, and which rung of the ladder
    /// answered ("contact", "area_code", "company"). Detail reads only — the
    /// list does not carry them, hence the optionals.
    var timezone_resolved: String?
    var timezone_source: String?
    /// 0–23 where they are, at the moment the detail was read.
    var local_hour: Int?
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

/// #292/D49: how honest to be about the clock we are showing.
///
/// "From their area code" is an inference a dispatcher may know better than —
/// a mobile number keeps its original code when its owner moves provinces.
/// "Using your timezone" is us admitting we do not know, which is the one they
/// most need to see before scheduling anything.
func timezoneProvenanceLabel(_ source: String?) -> String {
    switch source {
    case "contact": return "Set by your crew"
    case "area_code": return "From their area code"
    case "company": return "Their area code doesn't say — using your timezone"
    default: return ""
    }
}

/// The zones worth offering when correcting a contact's clock. Taken from the
/// platform's own tz database rather than a list of ours, so it cannot go stale
/// when IANA renames one — and narrowed to North America because every number
/// this product can text is there. The server validates whatever is sent.
func northAmericanTimeZoneIdentifiers() -> [String] {
    TimeZone.knownTimeZoneIdentifiers
        .filter { $0.hasPrefix("America/") || $0 == "Pacific/Honolulu" }
        .sorted()
}
