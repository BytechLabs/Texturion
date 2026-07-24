import Foundation

/// #214 — AI task enrichment wire models + shared address value type. Mirrors
/// apps/web/src/lib/api/types.ts (AddressProvenance, TaskAddress,
/// TaskEnrichment, CompanyAiSettings) and the server contract in
/// apps/api/src/routes/{tasks,companies}.ts. Enrichment is a pure SUGGESTION:
/// the endpoint always 200s and never blocks task creation.

/// Where a task's address came from — drives the provenance badge. String
/// namespace (never an enum) so a value added server-side never crashes a
/// lagging build; UI switches always carry a default arm.
enum AddressProvenance {
    static let message = "message"
    static let contact = "contact"
    static let company = "company"
    static let manual = "manual"
}

/// The provenance badge copy — shown only for AI sources (never manual/null),
/// verbatim from the web's `provenanceLabel` / `addrProvenanceLabel`.
func addressProvenanceLabel(_ provenance: String?) -> String? {
    switch provenance {
    case AddressProvenance.message: return "From the message"
    case AddressProvenance.contact: return "From the contact"
    case AddressProvenance.company: return "Inferred from area code"
    default: return nil
    }
}

/// A structured task/job address (enrichment result + task read fields). Every
/// field nullable — a partial address is legitimate (city-only inference,
/// street-only quick entry).
struct TaskAddress: Codable, Sendable {
    let street: String?
    let unit: String?
    let city: String?
    let state: String?
    let postal_code: String?
    let country: String?
}

/// POST /v1/tasks/enrich result — a SUGGESTION the user reviews before saving.
/// Any field may be null (toggle off, nothing found, degraded). Modeled with
/// plain optionals so an absent/null key decodes to nil (never throws).
struct TaskEnrichment: Codable, Sendable {
    let address: TaskAddress?
    /// The model's provenance ("message"/"contact"/"company"); never "manual".
    let address_provenance: String?
    let due_at: String?
    /// True when the endpoint short-circuited because every toggle is off.
    let enrichment_disabled: Bool?

    /// The degrade-to-nothing result — returned on any client-side failure so
    /// task creation is never blocked by the AI path.
    static let empty = TaskEnrichment(
        address: nil,
        address_provenance: nil,
        due_at: nil,
        enrichment_disabled: nil
    )
}

/// GET/PATCH /v1/company/ai-settings — per-company enrichment opt-in. Both
/// toggles default ON (matching the server default), so an absent/lagging field
/// decodes to enabled rather than off.
struct CompanyAiSettings: Codable, Sendable {
    @Default<DefaultTrue> var enrich_task_address: Bool
    @Default<DefaultTrue> var enrich_task_due: Bool

    init(enrich_task_address: Bool, enrich_task_due: Bool) {
        self.enrich_task_address = enrich_task_address
        self.enrich_task_due = enrich_task_due
    }

    /// Any enrichment on → the make-task sheet should call /tasks/enrich.
    var anyEnabled: Bool { enrich_task_address || enrich_task_due }
}

/// The 6 editable address fields as strings ("" = absent). Shared by the
/// make-task sheet and the task-detail address section; the pure wire-body
/// builders (`taskAddressBody` / `taskAddressPatchBody`) consume it.
struct AddressFieldValues: Equatable, Sendable {
    var street: String
    var unit: String
    var city: String
    var state: String
    var postalCode: String
    var country: String

    init(
        street: String = "",
        unit: String = "",
        city: String = "",
        state: String = "",
        postalCode: String = "",
        country: String = ""
    ) {
        self.street = street
        self.unit = unit
        self.city = city
        self.state = state
        self.postalCode = postalCode
        self.country = country
    }

    /// Seed from an enrichment's structured address (nil fields → "").
    init(_ address: TaskAddress?) {
        self.init(
            street: address?.street ?? "",
            unit: address?.unit ?? "",
            city: address?.city ?? "",
            state: address?.state ?? "",
            postalCode: address?.postal_code ?? "",
            country: address?.country ?? ""
        )
    }

    /// True when every field is blank — no address to send.
    var isEmpty: Bool {
        [street, unit, city, state, postalCode, country]
            .allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    /// A whitespace-trimmed copy — compare two `trimmed` values to detect a
    /// real change (the no-op guard before a save).
    var trimmed: AddressFieldValues {
        func t(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
        return AddressFieldValues(
            street: t(street),
            unit: t(unit),
            city: t(city),
            state: t(state),
            postalCode: t(postalCode),
            country: t(country)
        )
    }
}
