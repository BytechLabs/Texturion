import Foundation

/// Field limits mirrored client-side (server is authoritative).
let contactNameMax = 200
let contactAddressMax = 500

/// #291: the DB caps this at 254, which is the RFC's own limit.
let contactEmailMax = 254
let contactNotesMax = 5000

private let posixLocale = Locale(identifier: "en_US_POSIX")

// MARK: - Wire bodies (pure, tested)

/// PATCH one field; blank input clears it (an explicit JSON null).
func contactFieldBody(_ field: String, _ value: String?) -> JSONValue {
    .object([field: value.map(JSONValue.string) ?? .null])
}

/// POST /v1/contacts body — optional fields are OMITTED, not nulled.
func contactCreateBody(
    phoneE164: String,
    name: String?,
    address: String?,
    notes: String?
) -> JSONValue {
    var object: [String: JSONValue] = ["phone_e164": .string(phoneE164)]
    if let name { object["name"] = .string(name) }
    if let address { object["address"] = .string(address) }
    if let notes { object["notes"] = .string(notes) }
    return .object(object)
}

// MARK: - Mutations

/// Contacts feature data access (detail, edits, consent, import/export).
struct ContactMutations: Sendable {
    let api: ApiClient
    let multipart: MultipartClient

    func detail(companyId: String, contactId: String) async throws -> Contact {
        try await api.get("/v1/contacts/\(contactId)", companyId: companyId)
    }

    func members(companyId: String) async throws -> Page<Member> {
        try await api.get("/v1/members", companyId: companyId)
    }

    /// POST /v1/contacts upserts on the phone, so re-adding an existing
    /// number just lands on the same row.
    func create(
        companyId: String,
        phoneE164: String,
        name: String?,
        address: String?,
        notes: String?
    ) async throws -> Contact {
        try await api.post(
            "/v1/contacts",
            body: contactCreateBody(
                phoneE164: phoneE164, name: name, address: address, notes: notes
            ),
            companyId: companyId
        )
    }

    /// Patch ONE field; blank input clears it (an explicit JSON null).
    // MARK: - #291 addresses

    /// One row, one request. A whole-list replace would make "add one address"
    /// a read-modify-write, and two people editing a property manager's forty
    /// buildings would silently lose each other's work.
    func addAddress(
        companyId: String,
        contactId: String,
        body: ContactAddressBody
    ) async throws -> ContactAddressCreated {
        try await api.post(
            "/v1/contacts/\(contactId)/addresses",
            body: body,
            companyId: companyId
        )
    }

    func makeAddressPrimary(
        companyId: String,
        contactId: String,
        addressId: String
    ) async throws -> ContactAddressCreated {
        try await api.patch(
            "/v1/contacts/\(contactId)/addresses/\(addressId)",
            body: ContactAddressBody(is_primary: true),
            companyId: companyId
        )
    }

    func removeAddress(
        companyId: String,
        contactId: String,
        addressId: String
    ) async throws {
        try await api.delete(
            "/v1/contacts/\(contactId)/addresses/\(addressId)",
            companyId: companyId
        )
    }

    func updateField(
        companyId: String,
        contactId: String,
        field: String,
        value: String?
    ) async throws -> Contact {
        try await api.patch(
            "/v1/contacts/\(contactId)",
            body: contactFieldBody(field, value),
            companyId: companyId
        )
    }

    /// #291: the fields this workspace defined for its own trade.
    ///
    /// Read by anyone who can read conversations, not just owners: a member
    /// cannot DEFINE a field, but they have to see the definitions to fill one
    /// in on a contact.
    func contactFields(companyId: String) async throws -> ContactFieldsResponse {
        try await api.get("/v1/contact-fields", companyId: companyId)
    }

    /// Replace the whole set.
    ///
    /// Not per-field saves: there are at most ten, they are ordered relative to
    /// each other, and the order in the list IS the order they appear on every
    /// contact.
    func saveContactFields(
        companyId: String,
        fields: [ContactFieldDef]
    ) async throws -> ContactFieldsResponse {
        try await api.put(
            "/v1/contact-fields",
            body: ContactFieldsBody(fields: fields),
            companyId: companyId
        )
    }

    /// #291: the WHOLE values object, every time.
    ///
    /// The API stores what it is given, so sending only the field that changed
    /// would empty every other one — and that failure is invisible at the
    /// moment it happens: the edited field saves, the rest go blank on the
    /// next load.
    func updateCustomFields(
        companyId: String,
        contactId: String,
        values: [String: String]
    ) async throws -> Contact {
        try await api.patch(
            "/v1/contacts/\(contactId)",
            body: ContactCustomFieldsBody(custom_fields: values),
            companyId: companyId
        )
    }

    /// Soft delete — hidden from lists only; resurrects on next text.
    func delete(companyId: String, contactId: String) async throws {
        try await api.delete("/v1/contacts/\(contactId)", companyId: companyId)
    }

    func optOut(companyId: String, contactId: String) async throws -> OptOut {
        try await api.post("/v1/contacts/\(contactId)/opt-out", companyId: companyId)
    }

    func revokeOptOut(companyId: String, contactId: String) async throws -> OptOut {
        try await api.post("/v1/contacts/\(contactId)/opt-out/revoke", companyId: companyId)
    }

    /// The contact's existing conversation, found the way the web does (#82):
    /// the inbox list's q search on the phone. Nil = no thread yet (compose).
    func findConversation(
        companyId: String,
        phoneE164: String
    ) async throws -> ConversationListItem? {
        let page: Page<ConversationListItem> = try await api.get(
            "/v1/conversations",
            query: ["q": phoneE164, "limit": "1"],
            companyId: companyId
        )
        return page.data.first
    }

    /// #324 — one chronology of everything done for this customer.
    ///
    /// Paginated with the shared opaque cursor (SPEC §7/D10), which carries the
    /// full `(occurred_at, id)` sort key — a timestamp alone skips the second of
    /// any two entries sharing an instant, and its literal `+` does not survive
    /// `URLComponents`.
    func timeline(
        companyId: String,
        contactId: String,
        cursor: String? = nil,
        limit: Int = 50
    ) async throws -> ContactTimelinePage {
        try await api.get(
            "/v1/contacts/\(contactId)/timeline",
            query: ["cursor": cursor, "limit": String(limit)],
            companyId: companyId
        )
    }

    /// Raw UTF-8-BOM CSV (respects the list's q filter; ≤50k rows).
    func exportCsv(companyId: String, q: String?) async throws -> String {
        let data = try await api.raw(
            "GET",
            "/v1/contacts/export",
            query: ["q": q],
            companyId: companyId
        )
        return String(decoding: data, as: UTF8.self)
    }

    /// Admin CSV import: multipart 'file', ≤2MB, ≤2000 rows.
    func importCsv(
        companyId: String,
        fileName: String,
        bytes: Data
    ) async throws -> ImportResult {
        let data = try await multipart.postFile(
            path: "/v1/contacts/import",
            companyId: companyId,
            fields: [],
            fileField: "file",
            fileName: fileName,
            contentType: "text/csv",
            bytes: bytes
        )
        return try JSONDecoder().decode(ImportResult.self, from: data)
    }

    /// Admin vCard import: multipart 'file', ≤5MB, ≤2000 cards.
    func importVcard(
        companyId: String,
        fileName: String,
        bytes: Data
    ) async throws -> ImportResult {
        let data = try await multipart.postFile(
            path: "/v1/contacts/import-vcard",
            companyId: companyId,
            fields: [],
            fileField: "file",
            fileName: fileName,
            contentType: "text/vcard",
            bytes: bytes
        )
        return try JSONDecoder().decode(ImportResult.self, from: data)
    }

    /// #246: the pairs that look like one customer.
    func duplicates(companyId: String) async throws -> Page<DuplicatePair> {
        try await api.get("/v1/contacts/duplicates", companyId: companyId)
    }

    /// #246: fold `from` into `into`.
    ///
    /// Everything from both ends up under the survivor and both numbers keep
    /// working. A STOP on either side holds for the merged contact — the server
    /// writes that union, and it is never undone by an unmerge.
    func merge(
        companyId: String,
        fromContactId: String,
        intoContactId: String
    ) async throws -> ContactMergeResult {
        try await api.post(
            "/v1/contacts/\(fromContactId)/merge",
            body: JSONValue.object(["into_contact_id": .string(intoContactId)]),
            companyId: companyId
        )
    }
}

// MARK: - Consent

enum ConsentSource {
    static let inboundSms = "inbound_sms"
    static let attested = "attested"
    static let imported = "import"
}

/// The consent card's one line, ported from the web contact page's
/// ConsentLine so the copy never drifts:
///  - no consent recorded → the teaching sentence,
///  - inbound_sms → "Texted you first · Jul 8",
///  - anything else (attested/import) → "Consent recorded by {member} · Jul 8"
///    (the attester resolved against GET /v1/members; omitted when unknown).
func consentLine(
    consentSource: String?,
    consentAt: String?,
    consentAttestedBy: String?,
    memberName: (String?) -> String?,
    calendar: Calendar = .current
) -> String {
    guard let consentSource else {
        return "No consent recorded yet. It's recorded when they text you first, "
            + "or when you send them their first text, which attests they asked for it."
    }
    let date: String? = parseWireTimestamp(consentAt).map { parsed in
        let formatter = DateFormatter()
        formatter.locale = posixLocale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "MMM d"
        return formatter.string(from: parsed)
    }
    let suffix = date.map { " · \($0)" } ?? ""
    if consentSource == ConsentSource.inboundSms {
        return "Texted you first\(suffix)"
    }
    if let attester = memberName(consentAttestedBy) {
        return "Consent recorded by \(attester)\(suffix)"
    }
    return "Consent recorded\(suffix)"
}
