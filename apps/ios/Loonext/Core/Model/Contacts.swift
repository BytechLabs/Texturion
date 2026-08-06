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
/// #291 — one of a contact's addresses.
///
/// The label is free text: a fixed vocabulary is wrong for the second trade
/// that uses it — a property manager labels by unit, a builder by lot.
struct ContactAddress: Codable, Sendable, Identifiable {
    var id: String = ""
    var label: String? = nil
    var address: String = ""
    var is_primary: Bool = false
    var created_at: String = ""
}

/// #291: one of a customer's other numbers.
///
/// A number recorded here is matched against every inbound text and call, so
/// it decides which customer a message is FROM.
struct ContactPhone: Codable, Sendable, Identifiable {
    var id: String = ""
    var phone_e164: String = ""
    var label: String? = nil
    var created_at: String = ""
}

struct ContactPhoneBody: Codable, Sendable {
    var phone_e164: String
    var label: String? = nil
}

struct ContactPhoneCreated: Codable, Sendable {
    var data: ContactPhone = ContactPhone()
}

/// #291: one field a workspace defined for itself.
///
/// `key` is the stable identity — values are stored under it, so relabelling a
/// field keeps every value attached.
struct ContactFieldDef: Codable, Sendable, Identifiable, Equatable {
    var key: String = ""
    var label: String = ""
    var kind: String = "text"
    var options: [String]? = nil
    var position: Int = 0

    /// Keyed on `key` rather than on an index: a ForEach over a non-Identifiable
    /// row, or one identified by position, reuses the wrong text field when the
    /// list is reordered.
    var id: String { key }
}

/// GET /v1/contact-fields.
struct ContactFieldsResponse: Codable, Sendable {
    var data: [ContactFieldDef] = []
    /// The ceiling, sent with the list rather than hardcoded on the phone — a
    /// client keeping its own copy would eventually disagree with the server
    /// about when the Add button disappears.
    var cap: Int = 10
}

/// PATCH /v1/contacts/:id — the whole values object.
struct ContactCustomFieldsBody: Codable, Sendable {
    var custom_fields: [String: String]
}

/// PUT /v1/contact-fields — the whole set at once.
struct ContactFieldsBody: Codable, Sendable {
    var fields: [ContactFieldDef]
}

struct ContactAddressBody: Codable, Sendable {
    var address: String? = nil
    var label: String? = nil
    var is_primary: Bool? = nil
}

struct ContactAddressCreated: Codable, Sendable {
    var data: ContactAddress = ContactAddress()
}

struct Contact: Codable, Sendable {
    let id: String
    let phone_e164: String
    let name: String?
    /// #291: the company this customer represents, when they represent one.
    /// For a property manager or a general contractor it is most of the
    /// record. `var … = nil` so it does not become a required memberwise-init
    /// parameter at every existing construction site.
    var business_name: String? = nil
    let address: String?
    /// #291: for quotes (#287) and receipts (#224), and as the fallback a
    /// human can use when a text will not reach somebody.
    var email: String? = nil
    /// #291: the OTHER addresses. Primary first, then oldest. Empty for every
    /// contact that predates the feature — `address` above still holds their
    /// one address and still works.
    var addresses: [ContactAddress]? = nil
    /// #291: values for the fields this workspace defined, keyed on the field's
    /// key. Absent on every contact nobody has filled one in for — which is
    /// most of them — and on the LIST projection, which does not carry them.
    /// `var … = nil` so it does not become a required memberwise-init
    /// parameter at every existing construction site.
    var custom_fields: [String: String]? = nil
    /// #291: the OTHER numbers this customer answers, oldest first. No primary
    /// among them — `phone_e164` above IS the primary. `var … = nil` so it does
    /// not become a required memberwise-init parameter at every existing
    /// construction site.
    var phones: [ContactPhone]? = nil
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
    /// #410: how many conversations this contact has had, and when the first
    /// one was. Derived server-side so three clients cannot each count
    /// differently, and scoped to the numbers the caller may see. `var … = nil`
    /// so neither becomes a required memberwise-init parameter at the existing
    /// construction sites.
    var conversation_count: Int? = nil
    var first_conversation_at: String? = nil
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
    /// #228: the language THIS customer's automated texts go out in, or nil to
    /// follow the workspace's.
    ///
    /// Nil means "whatever the business works in", NOT English. Resolve it
    /// through `MessageLocale.resolve` rather than reading it alone: a screen
    /// that treated nil as English would name one language while the send path
    /// used another, and an owner who later switched the workspace to French
    /// would find this customer silently pinned to English.
    ///
    /// Detail projection only; the list does not carry it. `var … = nil` so it
    /// does not become a required memberwise-init parameter at every existing
    /// construction site.
    var locale: String? = nil
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

    /// #248 — rows that WERE imported and whose consent attestation the server
    /// refused to write, because that person had already told this business to
    /// stop. The carrier record wins over what a file claims about somebody.
    ///
    /// Deliberately not folded into `skipped`, and the server draws the same
    /// line for the same reason: these rows landed. A client that added them to
    /// the skipped count would be answering a second question wrongly.
    @Default<DefaultZero> var consent_refused: Int = 0

    /// Which rows, in the same `{row, reason}` shape as `errors` — so one list
    /// renderer covers both, and so the reason can name the phone, which is
    /// the workspace's next question.
    @Default<DefaultEmptyList<ImportRowError>> var consent_refusals: [ImportRowError] = []

    /// The server's own sentence about what a refusal means, or nil when it
    /// refused nothing.
    ///
    /// Printed as it arrives. `ContactImport.consentRefusedNote` exists only
    /// for the case this is absent while rows are not — see the note there for
    /// why a second copy is safe here and normally would not be.
    var consent_refused_note: String? = nil
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

/// #246 — two contact records that look like the same customer.
///
/// The `reason` is the server's, in its own words, and it is rendered
/// verbatim: a suggestion somebody cannot verify is one they learn to dismiss.
struct DuplicatePair: Codable, Sendable, Identifiable {
    let contact_a: String
    let name_a: String?
    let phone_a: String
    let contact_b: String
    let name_b: String?
    let phone_b: String
    let reason: String

    var id: String { "\(contact_a):\(contact_b)" }
}

/// #246: what a merge actually did, so the confirmation can say it back.
struct ContactMergeResult: Codable, Sendable {
    @Default<DefaultFalse> var merged: Bool
    @Default<DefaultZero> var moved: Int
    @Default<DefaultZero> var closed: Int
    @Default<DefaultFalse> var opted_out: Bool
}
