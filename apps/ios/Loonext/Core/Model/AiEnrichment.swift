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
    /// Offer AI-drafted replies in the composer. Never sent for you.
    @Default<DefaultTrue> var suggest_replies: Bool
    /// One sentence about what the business does, used to ground Lou's drafts.
    /// Nil means Lou has been told nothing and may not describe the business.
    var business_description: String?
    /// Transcribe new voicemails. Off leaves the recording exactly as it was:
    /// this only decides whether the words appear beside it.
    @Default<DefaultTrue> var transcribe_voicemail: Bool
    /// #367/D89: ask callers for the problem and the address in the voicemail
    /// greeting, and break the transcript out into those fields.
    ///
    /// The one Lou setting that defaults to FALSE, here and on the server. Every
    /// other one produces something a member reads before a customer sees it;
    /// this one changes what a stranger hears when they ring, in the business's
    /// own name. So an absent or lagging field must decode to OFF — the opposite
    /// of the rule the rest of this struct follows, and deliberately.
    @Default<DefaultFalse> var voicemail_intake: Bool
    /// #507/D117: write down the wrap-up a crew member SPEAKS after hanging up
    /// — their own voice, about a call that has already ended.
    ///
    /// Back to the true default the rest of this struct follows, and for the
    /// reason D89 gives for making the intake the exception: nothing here
    /// reaches a stranger. The words are the member's own, and they read and
    /// edit them before they become a note.
    ///
    /// The `@Default` wrapper only supplies a DECODING fallback, so the
    /// memberwise init below carries the `true` a second time. Both are load
    /// bearing: one for a lagging server, one for a caller building a settings
    /// value by hand.
    @Default<DefaultTrue> var call_wrapup: Bool
    /// #247: offer a catch-up on a long or long-forgotten thread.
    ///
    /// True by default, here and on the server (`DEFAULT_AI_SETTINGS`), for the
    /// reason D117 gives for making the voicemail intake the exception: nothing
    /// here reaches a stranger. It is read by the crew, about a conversation
    /// they can already read, and every line taps through to the message it came
    /// from.
    @Default<DefaultTrue> var summarize_threads: Bool

    init(
        enrich_task_address: Bool,
        enrich_task_due: Bool,
        suggest_replies: Bool = true,
        business_description: String? = nil,
        transcribe_voicemail: Bool = true,
        voicemail_intake: Bool = false,
        call_wrapup: Bool = true,
        summarize_threads: Bool = true
    ) {
        self.enrich_task_address = enrich_task_address
        self.enrich_task_due = enrich_task_due
        self.suggest_replies = suggest_replies
        self.business_description = business_description
        self.transcribe_voicemail = transcribe_voicemail
        self.voicemail_intake = voicemail_intake
        self.call_wrapup = call_wrapup
        self.summarize_threads = summarize_threads
    }

    /// Any enrichment on → the make-task sheet should call /tasks/enrich.
    var anyEnabled: Bool { enrich_task_address || enrich_task_due }
}

/// Matches the column's CHECK constraint (migration 20260724120000).
let businessDescriptionMax = 280

/// POST /v1/conversations/:id/reply-suggestions — up to three drafts the person
/// reads and edits. An empty list is the normal "nothing to offer" answer
/// (toggle off, nothing to reply to, over the monthly cap, model unavailable).
struct ReplySuggestions: Codable, Sendable {
    @Default<DefaultEmptyList<String>> var suggestions: [String]
    /// Lou has not been told what this business does. The prompt refuses to
    /// say anything about the trade without that line, so every draft is
    /// thinner until someone writes it.
    @Default<DefaultFalse> var business_unknown: Bool
    /// Why the list is empty; absent on success. See `replyDraftMessage`.
    var reason: String?

    // Spelled out so a caller building a failure result does not have to
    // supply fields that only a real answer carries.
    init(
        suggestions: [String] = [],
        business_unknown: Bool = false,
        reason: String? = nil
    ) {
        self.suggestions = suggestions
        self.business_unknown = business_unknown
        self.reason = reason
    }
}

/// Plain-language copy for an empty result. One blanket "nothing to suggest"
/// hid real breakage behind what looked like a shrug, so each reason says what
/// happened and whether trying again will help. Mirrors
/// suggestionFailureMessage in apps/web/src/lib/api/reply-suggestions.ts.
func replyDraftMessage(_ reason: String?) -> String {
    switch reason {
    case "disabled":
        return "Drafting is turned off for this workspace. Settings, AI turns it back on."
    // #250: a thread somebody marked as spam never spends AI budget.
    case "spam":
        return "This thread is marked as spam, so Lou skips it. Unmark it to draft a reply."
    case "nothing_to_reply":
        return "Nothing to draft from yet. Type a few words and try again."
    // #581: billing, not breakage — so it must not say "try again", which is
    // not what fixes it. Same sentence everywhere Lou refuses for this reason.
    case "subscription_inactive":
        return "Lou is paused while the subscription is sorted out. An owner can fix that in Billing."
    case "over_cap":
        return "This month's drafting is used up. It starts again next month."
    case "rate_limited":
        return "That was a lot of drafts at once. Try again in a moment."
    case "model_error", "unavailable":
        return "Couldn't reach Lou just now. Try again."
    case "unusable_output":
        return "Nothing came back worth sending. Try again, or add a few words first."
    default:
        return "No drafts this time. Try again."
    }
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
