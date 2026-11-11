import Foundation

/// #714: what one activity row says, and where it points. Pure, so every
/// surface (contact, job, thread, call) reads one event the same way and the
/// sentences are testable without a view. A port of
/// `apps/web/src/components/activity/activity-line.ts`; the words are
/// `activity.*` in the catalogue, copied from web's `activity.ts`.

/// The four records that have an activity timeline.
enum ActivityRecordType: Sendable {
    case contact
    case task
    case conversation
    case call

    /// A task's activity is at `/record-activity`: `/activity` is the #689 feed with comments.
    func path(_ recordId: String) -> String {
        switch self {
        case .contact: return "/v1/contacts/\(recordId)/activity"
        case .conversation: return "/v1/conversations/\(recordId)/activity"
        case .call: return "/v1/calls/\(recordId)/activity"
        case .task: return "/v1/tasks/\(recordId)/record-activity"
        }
    }
}

/// The server's filter, so paging stays right under it. Nil is All.
enum ActivityCategory: String, Sendable, CaseIterable {
    case message
    case call
    case change
}

/// The filter chips in order, each with the catalogue key that labels it.
struct ActivityFilterOption: Identifiable, Equatable, Sendable {
    let category: ActivityCategory?
    let labelKey: String
    var id: String { category?.rawValue ?? "all" }
}

let activityFilterOptions: [ActivityFilterOption] = [
    ActivityFilterOption(category: nil, labelKey: "activity.filterAll"),
    ActivityFilterOption(category: .message, labelKey: "activity.filterMessages"),
    ActivityFilterOption(category: .call, labelKey: "activity.filterCalls"),
    ActivityFilterOption(category: .change, labelKey: "activity.filterChanges"),
]

struct ActivityActor: Codable, Sendable, Equatable {
    /// member | customer | automation | system.
    let type: String
    var user_id: String? = nil
    var display_name: String? = nil
}

/// What the event came from, so the row can open it.
struct ActivitySource: Codable, Sendable, Equatable {
    let type: String
    let id: String
    var conversation_id: String? = nil
}

struct ActivityItem: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let kind: String
    let category: String
    let occurred_at: String
    let actor: ActivityActor
    let payload: [String: JSONValue]
    var source: ActivitySource? = nil
}

enum ActivityIcon: Sendable, Equatable {
    case text
    case call
    case voicemail
    case edit
    case tag
    case person
    case link
    case stop
    case check
    case merge
    case trash
    case mention
    case clock
}

/// Where a row goes when tapped.
enum ActivityOpen: Sendable, Equatable {
    case thread(conversationId: String, messageId: String?)
    case task(taskId: String)
    case contact(contactId: String)
}

struct ActivityLine: Sendable, Equatable {
    let text: String
    let icon: ActivityIcon
    /// Nil when nothing is there to open.
    let open: ActivityOpen?
}

private let activityValueMax = 80

private let activityTimeFields: Set<String> = ["due", "confirmation"]

/// The field edit keys the server sends, as catalogue keys.
private let activityFieldKeys: [String: String] = [
    "name": "activity.fieldName",
    "email": "activity.fieldEmail",
    "business_name": "activity.fieldBusiness",
    "address": "activity.fieldAddress",
    "notes": "activity.fieldNotes",
    "timezone": "activity.fieldTimezone",
    "locale": "activity.fieldLocale",
    "phone": "activity.fieldPhone",
    "custom_fields": "activity.fieldCustom",
    "other_phone": "activity.fieldOtherPhone",
    "other_address": "activity.fieldOtherAddress",
    "status": "activity.fieldStatus",
    "spam": "activity.fieldSpam",
    "title": "activity.fieldTitle",
    "description": "activity.fieldDescription",
    "due": "activity.fieldDue",
    "reminders": "activity.fieldReminders",
    "confirmation": "activity.fieldConfirmation",
    "priority": "activity.fieldPriority",
    "repeat": "activity.fieldRepeat",
    "link_added": "activity.fieldLink",
    "link_removed": "activity.fieldLink",
]

private func activitySay(_ locale: String?, _ key: String, _ vars: [String: String] = [:]) -> String {
    AppStrings.translate(locale, key, vars)
}

/// A non-blank string field, or nil.
private func activityText(_ payload: [String: JSONValue], _ key: String) -> String? {
    guard let value = payload[key]?.stringValue, !value.isBlank else { return nil }
    return value
}

/// A numeric field as whole seconds, or nil. Only a JSON number counts, as on web.
private func activitySeconds(_ payload: [String: JSONValue], _ key: String) -> Int? {
    guard case .number(let value)? = payload[key] else { return nil }
    guard value.isFinite else { return nil }
    return Int(exactly: value.rounded(.towardZero))
}

/// A set, non-empty value. False is present: "set spam to no" is a change.
private func activityPresent(_ value: JSONValue?) -> Bool {
    switch value {
    case .none, .some(.null):
        return false
    case .some(.string(let text)):
        return !text.isEmpty
    default:
        return true
    }
}

private func activityClip(_ text: String) -> String {
    let one = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    if one.count > activityValueMax {
        return String(one.prefix(activityValueMax - 1)) + "…"
    }
    return one
}

private func activityParts(_ values: [JSONValue]) -> String {
    var parts: [String] = []
    for value in values {
        if let text = value.stringValue, !text.isEmpty { parts.append(text) }
    }
    return parts.joined(separator: ", ")
}

private func activityNumberText(_ value: Double) -> String {
    if value == value.rounded(), abs(value) < 1e15 {
        return String(Int(value))
    }
    return String(value)
}

/// A before or after value, as a reader would say it.
func activityValue(_ field: String, _ value: JSONValue?, _ locale: String? = nil) -> String {
    guard activityPresent(value), let value else { return activitySay(locale, "activity.valueNone") }
    switch value {
    case .string(let text):
        if activityTimeFields.contains(field) {
            return TimestampFormat.label(text, style: .long, locale: locale)
        }
        return activityClip(text)
    case .bool(let flag):
        return activitySay(locale, flag ? "activity.valueYes" : "activity.valueNo")
    case .number(let number):
        return activityNumberText(number)
    case .object(let object):
        let ordered = object.keys.sorted().compactMap { object[$0] }
        return activityClip(activityParts(ordered))
    case .array(let items):
        return activityClip(activityParts(items))
    case .null:
        return activitySay(locale, "activity.valueNone")
    }
}

private func activityFieldLabel(_ field: String, _ locale: String?) -> String {
    guard let key = activityFieldKeys[field] else { return field }
    return activitySay(locale, key)
}

private func activityEditSentence(_ item: ActivityItem, _ locale: String?) -> String {
    let payload = item.payload
    let field = activityText(payload, "field") ?? ""
    let label = activityFieldLabel(field, locale)
    let from = payload["from"]
    let to = payload["to"]
    let toText = activityValue(field, to, locale)
    switch activityText(payload, "change") {
    case "added":
        return activitySay(locale, "activity.fieldAdded", ["field": label, "to": toText])
    case "updated":
        return activitySay(locale, "activity.fieldUpdated", ["field": label, "to": toText])
    case "removed":
        return activitySay(locale, "activity.fieldRemoved", ["field": label])
    default:
        break
    }
    let hasFrom = activityPresent(from)
    let hasTo = activityPresent(to)
    if hasFrom && hasTo {
        let fromText = activityValue(field, from, locale)
        return activitySay(
            locale, "activity.editedFromTo",
            ["field": label, "from": fromText, "to": toText]
        )
    }
    if hasTo {
        return activitySay(locale, "activity.editedTo", ["field": label, "to": toText])
    }
    if hasFrom {
        let fromText = activityValue(field, from, locale)
        return activitySay(locale, "activity.editedCleared", ["field": label, "from": fromText])
    }
    return activitySay(locale, "activity.editedBare", ["field": label])
}

private func activityCallSentence(_ item: ActivityItem, _ locale: String?) -> String {
    let payload = item.payload
    let directionKey = activityText(payload, "direction") == "outbound"
        ? "activity.callOutgoing"
        : "activity.callIncoming"
    let outcomeKey: String
    switch activityText(payload, "outcome") {
    case "answered": outcomeKey = "activity.outcomeAnswered"
    case "voicemail": outcomeKey = "activity.outcomeVoicemail"
    default: outcomeKey = "activity.outcomeMissed"
    }
    var parts: [String] = [
        activitySay(
            locale, "activity.callLine",
            ["direction": activitySay(locale, directionKey), "outcome": activitySay(locale, outcomeKey)]
        ),
    ]
    let talked = activitySeconds(payload, "talk_seconds") ?? 0
    if talked > 0 {
        parts.append(activitySay(locale, "activity.callTalked", ["duration": formatCallDuration(talked)]))
    }
    if let why = callEndReason(activityText(payload, "ended_reason"), locale) {
        parts.append(why)
    }
    return parts.joined(separator: " · ")
}

private func activityWithWhy(_ text: String, _ why: String?) -> String {
    guard let why else { return text }
    return "\(text) · \(why)"
}

/// #725: a step on a call's own timeline, or nil when the kind is not one.
private func activityCallStepSentence(
    _ item: ActivityItem,
    _ locale: String?,
    _ person: (JSONValue) -> String
) -> String? {
    let payload = item.payload
    switch item.kind {
    case "call_arrived":
        return activityWithWhy(
            activitySay(locale, "activity.stepArrived"),
            callRoutingReason(activityText(payload, "routing"), locale)
        )
    case "call_placed":
        return activitySay(locale, "activity.stepPlaced")
    case "call_rang":
        let ids = payload["user_ids"]?.arrayValue ?? []
        let names = ids.map(person).joined(separator: ", ")
        let key = payload["asked"]?.boolValue == true
            ? "activity.stepAskedToRing"
            : "activity.stepRang"
        return activitySay(locale, key, ["names": names])
    case "call_declined":
        return activitySay(locale, "activity.stepDeclined")
    case "call_answered":
        return activitySay(locale, "activity.stepAnswered")
    case "call_voicemail":
        // Why it went to voicemail: a machine reason, or else the arrival route.
        let cause = activityText(payload, "cause")
        let why = callEndReason(cause, locale) ?? callRoutingReason(cause, locale)
        return activityWithWhy(activitySay(locale, "activity.stepVoicemail"), why)
    case "call_ended":
        let seconds = activitySeconds(payload, "seconds") ?? 0
        var parts: [String] = [activitySay(locale, "activity.stepEnded")]
        if seconds > 0 {
            parts.append(activitySay(locale, "activity.stepLasted", ["duration": formatCallDuration(seconds)]))
        }
        if let why = callEndReason(activityText(payload, "reason"), locale) {
            parts.append(why)
        }
        return parts.joined(separator: " · ")
    default:
        return nil
    }
}

private func activityOptOutSentence(_ item: ActivityItem, _ locale: String?) -> String {
    let key: String
    switch activityText(item.payload, "source") {
    case "stop_keyword": key = "activity.optedOutStop"
    case "manual": key = "activity.optedOutManual"
    case "carrier": key = "activity.optedOutCarrier"
    case "import": key = "activity.optedOutImport"
    default: key = "activity.optedOut"
    }
    return activitySay(locale, key)
}

/// Where a row's source lives, or nil.
func activityOpen(
    _ item: ActivityItem,
    recordType: ActivityRecordType,
    recordId: String
) -> ActivityOpen? {
    guard let source = item.source else { return nil }
    switch source.type {
    case "message":
        guard let conversationId = source.conversation_id else { return nil }
        return .thread(conversationId: conversationId, messageId: source.id)
    case "call", "conversation_event", "scheduled_message":
        guard let conversationId = source.conversation_id else { return nil }
        return .thread(conversationId: conversationId, messageId: nil)
    case "task":
        if source.id == recordId && recordType == .task { return nil }
        return .task(taskId: source.id)
    case "contact":
        if source.id == recordId { return nil }
        return .contact(contactId: source.id)
    default:
        return nil
    }
}

private func activityReferencedKey(_ item: ActivityItem) -> String {
    switch item.source?.type {
    case "message": return "activity.referencedNote"
    case "task": return "activity.referencedTask"
    case "task_comment": return "activity.referencedComment"
    default: return "activity.referenced"
    }
}

/// `nameOf` resolves a member's user id to a display name, or nil when the
/// member has left or is not loaded.
func activityLine(
    _ item: ActivityItem,
    recordType: ActivityRecordType,
    recordId: String,
    nameOf: (String?) -> String?,
    locale: String? = nil
) -> ActivityLine {
    let open = activityOpen(item, recordType: recordType, recordId: recordId)
    let someone = activitySay(locale, "activity.someone")
    let payload = item.payload
    let title = activityText(payload, "title")

    func person(_ id: JSONValue) -> String {
        guard let userId = id.stringValue else { return someone }
        return nameOf(userId) ?? someone
    }
    func personAt(_ key: String) -> String {
        guard let id = payload[key] else { return someone }
        return person(id)
    }
    func line(_ text: String, _ icon: ActivityIcon) -> ActivityLine {
        ActivityLine(text: text, icon: icon, open: open)
    }

    switch item.kind {
    case "text_in":
        return line(activitySay(locale, "activity.textIn"), .text)
    case "text_out":
        return line(activityTextOutSentence(payload, locale), .text)
    case "scheduled_queued":
        return line(activitySay(locale, "activity.scheduledQueued"), .clock)
    case "scheduled_sent":
        return line(activitySay(locale, "activity.scheduledSent"), .clock)
    case "scheduled_cancelled":
        return line(activitySay(locale, "activity.scheduledCancelled"), .clock)
    case "call":
        return line(activityCallSentence(item, locale), .call)
    case "call_arrived", "call_placed", "call_rang", "call_declined", "call_answered", "call_ended":
        let sentence = activityCallStepSentence(item, locale, person)
        return line(sentence ?? activitySay(locale, "activity.unknownKind"), .call)
    case "call_voicemail":
        let sentence = activityCallStepSentence(item, locale, person)
        return line(sentence ?? activitySay(locale, "activity.unknownKind"), .voicemail)
    case "voicemail":
        let seconds = activitySeconds(payload, "voicemail_seconds") ?? 0
        if seconds > 0 {
            let left = activitySay(locale, "activity.voicemailLeftFor", ["duration": formatCallDuration(seconds)])
            return line(left, .voicemail)
        }
        return line(activitySay(locale, "activity.voicemailLeft"), .voicemail)
    case "created":
        if let title {
            return line(activitySay(locale, "activity.createdNamed", ["title": title]), .check)
        }
        return line(activitySay(locale, "activity.created"), .check)
    case "edited":
        return line(activityEditSentence(item, locale), .edit)
    case "tagged":
        return line(activitySay(locale, "activity.tagged", ["name": activityText(payload, "name") ?? ""]), .tag)
    case "untagged":
        return line(activitySay(locale, "activity.untagged", ["name": activityText(payload, "name") ?? ""]), .tag)
    case "merged":
        let key = activityText(payload, "role") == "merged_away"
            ? "activity.mergedAway"
            : "activity.mergedSurvivor"
        let other = activityText(payload, "other_name") ?? someone
        return line(activitySay(locale, key, ["name": other]), .merge)
    case "unmerged":
        return line(activitySay(locale, "activity.unmerged"), .merge)
    case "deleted":
        return line(activitySay(locale, "activity.deleted"), .trash)
    case "restored":
        return line(activitySay(locale, "activity.restored"), .trash)
    case "assigned":
        return line(activitySay(locale, "activity.assignedTo", ["name": personAt("to_user_id")]), .person)
    case "unassigned":
        if activityPresent(payload["from_user_id"]) {
            return line(activitySay(locale, "activity.unassignedFrom", ["name": personAt("from_user_id")]), .person)
        }
        return line(activitySay(locale, "activity.unassigned"), .person)
    case "mentioned":
        return line(activitySay(locale, "activity.mentioned", ["name": personAt("user_id")]), .mention)
    case "referenced":
        return line(activitySay(locale, activityReferencedKey(item)), .link)
    case "opted_out":
        return line(activityOptOutSentence(item, locale), .stop)
    case "opted_in":
        return line(activitySay(locale, "activity.optedIn"), .stop)
    case "blocked":
        return line(activitySay(locale, "activity.blocked"), .stop)
    case "unblocked":
        return line(activitySay(locale, "activity.unblocked"), .stop)
    case "task_created":
        if let title {
            return line(activitySay(locale, "activity.taskCreated", ["title": title]), .check)
        }
        return line(activitySay(locale, "activity.taskCreatedBare"), .check)
    case "task_completed":
        if let title {
            return line(activitySay(locale, "activity.taskCompleted", ["title": title]), .check)
        }
        return line(activitySay(locale, "activity.taskCompletedBare"), .check)
    case "completed":
        return line(activitySay(locale, "activity.completed"), .check)
    case "reopened":
        return line(activitySay(locale, "activity.reopened"), .check)
    default:
        return line(activitySay(locale, "activity.unknownKind"), .edit)
    }
}

/// "Text sent", or "Text sent automatically · Missed-call text" (#725).
private func activityTextOutSentence(_ payload: [String: JSONValue], _ locale: String?) -> String {
    guard payload["automated"]?.boolValue == true else {
        return activitySay(locale, "activity.textOut")
    }
    let sent = activitySay(locale, "activity.textOutAutomated")
    guard let which = messageAutomationName(activityText(payload, "automation"), locale) else {
        return sent
    }
    return "\(sent) · \(which)"
}

/// Who did it: a member by name, or the customer, an automation, or Loonext itself.
func activityActor(
    _ item: ActivityItem,
    nameOf: (String?) -> String?,
    locale: String? = nil
) -> String {
    switch item.actor.type {
    case "member":
        if let name = item.actor.display_name, !name.isBlank { return name }
        return nameOf(item.actor.user_id) ?? activitySay(locale, "activity.actorTeammate")
    case "customer":
        return activitySay(locale, "activity.actorCustomer")
    case "automation":
        return activitySay(locale, "activity.actorAutomation")
    default:
        return activitySay(locale, "activity.actorSystem")
    }
}

/// One local calendar day of the timeline.
struct ActivityDayGroup: Identifiable, Equatable {
    /// YYYY-MM-DD in LOCAL time.
    let id: String
    let label: String
    let items: [ActivityItem]
}

/// Day groups in the order given, keyed by the LOCAL date: an evening call in
/// Vancouver falls on the next UTC day, and the crew remembers the day it was.
func groupActivityByDay(
    _ items: [ActivityItem],
    calendar: Calendar = .current,
    locale: String = MessageLocale.en
) -> [ActivityDayGroup] {
    var groups: [ActivityDayGroup] = []
    for item in items {
        guard let date = parseWireTimestamp(item.occurred_at) else { continue }
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        let key = String(
            format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0
        )
        if let last = groups.last, last.id == key {
            groups[groups.count - 1] = ActivityDayGroup(
                id: last.id, label: last.label, items: last.items + [item]
            )
        } else {
            // "November 10, 2026" / "10 novembre 2026": a calendar day, never a time.
            let label = timelineShortDate(date, calendar: calendar, template: "yMMMMd", locale: locale)
            groups.append(ActivityDayGroup(id: key, label: label, items: [item]))
        }
    }
    return groups
}
