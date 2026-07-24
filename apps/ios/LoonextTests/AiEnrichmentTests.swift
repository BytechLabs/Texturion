import XCTest
@testable import Loonext

/// #214 — wire-level checks for AI task enrichment: the address body builders
/// (create + patch), the enrichment/settings decodes, the provenance-label
/// copy, and the TaskItem address columns. Pure functions + Codable, so the
/// exact bytes and shapes are assertable without a mock server (mirrors the web
/// contract in apps/web/src/lib/api/types.ts and routes/{tasks,companies}.ts).
final class AiEnrichmentTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private func encoded(_ value: JSONValue) throws -> String {
        String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
    }

    /// Round-trip through JSON so multi-key object equality is order-independent.
    private func decoded(_ value: JSONValue) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: try JSONEncoder().encode(value))
    }

    // MARK: - Address body builders

    func testAddressBodyTrimsAndNullsEmptyFields() throws {
        let fields = AddressFieldValues(
            street: "  123 Main St  ",
            unit: "",
            city: "Austin",
            state: "TX",
            postalCode: "",
            country: "US"
        )
        let body = try XCTUnwrap(taskAddressBody(fields, provenance: "message"))
        XCTAssertEqual(try decoded(body), .object([
            "street": .string("123 Main St"),
            "unit": .null,
            "city": .string("Austin"),
            "state": .string("TX"),
            "postal_code": .null,
            "country": .string("US"),
            "provenance": .string("message"),
        ]))
    }

    func testAddressBodyIsNilWhenEveryFieldBlank() {
        XCTAssertNil(taskAddressBody(AddressFieldValues(), provenance: "manual"))
        XCTAssertNil(taskAddressBody(AddressFieldValues(street: "   "), provenance: "manual"))
    }

    func testAddressPatchBodyClearsWithExplicitNull() throws {
        XCTAssertEqual(
            try encoded(taskAddressPatchBody(AddressFieldValues(), provenance: "manual")),
            "{\"address\":null}"
        )
    }

    func testAddressPatchBodyCarriesTheBlock() throws {
        let fields = AddressFieldValues(city: "Denver", country: "US")
        XCTAssertEqual(
            try decoded(taskAddressPatchBody(fields, provenance: "manual")),
            .object([
                "address": .object([
                    "street": .null,
                    "unit": .null,
                    "city": .string("Denver"),
                    "state": .null,
                    "postal_code": .null,
                    "country": .string("US"),
                    "provenance": .string("manual"),
                ]),
            ])
        )
    }

    func testCreateBodyIncludesAddressWhenPresent() throws {
        let address = taskAddressBody(AddressFieldValues(city: "Austin"), provenance: "contact")
        XCTAssertEqual(
            try decoded(
                taskCreateBody(
                    messageId: "m1",
                    title: "Fix the sink",
                    assignedUserId: nil,
                    dueAt: nil,
                    address: address
                )
            ),
            .object([
                "message_id": .string("m1"),
                "title": .string("Fix the sink"),
                "address": .object([
                    "street": .null,
                    "unit": .null,
                    "city": .string("Austin"),
                    "state": .null,
                    "postal_code": .null,
                    "country": .null,
                    "provenance": .string("contact"),
                ]),
            ])
        )
    }

    func testCreateBodyOmitsAddressWhenAbsent() throws {
        XCTAssertEqual(
            try decoded(
                taskCreateBody(messageId: "m1", title: "Fix", assignedUserId: nil, dueAt: nil)
            ),
            .object(["message_id": .string("m1"), "title": .string("Fix")])
        )
    }

    // MARK: - Provenance label copy

    func testProvenanceLabelCopy() {
        XCTAssertEqual(addressProvenanceLabel("message"), "From the message")
        XCTAssertEqual(addressProvenanceLabel("contact"), "From the contact")
        XCTAssertEqual(addressProvenanceLabel("company"), "Inferred from area code")
        XCTAssertNil(addressProvenanceLabel("manual"))
        XCTAssertNil(addressProvenanceLabel(nil))
    }

    // MARK: - AddressFieldValues helpers

    func testAddressFieldValuesSeedingAndTrim() {
        let seeded = AddressFieldValues(
            TaskAddress(
                street: "1 A St",
                unit: nil,
                city: "Reno",
                state: nil,
                postal_code: nil,
                country: "US"
            )
        )
        XCTAssertEqual(seeded.street, "1 A St")
        XCTAssertEqual(seeded.unit, "")
        XCTAssertEqual(seeded.city, "Reno")
        XCTAssertFalse(seeded.isEmpty)

        XCTAssertTrue(AddressFieldValues().isEmpty)
        XCTAssertTrue(AddressFieldValues(street: "   ").isEmpty)
        XCTAssertEqual(AddressFieldValues(street: "  x  ").trimmed.street, "x")
    }

    // MARK: - Settings + enrichment decodes

    func testCompanyAiSettingsDefaultsTrueForMissingKeys() throws {
        // Both toggles default ON (server parity), so an absent/lagging field
        // decodes to enabled rather than off.
        let settings: CompanyAiSettings = try decode("{}")
        XCTAssertTrue(settings.enrich_task_address)
        XCTAssertTrue(settings.enrich_task_due)
        XCTAssertTrue(settings.anyEnabled)
    }

    func testCompanyAiSettingsDecodesBothToggles() throws {
        let settings: CompanyAiSettings = try decode(
            #"{"enrich_task_address":true,"enrich_task_due":false}"#
        )
        XCTAssertTrue(settings.enrich_task_address)
        XCTAssertFalse(settings.enrich_task_due)
        XCTAssertTrue(settings.anyEnabled)
    }

    func testEnrichmentDecodesAddressAndDue() throws {
        let enrichment: TaskEnrichment = try decode(#"""
        {"address":{"street":"123 Main St","unit":null,"city":"Austin","state":"TX",
         "postal_code":"78701","country":"US"},"address_provenance":"message",
         "due_at":"2026-07-20T15:00:00-04:00"}
        """#)
        XCTAssertEqual(enrichment.address?.street, "123 Main St")
        XCTAssertNil(enrichment.address?.unit)
        XCTAssertEqual(enrichment.address?.city, "Austin")
        XCTAssertEqual(enrichment.address_provenance, "message")
        XCTAssertEqual(enrichment.due_at, "2026-07-20T15:00:00-04:00")
        XCTAssertNil(enrichment.enrichment_disabled)
    }

    func testEnrichmentDisabledShortCircuit() throws {
        let enrichment: TaskEnrichment = try decode(#"""
        {"address":null,"address_provenance":null,"due_at":null,"enrichment_disabled":true}
        """#)
        XCTAssertNil(enrichment.address)
        XCTAssertNil(enrichment.due_at)
        XCTAssertEqual(enrichment.enrichment_disabled, true)
    }

    // MARK: - Task address columns

    func testTaskItemDecodesAddressColumns() throws {
        let task: TaskItem = try decode(#"""
        {"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"cv1",
         "title":"Fix sink","assigned_user_id":null,"due_at":null,
         "created_by_user_id":"u1","created_at":"2026-07-01T00:00:00Z",
         "updated_at":"2026-07-01T00:00:00Z","done":false,"status":"open",
         "addr_street":"5 Oak Ave","addr_city":"Denver","addr_provenance":"manual"}
        """#)
        XCTAssertEqual(task.addr_street, "5 Oak Ave")
        XCTAssertEqual(task.addr_city, "Denver")
        XCTAssertEqual(task.addr_provenance, "manual")
        XCTAssertNil(task.addr_unit)
    }

    func testTaskItemAddressColumnsDefaultNilForPreFeatureRows() throws {
        let task: TaskItem = try decode(#"""
        {"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"cv1",
         "title":"Fix sink","assigned_user_id":null,"due_at":null,
         "created_by_user_id":"u1","created_at":"2026-07-01T00:00:00Z",
         "updated_at":"2026-07-01T00:00:00Z","done":false,"status":"open"}
        """#)
        XCTAssertNil(task.addr_street)
        XCTAssertNil(task.addr_provenance)
    }

    func testTaskDetailAddressFieldsMapColumns() throws {
        let detail: TaskDetail = try decode(#"""
        {"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"cv1",
         "title":"Fix sink","description":"","assigned_user_id":null,"due_at":null,
         "created_by_user_id":"u1","created_at":"2026-07-01T00:00:00Z",
         "updated_at":"2026-07-01T00:00:00Z","done":false,"status":"open",
         "assignee":null,"created_by":null,"source_message":null,
         "addr_street":"5 Oak Ave","addr_state":"CO","addr_provenance":"contact"}
        """#)
        let fields = detail.addressFields
        XCTAssertEqual(fields.street, "5 Oak Ave")
        XCTAssertEqual(fields.state, "CO")
        XCTAssertEqual(fields.city, "")
        XCTAssertFalse(fields.isEmpty)
        XCTAssertEqual(detail.addr_provenance, "contact")
    }
}
