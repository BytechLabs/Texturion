import SwiftUI

// D64: an answered call can become a task. The pure parts are free functions so
// they unit-test without a view; the views below are thin.

// MARK: - Pure helpers

/// What a task promotes: a message, an answered call, or nothing (#689, a
/// standalone task that may link to a conversation or a contact).
enum TaskDraftSource {
    case message(Message)
    case call(id: String, callerName: String)
    case standalone(conversationId: String?, contactId: String?)

    var isStandalone: Bool {
        if case .standalone = self { return true }
        return false
    }

    /// #693: a standalone task opened from a contact or a conversation. Such a
    /// job usually comes back some time after it is done, so a repeat defaults
    /// to "after it's done".
    var isLinkedToCustomer: Bool {
        if case .standalone(let conversationId, let contactId) = self {
            return conversationId != nil || contactId != nil
        }
        return false
    }

    var message: Message? {
        if case .message(let message) = self { return message }
        return nil
    }
}

/// What the make-task sheet needs from whoever opens it: a thread, or the call
/// log (D64). The sheet used to take the thread controller directly.
@MainActor
protocol TaskDraftHost: AnyObject {
    var members: [Member] { get }
    var meUserId: String { get }
    func aiSettingsForTaskDraft() async -> CompanyAiSettings
    func enrichTaskDraft(for message: Message) async -> TaskEnrichment
    func reportAiOutcome(feature: String, outcome: String)
    func createTask(
        from source: TaskDraftSource,
        title: String,
        assignedUserId: String?,
        dueAt: String?,
        address: AddressFieldValues,
        provenance: String
    )
    /// #693: the same create with priority, labels and a repeat. Only the New
    /// task host acts on `meta`; the message and call hosts take the default
    /// below, which drops it, because their sheets never show those rows.
    func createTask(
        from source: TaskDraftSource,
        title: String,
        assignedUserId: String?,
        dueAt: String?,
        address: AddressFieldValues,
        provenance: String,
        meta: TaskDraftMeta
    )
    /// #693: the workspace tags the label picker offers.
    func workspaceTagsForTaskDraft() async -> [Tag]
}

extension TaskDraftHost {
    func createTask(
        from source: TaskDraftSource,
        title: String,
        assignedUserId: String?,
        dueAt: String?,
        address: AddressFieldValues,
        provenance: String,
        meta: TaskDraftMeta
    ) {
        createTask(
            from: source,
            title: title,
            assignedUserId: assignedUserId,
            dueAt: dueAt,
            address: address,
            provenance: provenance
        )
    }

    func workspaceTagsForTaskDraft() async -> [Tag] { [] }
}

extension ThreadController: TaskDraftHost {
    func createTask(
        from source: TaskDraftSource,
        title: String,
        assignedUserId: String?,
        dueAt: String?,
        address: AddressFieldValues,
        provenance: String
    ) {
        // A thread promotes its messages here; a call is promoted through
        // `CallTaskHost`, which the call line's own button opens.
        guard case .message(let message) = source else { return }
        makeTask(
            message,
            title: title,
            assignedUserId: assignedUserId,
            dueAt: dueAt,
            address: address,
            provenance: provenance
        )
    }
}

/// Who rang, for a task promoted from a call: name, else number, else unknown.
func taskCallerName(_ call: TaskSourceCall, locale: String?) -> String {
    if let name = call.caller_name, !name.isBlank { return name }
    if let number = call.caller_e164, !number.isBlank { return formatPhone(number) }
    return AppStrings.translate(locale, "contactsTasks.callUnknownCaller")
}

/// The carrier session id of a timeline line that narrates an ANSWERED call,
/// else nil. A voicemail or transfer line carries a `kind`, and an outbound or
/// missed call is not one a task can come from: the server refuses anything but
/// an answered call. Mirrors the web's system-line.tsx.
func answeredCallSessionId(of event: ConversationEvent) -> String? {
    guard event.type == "call_completed" else { return nil }
    guard event.payload["outcome"]?.stringValue == "answered" else { return nil }
    guard event.payload["kind"] == nil else { return nil }
    guard let session = event.payload["call_session_id"]?.stringValue, !session.isBlank
    else { return nil }
    return session
}

/// The caller named on a timeline call line, for the seeded title.
func callLineCaller(of event: ConversationEvent, locale: String?) -> String {
    if let caller = event.payload["caller"]?.stringValue, !caller.isBlank { return caller }
    return AppStrings.translate(locale, "contactsTasks.callUnknownCaller")
}

/// "3h · Talked for 4m 32s": when it was, and how long they spoke.
func taskCallMeta(_ call: TaskSourceCall, locale: String?) -> String {
    let when = relativeTime(call.started_at)
    guard call.forward_seconds > 0 else { return when }
    let talk = AppStrings.translate(
        locale,
        "contactsTasks.callTalkTime",
        ["duration": formatCallDuration(call.forward_seconds)]
    )
    return "\(when) · \(talk)"
}

// MARK: - Promoting a call

/// GET /v1/calls/:sessionId, read only for the call's own id.
private struct CallIdRef: Decodable, Sendable {
    let id: String
}

/// The make-task sheet's host when the source is a call: no thread is open, so
/// it carries what the sheet reads and does the create itself.
@MainActor
final class CallTaskHost: TaskDraftHost {
    let members: [Member]
    let meUserId: String
    private let graph: AppGraph
    private let companyId: String
    /// The sentence, and (#724) the created task's id when Open should go to it.
    private let onNotice: @MainActor (String, String?) -> Void
    private let locale: String

    init(
        graph: AppGraph,
        companyId: String,
        members: [Member],
        meUserId: String,
        locale: String,
        onNotice: @escaping @MainActor (String, String?) -> Void
    ) {
        self.graph = graph
        self.companyId = companyId
        self.members = members
        self.meUserId = meUserId
        self.locale = locale
        self.onNotice = onNotice
    }

    // A call has no text to read, so nothing is enriched and nothing reported.
    func aiSettingsForTaskDraft() async -> CompanyAiSettings {
        CompanyAiSettings(enrich_task_address: false, enrich_task_due: false)
    }

    func enrichTaskDraft(for message: Message) async -> TaskEnrichment { TaskEnrichment.empty }

    func reportAiOutcome(feature: String, outcome: String) {}

    func createTask(
        from source: TaskDraftSource,
        title: String,
        assignedUserId: String?,
        dueAt: String?,
        address: AddressFieldValues,
        provenance: String
    ) {
        guard case .call(let callId, _) = source else { return }
        let addressBody = taskAddressBody(address, provenance: provenance)
        let mutations = TaskMutations(api: graph.api)
        Task { [companyId, locale, onNotice] in
            do {
                let row = try await mutations.createFromCall(
                    companyId: companyId,
                    callId: callId,
                    title: title,
                    assignedUserId: assignedUserId,
                    dueAt: dueAt,
                    address: addressBody
                )
                onNotice(AppStrings.translate(locale, "thread.taskCreatedFromCall"), row.id)
            } catch {
                if (error as? ApiError)?.code == ApiErrorCode.conflict {
                    onNotice(AppStrings.translate(locale, "thread.alreadyHasCallTask"), nil)
                } else {
                    onNotice(error.userMessage, nil)
                }
            }
        }
    }
}

/// "Make a task" on an answered call: one quiet icon that opens the same sheet a
/// message uses, seeded "Call from {name}". The caller renders it only for an
/// answered call that landed in a conversation.
///
/// The call log knows the call's id (`callId`). The thread's call line carries
/// only the carrier session id (`sessionId`), so the id is read when the button
/// is tapped, not once per line in a long thread.
struct CallTaskButton: View {
    let graph: AppGraph
    let companyId: String
    let conversationId: String
    let callerName: String
    var callId: String?
    var sessionId: String?

    @State private var host: CallTaskHost?
    @State private var resolvedCallId: String?
    @State private var sheetOpen = false
    @State private var loading = false
    @State private var notice: String?
    /// #724: set when the confirmation can open the task it names.
    @State private var noticeTaskId: String?
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Button(action: open) {
            Group {
                if loading {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "text.badge.plus")
                        .font(.scaled(14, weight: .medium))
                        .foregroundStyle(BrandColor.muted500)
                }
            }
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .accessibilityLabel(AppStrings.translate(appLocale, "thread.makeTaskFromCall"))
        .sheet(isPresented: $sheetOpen) {
            if let host, let resolvedCallId {
                MakeTaskSheet(
                    controller: host,
                    source: .call(id: resolvedCallId, callerName: callerName),
                    contactName: callerName,
                    locale: appLocale,
                    onDismiss: { sheetOpen = false }
                )
            }
        }
        .alert(
            notice ?? "",
            isPresented: Binding(
                get: { notice != nil },
                set: { if !$0 { notice = nil } }
            )
        ) {
            if let taskId = noticeTaskId {
                Button(AppStrings.translate(appLocale, "common.open")) {
                    notice = nil
                    noticeTaskId = nil
                    AppRouter.shared.openTaskId = taskId
                }
            }
            Button(AppStrings.translate(appLocale, "common.close"), role: .cancel) {
                notice = nil
                noticeTaskId = nil
            }
        }
    }

    private func open() {
        loading = true
        Task {
            defer { loading = false }
            do {
                let id: String
                if let callId {
                    id = callId
                } else if let sessionId {
                    let escaped = sessionId.addingPercentEncoding(
                        withAllowedCharacters: .urlPathAllowed
                    ) ?? sessionId
                    let ref: CallIdRef = try await graph.api.get(
                        "/v1/calls/\(escaped)", companyId: companyId
                    )
                    id = ref.id
                } else {
                    return
                }
                let page = try? await CallsService(api: graph.api).members(companyId: companyId)
                let me = try await graph.meApi.me(companyId: companyId)
                host = CallTaskHost(
                    graph: graph,
                    companyId: companyId,
                    members: page?.data ?? [],
                    meUserId: me.user_id,
                    locale: appLocale,
                    onNotice: { text, taskId in
                        notice = text
                        noticeTaskId = taskId
                    }
                )
                resolvedCallId = id
                sheetOpen = true
            } catch {
                notice = error.userMessage
                noticeTaskId = nil
            }
        }
    }
}

// MARK: - A call as a task's source

/// The paper card naming the call a task was promoted from (D64), where a
/// message's quote would be: who rang, when, for how long, voicemail or not.
struct TaskSourceCallCard: View {
    let call: TaskSourceCall
    let onOpenConversation: (@MainActor () -> Void)?
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(label: AppStrings.translate(appLocale, "contactsTasks.fromThisCall"))
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(BrandColor.lime)
                    .frame(width: 3)
                VStack(alignment: .leading, spacing: 4) {
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "contactsTasks.callFrom",
                            ["name": taskCallerName(call, locale: appLocale)]
                        )
                    )
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    Text(taskCallMeta(call, locale: appLocale))
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted500)
                    if call.has_voicemail {
                        Label(
                            AppStrings.translate(appLocale, "contactsTasks.callVoicemailLeft"),
                            systemImage: "recordingtape"
                        )
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted500)
                    }
                    if let onOpenConversation {
                        Button(
                            AppStrings.translate(appLocale, "contactsTasks.viewInConversation")
                        ) {
                            onOpenConversation()
                        }
                        .font(.golos(11, weight: .bold))
                        .foregroundStyle(BrandColor.olive)
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                BrandColor.paper,
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
        }
    }
}
