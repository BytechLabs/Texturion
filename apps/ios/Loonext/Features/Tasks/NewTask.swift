import SwiftUI

/// #689: "New task", a task with no text or call behind it. The same sheet a
/// message uses, with a blank title and everything but the title under More.
///
/// `conversationId` links the task to a conversation (which fixes its contact);
/// otherwise `contactId` links it to a contact. Both are optional.
@MainActor
final class NewTaskHost: TaskDraftHost {
    let members: [Member]
    let meUserId: String
    private let graph: AppGraph
    private let companyId: String
    private let locale: String
    /// The sentence, and (#724) the created task's id when Open should go to it.
    private let onNotice: @MainActor (String, String?) -> Void
    private let onCreated: @MainActor () -> Void

    init(
        graph: AppGraph,
        companyId: String,
        members: [Member],
        meUserId: String,
        locale: String,
        onNotice: @escaping @MainActor (String, String?) -> Void,
        onCreated: @escaping @MainActor () -> Void
    ) {
        self.graph = graph
        self.companyId = companyId
        self.members = members
        self.meUserId = meUserId
        self.locale = locale
        self.onNotice = onNotice
        self.onCreated = onCreated
    }

    // There is no text to read, so nothing is enriched and nothing reported.
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
        createTask(
            from: source,
            title: title,
            assignedUserId: assignedUserId,
            dueAt: dueAt,
            address: address,
            provenance: provenance,
            meta: TaskDraftMeta()
        )
    }

    func workspaceTagsForTaskDraft() async -> [Tag] {
        let page = try? await TaskMutations(api: graph.api).tags(companyId: companyId)
        return page?.data ?? []
    }

    func customers(matching search: String) async throws -> [Contact] {
        try await ContactsApi(api: graph.api).contacts(companyId: companyId, q: search, limit: 12).data
    }

    func thread(for customer: Contact) async -> String? {
        await findBookingConversation(graph: graph, companyId: companyId, contact: customer)
    }

    func createTask(
        from source: TaskDraftSource,
        title: String,
        assignedUserId: String?,
        dueAt: String?,
        address: AddressFieldValues,
        provenance: String,
        meta: TaskDraftMeta
    ) {
        guard case .standalone(let existingThread, let contactId) = source else { return }
        let addressBody = taskAddressBody(address, provenance: provenance)
        let repeatBody = meta.repeatBody()
        let mutations = TaskMutations(api: graph.api)
        Task { [companyId, locale, onNotice, onCreated] in
            do {
                var conversationId = existingThread
                if conversationId == nil, let contactId,
                   let customer: Contact = try? await graph.api.get("/v1/contacts/\(contactId)", companyId: companyId) {
                    conversationId = await findBookingConversation(graph: graph, companyId: companyId, contact: customer)
                }
                let row = try await mutations.createStandalone(
                    companyId: companyId,
                    title: title,
                    assignedUserId: assignedUserId,
                    dueAt: dueAt,
                    address: addressBody,
                    conversationId: conversationId,
                    contactId: contactId,
                    priority: meta.priorityWire,
                    labelIds: meta.labelIds,
                    repeatRule: repeatBody,
                    assigneeIds: meta.assigneeIds,
                    dueOn: meta.dueOn
                )
                // A label typed by name is made once the task exists. The task
                // is already saved, so a failure here is said, not undone.
                var labelFailed = false
                for name in meta.newLabelNames {
                    do {
                        _ = try await mutations.addTag(
                            companyId: companyId, taskId: row.id, tagId: nil, name: name
                        )
                    } catch {
                        labelFailed = true
                    }
                }
                onCreated()
                onNotice(
                    AppStrings.translate(
                        locale,
                        labelFailed
                            ? "contactsTasks.taskCreatedLabelFailed"
                            : "thread.taskCreatedStandalone"
                    ),
                    row.id
                )
            } catch {
                onNotice(error.userMessage, nil)
            }
        }
    }
}

func findBookingConversation(graph: AppGraph, companyId: String, contact: Contact) async -> String? {
    let threads = try? await InboxApi(api: graph.api).conversations(
        companyId: companyId, snoozed: "all", q: contact.phone_e164
    )
    return threads?.data.first { $0.contact_id == contact.id && !$0.is_spam }?.id
}

struct BookingCustomerPicker: View {
    let load: (String) async throws -> [Contact]
    let onPick: (Contact?) -> Void
    @State private var search = ""
    @State private var matches: [Contact] = []
    @Environment(\.appLocale) private var appLocale
    @Environment(\.dismiss) private var dismiss

    private var options: [PickerOption<String?>] {
        let remove = PickerOption<String?>(nil, title: AppStrings.translate(appLocale, "contactsTasks.removeCustomer"))
        let customers = matches.map { PickerOption<String?>($0.id, title: $0.name ?? $0.phone_e164) }
        return [remove] + customers
    }

    var body: some View {
        SearchablePickerSheet(
            options: options,
            selected: nil,
            title: AppStrings.translate(appLocale, "contactsTasks.pickCustomer"),
            searchPrompt: AppStrings.translate(appLocale, "contactsTasks.searchCustomers"),
            onPick: choose,
            onDismiss: { dismiss() },
            search: $search
        )
        .task(id: search) {
            let found = try? await load(search)
            if !Task.isCancelled { matches = found ?? [] }
        }
    }

    private func choose(_ customerId: String?) {
        let customer = matches.first { $0.id == customerId }
        guard customerId == nil || customer != nil else { return }
        onPick(customer)
        dismiss()
    }
}

/// Loads who can be assigned, then shows the sheet.
private struct NewTaskSheetContent: View {
    let graph: AppGraph
    let companyId: String
    let conversationId: String?
    let contactId: String?
    let contactName: String
    let onNotice: @MainActor (String, String?) -> Void
    let onCreated: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void
    var initialDueOn: String?
    var initialAddress: String?

    @State private var host: NewTaskHost?
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Group {
            if let host {
                MakeTaskSheet(
                    controller: host,
                    source: .standalone(conversationId: conversationId, contactId: contactId),
                    contactName: contactName,
                    locale: appLocale,
                    onDismiss: onDismiss,
                    initialDueOn: initialDueOn,
                    initialAddress: initialAddress
                )
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            let page = try? await TaskMutations(api: graph.api).members(companyId: companyId)
            guard let me = try? await graph.meApi.me(companyId: companyId) else {
                onDismiss()
                return
            }
            host = NewTaskHost(
                graph: graph,
                companyId: companyId,
                members: page?.data ?? [],
                meUserId: me.user_id,
                locale: appLocale,
                onNotice: onNotice,
                onCreated: onCreated
            )
        }
    }
}

private struct NewTaskSheetModifier: ViewModifier {
    @Binding var isPresented: Bool
    let graph: AppGraph
    let companyId: String
    let conversationId: String?
    let contactId: String?
    let contactName: String
    let onCreated: @MainActor () -> Void
    var initialDueOn: String?
    var initialAddress: String?

    @State private var notice: String?
    /// #724: set when the confirmation can open the task it names.
    @State private var noticeTaskId: String?
    @Environment(\.appLocale) private var appLocale

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $isPresented) {
                NewTaskSheetContent(
                    graph: graph,
                    companyId: companyId,
                    conversationId: conversationId,
                    contactId: contactId,
                    contactName: contactName,
                    onNotice: { text, taskId in
                        notice = text
                        noticeTaskId = taskId
                    },
                    onCreated: onCreated,
                    onDismiss: { isPresented = false },
                    initialDueOn: initialDueOn,
                    initialAddress: initialAddress
                )
            }
            .createdAlert(notice: $notice, openTaskId: $noticeTaskId)
    }
}

extension View {
    /// The New task sheet, presented from the Tasks tab, a contact or a conversation.
    func newTaskSheet(
        isPresented: Binding<Bool>,
        graph: AppGraph,
        companyId: String,
        conversationId: String? = nil,
        contactId: String? = nil,
        contactName: String = "",
        onCreated: @escaping @MainActor () -> Void = {},
        initialDueOn: String? = nil,
        initialAddress: String? = nil
    ) -> some View {
        modifier(
            NewTaskSheetModifier(
                isPresented: isPresented,
                graph: graph,
                companyId: companyId,
                conversationId: conversationId,
                contactId: contactId,
                contactName: contactName,
                onCreated: onCreated,
                initialDueOn: initialDueOn,
                initialAddress: initialAddress
            )
        )
    }
}
