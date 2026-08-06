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

    /// #291: record another number this customer answers.
    ///
    /// One row per request, like the addresses. The server refuses a number
    /// somebody else already has and its message names them — taking it would
    /// silently redirect that customer's texts and calls onto this record.
    func addPhone(
        companyId: String,
        contactId: String,
        body: ContactPhoneBody
    ) async throws -> ContactPhoneCreated {
        try await api.post(
            "/v1/contacts/\(contactId)/phones",
            body: body,
            companyId: companyId
        )
    }

    func removePhone(
        companyId: String,
        contactId: String,
        phoneId: String
    ) async throws {
        try await api.delete(
            "/v1/contacts/\(contactId)/phones/\(phoneId)",
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

    /// Admin CSV import — bounds and the attestation field both come from
    /// `ContactImport`, which is the port of the shared contract.
    ///
    /// `consentAttested` has no default. #226 shipped the server gate with no
    /// client sending the field, and every CSV import from this app has 422'd
    /// since; a default here would let the next call site skip the question the
    /// same way. Passing `false` posts nothing and lets the server say why.
    ///
    /// `columns` has no default for the same reason, one door along (#248 round
    /// 3): a caller that quietly sent none would be refused by the server for a
    /// file it had already read, and a caller that quietly assembled one from
    /// its own guesses would have told the server that somebody accounted for
    /// columns nobody was ever shown. The declaration is a person's, and it
    /// arrives here already built out of answered menus.
    func importCsv(
        companyId: String,
        fileName: String,
        bytes: Data,
        consentAttested: Bool,
        columns: [ContactImportColumnDeclaration]
    ) async throws -> ImportResult {
        let data = try await multipart.postFile(
            path: "/v1/contacts/import",
            companyId: companyId,
            fields: ContactImport.formFields(
                consentAttested: consentAttested,
                columns: columns,
                // A CSV has no vCard properties. Empty rather than absent: both
                // doors go through the one function that knows the field names.
                properties: []
            ),
            fileField: "file",
            fileName: fileName,
            contentType: ContactImportKind.csv.contentType,
            bytes: bytes
        )
        return try JSONDecoder().decode(ImportResult.self, from: data)
    }

    /// Admin vCard import. #248 put the same attestation in front of this door:
    /// it was the only bulk-contact route that never asked for a basis, which
    /// made it the inverse of what #226 was for.
    ///
    /// Round 3 gave it the accounting too. A .vcf has no columns, but it has
    /// PROPERTIES, and `CATEGORIES:DNC` and a `NOTE` saying they asked us to
    /// stop are the only two places the format can say do-not-text — both of
    /// which this door used to drop without a word.
    func importVcard(
        companyId: String,
        fileName: String,
        bytes: Data,
        consentAttested: Bool,
        properties: [VCardPropertyDeclaration]
    ) async throws -> ImportResult {
        let data = try await multipart.postFile(
            path: "/v1/contacts/import-vcard",
            companyId: companyId,
            fields: ContactImport.formFields(
                consentAttested: consentAttested,
                // A .vcf has no columns. Empty rather than absent, for the same
                // reason the CSV door sends no properties.
                columns: [],
                properties: properties
            ),
            fileField: "file",
            fileName: fileName,
            contentType: ContactImportKind.vcard.contentType,
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

/// The two values `consent_source_t` has, and it has no others.
///
/// There used to be a third here, `imported = "import"`, and the database has
/// never been able to produce it — the enum is
/// `create type consent_source_t as enum ('inbound_sms','attested')`. It read
/// as a documented third way consent could arrive, which is precisely the thing
/// nobody should believe about an import: a file does not carry a basis, so an
/// imported contact is either attested by the person who uploaded it or has no
/// consent at all.
enum ConsentSource {
    static let inboundSms = "inbound_sms"
    static let attested = "attested"
}

/// The consent card's one line, ported from the web contact page's
/// ConsentLine so the copy never drifts:
///  - no consent recorded → the teaching sentence,
///  - inbound_sms → "Texted you first · Jul 8",
///  - anything else → "Consent recorded by {member} · Jul 8" (the attester
///    resolved against GET /v1/members; omitted when unknown).
///
/// "Anything else" is `attested` today, and stays a fallthrough rather than a
/// match on it: a source a later migration adds must still say that a basis
/// exists, not drop back to the teaching line that invites somebody to attest
/// one that is already there.
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
