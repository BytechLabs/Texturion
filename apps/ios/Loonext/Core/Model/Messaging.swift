import Foundation

enum ConversationStatus {
    static let new = "new"
    static let open = "open"
    static let waiting = "waiting"
    static let closed = "closed"
}

enum MessageDirection {
    static let inbound = "inbound"
    static let outbound = "outbound"
    static let note = "note"
}

enum MessageStatus {
    static let received = "received"
    static let queued = "queued"
    static let sent = "sent"
    static let delivered = "delivered"
    static let failed = "failed"
}

struct ContactSummary: Codable, Sendable {
    let id: String
    let name: String?
    let phone_e164: String
}

struct Tag: Codable, Sendable {
    let id: String
    let name: String
    let color: String?
    let created_at: String?
    let updated_at: String?
    /// #298: what this tag MEANS, in the crew's own words. Nil when nobody has
    /// said — which is most of them, and must stay comfortable: a required
    /// description would be answered with "warranty" for a tag named Warranty
    /// by everybody in a hurry, and that looks like an answer without being one.
    ///
    /// Declared last with a default so the memberwise initialiser every preview
    /// and test already calls keeps compiling. `var` rather than `let` for the
    /// same reason: a `let` with an initial value takes no memberwise argument
    /// at all, which would make the field unsettable in a fixture.
    var description: String? = nil
}

/// #298: one tag and how much it is actually used. Ordered busiest-first by the
/// server, because the tail is where the duplicates and the dead ones both live
/// — and neither is visible from the tag names alone.
struct TagUsage: Codable, Sendable, Identifiable {
    let tag_id: String
    let name: String
    /// #298: what it means, so the merge decision can be made from this list.
    var description: String?
    @Default<DefaultZero> var uses: Int
    let last_used: String?

    var id: String { tag_id }
}

/// #298: what a merge did, so the confirmation can say it back.
struct TagMergeResult: Codable, Sendable {
    @Default<DefaultFalse> var merged: Bool
    @Default<DefaultZero> var moved: Int
    @Default<DefaultZero> var already_both: Int
    @Default<DefaultFalse> var stage_moved: Bool
}

struct Conversation: Codable, Sendable {
    let id: String
    let company_id: String
    let contact_id: String
    let phone_number_id: String
    let status: String
    let is_spam: Bool
    let assigned_user_id: String?
    let pinned_at: String?
    let pinned_by_user_id: String?
    let last_message_at: String
    let closed_at: String?
    /// #414: when this thread last carried an emergency reply (URGENT/
    /// EMERGENCY/911/SOS). The inbox badges it while the thread is open.
    /// `var … = nil` rather than `let`: a `let` optional becomes a REQUIRED
    /// memberwise-init parameter and breaks every existing construction site.
    var emergency_at: String? = nil
    /**
     #301: where this customer came from, and how we came to believe it.

     `var … = nil` for the same reason `emergency_at` above is: a `let`
     optional becomes a REQUIRED memberwise-init parameter and breaks every
     existing construction site.

     On the ROW as well as the detail, because the picker reads the origin back
     off the PATCH response — the server decides that a person's answer is
     'manual', and a client that assumed it would be inventing the one
     distinction the report depends on. CI caught the omission; Swift compiles
     nowhere else.
     */
    var lead_source_id: String? = nil
    var lead_source_origin: String? = nil
    let created_at: String
    let updated_at: String
}

/// Newest-message snippet embedded on every GET /v1/conversations row.
struct ConversationSnippet: Codable, Sendable {
    let id: String
    let direction: String
    let body: String
    let created_at: String
    let has_attachments: Bool
    /// How many attachments ride the last message. Optional so a response from
    /// a server that predates migration 20260724080000 still decodes.
    var attachment_count: Int?
    /// The kind they all share, "file" for a mixed set, nil when there are
    /// none. The inbox labels from THIS instead of guessing a noun.
    var attachment_kind: String?
}

/// GET /v1/conversations row (api_list_conversations RPC).
struct ConversationListItem: Codable, Sendable {
    let id: String
    let company_id: String
    let contact_id: String
    let phone_number_id: String
    let status: String
    let is_spam: Bool
    let assigned_user_id: String?
    let pinned_at: String?
    let pinned_by_user_id: String?
    let last_message_at: String
    let closed_at: String?
    /// #414: set when a customer replied URGENT; badged while the thread is
    /// open. `var … = nil` rather than `let` so it does not become a required
    /// memberwise-init parameter at every existing construction site.
    var emergency_at: String? = nil
    let created_at: String
    let updated_at: String
    let contact: ContactSummary
    @Default<DefaultEmptyList<Tag>> var tags: [Tag]
    @Default<DefaultFalse> var unread: Bool
    let last_message: ConversationSnippet?
    /// #293: when THIS member's deferral brings the thread back, and why they
    /// deferred it. Nil for everyone else — the snooze is mine, the
    /// conversation is the crew's — and nil once the return time has passed,
    /// because the server computes "currently deferred" rather than sweeping
    /// rows on a timer. `var … = nil` so it does not become a required
    /// memberwise-init parameter at every existing construction site.
    var snoozed_until: String? = nil
    var snooze_note: String? = nil
}

struct AttachmentSummary: Codable, Sendable {
    let id: String
    let content_type: String
    let size_bytes: Int?
}

/// The linked-task chip a promoted message / task-linked note carries.
struct MessageTaskLink: Codable, Sendable {
    let id: String
    let title: String
}

struct Message: Codable, Sendable {
    let id: String
    let conversation_id: String
    let direction: String
    let body: String
    /// nil iff direction='note'.
    ///
    /// `var` so a merge can keep a status a stale page would otherwise walk
    /// backwards (see mergeMessage). The error fields travel with it, since
    /// they describe the state being kept.
    var status: String?
    let segments: Int?
    let encoding: String?
    let sent_by_user_id: String?
    var error_code: String?
    /// #241: why the send failed, in OUR taxonomy rather than the carrier's.
    /// nil on rows written before the column existed — readers use
    /// `failureReasonOf`, which falls back to classifying the code.
    ///
    /// `= nil` rather than a bare optional: without a default it becomes a
    /// REQUIRED memberwise-init parameter and breaks every construction site.
    var error_reason: String? = nil
    var error_detail: String?
    let telnyx_message_id: String?
    let done_at: String?
    let done_by_user_id: String?
    let pinned_at: String?
    let pinned_by_user_id: String?
    let created_at: String
    @Default<DefaultEmptyList<AttachmentSummary>> var attachments: [AttachmentSummary]
    @Default<DefaultFalse> var has_task: Bool
    let promoted_task: MessageTaskLink?
    let task_id: String?
    let task: MessageTaskLink?

    /// The one retry affordance rule: API-level failure only (no carrier id),
    /// and never a carrier opt-out block.
    var retryable: Bool {
        direction == MessageDirection.outbound &&
            status == MessageStatus.failed &&
            telnyx_message_id == nil &&
            // #241: OUR reason, not the vendor's code. This used to compare
            // against a Telnyx constant shipped inside the app.
            isRetryableFailure(failureReasonOf(error_reason, error_code))
    }

    /// The task this message links to — the tap target for the thread's task
    /// indicator (#217): a source message's promoted task, or a task-linked
    /// note's task. Nil when the message carries no task.
    var linkedTaskId: String? {
        promoted_task?.id ?? task?.id ?? task_id
    }
}

/// Contact embed on GET /v1/conversations/:id.
struct ConversationDetailContact: Codable, Sendable {
    let id: String
    let name: String?
    let phone_e164: String
    let address: String?
    let notes: String?
    let consent_source: String?
    let consent_at: String?
    let deleted_at: String?
    /// #228 — the language THIS customer's automated texts go out in.
    ///
    /// Nil means "whatever the business works in", never English. Read through
    /// `MessageLocale.resolve`, never directly.
    let locale: String?
}

enum DefaultViewerText: DefaultCodableProvider {
    static var defaultValue: String { "text" }
}

/// GET /v1/conversations/:id — embeds the first page of messages.
/// #244 — what acknowledging said.
///
/// `already_acknowledged` is not an error: the caller did nothing wrong, and
/// what they need is the NAME so the app can say "Sam has this".
struct AcknowledgeResult: Codable, Sendable {
    var outcome: String = ""
    var kind: String? = nil
    var acknowledged_by: String? = nil
    var acknowledged_at: String? = nil
}

/// #244 — an after-hours page on this thread that nobody has claimed.
///
/// `on_call_name` is resolved server-side: "Dana was told first" is what makes
/// the banner worth reading, and a bare uuid is not.
struct OpenAlert: Codable, Sendable {
    var id: String = ""
    var kind: String = ""
    var on_call_user_id: String? = nil
    var on_call_name: String? = nil
    var created_at: String = ""
}

struct ConversationDetail: Codable, Sendable {
    let id: String
    let company_id: String
    let contact_id: String
    let phone_number_id: String
    let status: String
    let is_spam: Bool
    let assigned_user_id: String?
    let pinned_at: String?
    let pinned_by_user_id: String?
    let last_message_at: String
    let closed_at: String?
    /// #414 / #565: when a customer's reply here last read as urgent.
    ///
    /// The server has always sent this and this model never asked for it, so the
    /// decoder dropped it and the thread you land on FROM an urgent notification
    /// was the one screen that could not say why you were there. Read through
    /// `isFlaggedUrgent`, never directly — a thread that was urgent and has been
    /// closed is history, not a live mark. `var … = nil` so it does not become a
    /// required memberwise-init parameter at every construction site.
    var emergency_at: String? = nil
    /// #396: when an inbound message here last READ as a plain-English
    /// opt-out. A warning for whoever replies next, never an opt-out — only
    /// the contact can opt out, and only they can lift it. `var … = nil` so it
    /// does not become a required memberwise-init parameter everywhere.
    var opt_out_hint_at: String? = nil
    let created_at: String
    let updated_at: String
    let contact: ConversationDetailContact
    @Default<DefaultEmptyList<Tag>> var tags: [Tag]
    /// #293: when THIS member's deferral brings the thread back, and why they
    /// deferred it. Nil for everyone else — the snooze is mine, the
    /// conversation is the crew's — and nil once the return time has passed,
    /// because the server computes "currently deferred" rather than sweeping
    /// rows on a timer. `var … = nil` so it does not become a required
    /// memberwise-init parameter at every existing construction site.
    var snoozed_until: String? = nil
    var snooze_note: String? = nil
    /// #293: how it comes back — "snooze" quietly, "follow_up" as something to
    /// chase. Detail only: the list cannot tell "back Thursday" from "chase
    /// them Thursday", and in the thread that is the difference between a
    /// reminder and a nap.
    var snooze_kind: String? = nil
    let messages: Page<Message>
    /// #244: nil on nearly every thread, and nil once somebody claims it — an
    /// acknowledged alert is history the timeline already records. `var … = nil`
    /// so it does not become a required memberwise-init parameter at every
    /// existing construction site.
    var open_alert: OpenAlert? = nil
    /// #106: 'note' = read + internal notes only (composer hides SMS mode).
    @Default<DefaultViewerText> var viewer_level: String
    /// #225 / D49: what time it is where the customer is. Resolved server-side
    /// by the same module the send gate uses, so the composer's hint and the
    /// gate's decision cannot disagree. `var … = nil` so it does not become a
    /// required memberwise-init parameter in every fixture.
    var destination_clock: DestinationClock? = nil
    /// #250: when the inbound classifier last scored this thread above the
    /// threshold. Never set by a person, and never a reason to hide the
    /// thread — it suppressed the notification and nothing else.
    /// `var … = nil` so it does not become a required memberwise-init
    /// parameter in every fixture.
    var spam_suspected_at: String? = nil
    /// #250: the reasons behind it, so the badge can say WHY. Optional, not
    /// `@Default`: a property wrapper supplies a DECODING fallback but not a
    /// memberwise default, so it would become a required parameter at all six
    /// existing ConversationDetail construction sites.
    var spam_signals: [SpamSignal]? = nil
    /**
     #301: where this customer came from, and how we came to believe it.

     The ORIGIN travels with the id. A source shown without it is exactly the
     "inferred source presented as a fact" #301 forbids — "the truck rang" and
     "a tech says a neighbour sent them" are different kinds of claim.
     */
    var lead_source_id: String? = nil
    var lead_source_origin: String? = nil
}

/// #250 — one reason the classifier scored a thread.
///
/// Hand-copied across the wire boundary from
/// apps/api/src/messaging/spam-signals.ts: the scoring never runs on a
/// client, so only the shape travels.
struct SpamSignal: Codable, Sendable, Identifiable {
    @Default<DefaultEmptyString> var key: String
    @Default<DefaultZero> var weight: Int
    /// A full sentence, rendered verbatim.
    @Default<DefaultEmptyString> var why: String

    var id: String { key + why }
}

/// #225 / D49 — the destination's clock, and which rung of the ladder answered.
///
/// `source` matters as much as the hour: an area code is a GUESS that can be
/// wrong (a mobile keeps its code when its owner moves), so a screen shows the
/// provenance rather than presenting an inference as a fact.
struct DestinationClock: Codable, Sendable {
    let timezone: String
    /// 'contact' | 'area_code' | 'company'.
    let source: String?
    let local_hour: Int?
    /// Inside their quiet window, including state rules (Texas Sundays).
    let quiet: Bool?

    var rung: String { source ?? "company" }
    var hour: Int { local_hour ?? 0 }
    var isQuiet: Bool { quiet ?? false }
}

/// #233 — a text that has been written and has not gone yet.
///
/// Deliberately NOT a ``Message``. It has no delivery status, no segments
/// billed and no carrier id, and it may never become one — so it lives in its
/// own table server-side and in its own type here. Nothing that reads messages
/// can then accidentally show an unsent one as sent, which is this feature's
/// worst possible bug: the sender believes a customer was told something they
/// were not.
struct ScheduledMessage: Codable, Sendable, Identifiable {
    let id: String
    let conversation_id: String
    let body: String
    let send_at: String
    /// The DESTINATION's zone, resolved once at schedule time and stored.
    let clock_timezone: String
    /// 'contact' | 'area_code' | 'company' — which rung answered.
    var clock_source: String? = nil
    /// 'pending' | 'held' | 'sent' | 'canceled' | 'expired' | 'failed'.
    let status: String
    /// Why it is not going, in the API's own words. Nil while simply waiting.
    var held_reason: String? = nil
    /// #228 — the same reason as a catalogue key, so it reads in the member's
    /// language. Null on rows written before 2026-08-17; render both through
    /// `scheduledHoldText`.
    var held_reason_key: String? = nil
    var held_at: String? = nil
    var expires_at: String? = nil
    var sent_message_id: String? = nil
    var created_by: String? = nil
    var created_at: String? = nil
    /// Who it is going to, embedded by the list route.
    ///
    /// The thread strip does not need this — the customer's name is already in
    /// the header above it — but the workspace view is a list of texts to
    /// DIFFERENT people, and a list of bodies with no names is the surprise
    /// #233 asks us to prevent rather than the answer to it.
    var conversations: ScheduledConversation? = nil

    var rung: String { clock_source ?? "company" }
    var isHeld: Bool { status == "held" }
}

struct ScheduledConversation: Codable, Sendable {
    var contacts: ScheduledContact? = nil
}

/// NOT Equatable, deliberately. `@Default` is a property WRAPPER, and a
/// wrapper type is not itself Equatable — so synthesised conformance fails with
/// "does not conform to protocol", which only CI's iOS job can see. Nothing
/// compares these by value; `ScheduledMessage` is Identifiable, which is what
/// the lists actually need.
struct ScheduledContact: Codable, Sendable {
    var name: String? = nil
    @Default<DefaultEmptyString> var phone_e164: String
}

/// #237 — one appointment-reminder rule: how long before a job it goes, and
/// what it says.
struct ReminderRule: Codable, Sendable, Identifiable, Hashable {
    var id: String? = nil
    var offset_minutes: Int
    var body: String
    var enabled: Bool = true

    /// SwiftUI needs a stable identity for a row that has not been saved yet,
    /// and a new rule has no server id. The offset is unique within a
    /// workspace by construction — two rules at the same one would be the same
    /// reminder arriving twice — so it identifies a row for as long as one
    /// exists on screen.
    var rowId: Int { offset_minutes }
}

/// GET /v1/appointment-reminders.
struct ReminderRulesResponse: Codable, Sendable {
    var rules: [ReminderRule] = []
    /// What the workspace WOULD get. Offered, never applied.
    var suggested: [ReminderRule] = []
    var cap: Int = 2
}

/// PUT /v1/appointment-reminders — the whole set at once.
struct ReminderRulesBody: Codable, Sendable {
    let rules: [ReminderRule]
}

struct ReminderRulesSaved: Codable, Sendable {
    var rules: [ReminderRule] = []
}

/// GET /v1/scheduled-messages.
struct ScheduledMessagePage: Codable, Sendable {
    let scheduled_messages: [ScheduledMessage]
}

/// POST /v1/scheduled-messages, and PATCH of one.
struct ScheduledMessageEnvelope: Codable, Sendable {
    let scheduled_message: ScheduledMessage
}

struct ConversationEvent: Codable, Sendable {
    let id: String
    let conversation_id: String
    /// nil = system.
    let actor_user_id: String?
    let type: String
    let payload: JSONValue
    let created_at: String
}

struct ReadReceipt: Codable, Sendable {
    let conversation_id: String
    let user_id: String
    let last_read_at: String
}

/// POST /v1/conversations (compose) response.
struct ComposeResult: Codable, Sendable {
    let conversation: Conversation
    let message: Message
}

struct Template: Codable, Sendable {
    let id: String
    let name: String
    let body: String
    /// #274: the crew's own grouping. Free text and optional — a taxonomy we
    /// imposed would be ignored, and a category is worth typing at thirty
    /// templates and friction at five.
    var category: String?
    let created_by: String?
    /// #419: who last edited this shared copy.
    let updated_by: String?
    /// #419: that editor's display name, resolved SERVER-side (#191
    /// attribution) so the three clients cannot disagree. Null when the id
    /// resolves to nobody — a member who has left, or an edit predating the
    /// column — and the row then omits the attribution rather than guessing.
    let updated_by_name: String?
    let created_at: String
    let updated_at: String
}

/// GET /v1/attachments/:id/url — short-lived signed URL; never cache.
struct AttachmentUrl: Codable, Sendable {
    let url: String
    let expires_at: String
}

/// POST /v1/attachments/:id/report — #317. The response is the resulting state
/// rather than an ack, so a second report (a no-op, because two techs flagging
/// the same file is the normal case) still answers with the truth.
struct AttachmentReport: Codable, Sendable {
    let id: String
    let quarantined: Bool
}

/// A generic (note/task) attachment row (D19; upload door is notes-only).
struct Attachment: Codable, Sendable {
    let id: String
    let owner_type: String
    let owner_id: String
    let conversation_id: String?
    let file_name: String?
    let content_type: String?
    let size_bytes: Int?
    let created_at: String
}

/// One item from GET /v1/conversations/:id/attachments (gallery).
struct GalleryItem: Codable, Sendable {
    let id: String
    let source: String
    let kind: String
    let file_name: String?
    let content_type: String?
    let size_bytes: Int?
    let created_at: String
    let url: String
}

/// Outbound media item for compose/send (base64 inline, jpeg/png/gif ≤1MB).
struct OutboundMedia: Codable, Sendable {
    let content_type: String
    let base64: String
}

/// #275 — what POST /v1/conversations/bulk returns.
///
/// `previous` stays a raw `[String: JSONValue]` on purpose: the server decides
/// which field an action records, the client hands it straight back to build the
/// undo, and narrowing it here would mean this file changes every time an action is
/// added. `applied.count` is the only number that describes reality — `matched` can
/// be larger (the cap), and rows that could not be reached are in `failed`.
///
/// Decoded by hand rather than with the `@Default` wrappers: every field is
/// optional-with-a-fallback, so a response shaped slightly differently by a newer
/// Worker degrades to "nothing happened" instead of throwing inside an inbox.
struct BulkAppliedRow: Decodable, Sendable, Equatable {
    let id: String
    let previous: [String: JSONValue]

    init(id: String, previous: [String: JSONValue] = [:]) {
        self.id = id
        self.previous = previous
    }

    private enum CodingKeys: String, CodingKey { case id, previous }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        previous =
            try container.decodeIfPresent([String: JSONValue].self, forKey: .previous) ?? [:]
    }
}

struct BulkFailedRow: Decodable, Sendable, Equatable {
    let id: String
    let reason: String

    init(id: String, reason: String) {
        self.id = id
        self.reason = reason
    }

    private enum CodingKeys: String, CodingKey { case id, reason }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        reason = try container.decodeIfPresent(String.self, forKey: .reason) ?? "not_found"
    }
}

/// #478 — what POST /v1/tasks/bulk returns.
///
/// A typealias rather than a second struct: the shape is identical by design,
/// so one renderer reads both and `bulkResultMessage` takes either. Declaring
/// it separately would be a second place for the contract to drift.
typealias BulkTasksResult = BulkConversationsResult

struct BulkConversationsResult: Decodable, Sendable {
    let action: String
    let matched: Int
    let applied: [BulkAppliedRow]
    let failed: [BulkFailedRow]
    let capped: Bool

    init(
        action: String = "",
        matched: Int = 0,
        applied: [BulkAppliedRow] = [],
        failed: [BulkFailedRow] = [],
        capped: Bool = false
    ) {
        self.action = action
        self.matched = matched
        self.applied = applied
        self.failed = failed
        self.capped = capped
    }

    private enum CodingKeys: String, CodingKey {
        case action, matched, applied, failed, capped
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        action = try container.decodeIfPresent(String.self, forKey: .action) ?? ""
        matched = try container.decodeIfPresent(Int.self, forKey: .matched) ?? 0
        applied =
            try container.decodeIfPresent([BulkAppliedRow].self, forKey: .applied) ?? []
        failed = try container.decodeIfPresent([BulkFailedRow].self, forKey: .failed) ?? []
        capped = try container.decodeIfPresent(Bool.self, forKey: .capped) ?? false
    }
}
