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
    private let onNotice: @MainActor (String) -> Void
    private let onCreated: @MainActor () -> Void

    init(
        graph: AppGraph,
        companyId: String,
        members: [Member],
        meUserId: String,
        locale: String,
        onNotice: @escaping @MainActor (String) -> Void,
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
        guard case .standalone(let conversationId, let contactId) = source else { return }
        let addressBody = taskAddressBody(address, provenance: provenance)
        let mutations = TaskMutations(api: graph.api)
        Task { [companyId, locale, onNotice, onCreated] in
            do {
                _ = try await mutations.createStandalone(
                    companyId: companyId,
                    title: title,
                    assignedUserId: assignedUserId,
                    dueAt: dueAt,
                    address: addressBody,
                    conversationId: conversationId,
                    contactId: contactId
                )
                onCreated()
                onNotice(AppStrings.translate(locale, "thread.taskCreatedStandalone"))
            } catch {
                onNotice(error.userMessage)
            }
        }
    }
}

/// Loads who can be assigned, then shows the sheet.
private struct NewTaskSheetContent: View {
    let graph: AppGraph
    let companyId: String
    let conversationId: String?
    let contactId: String?
    let contactName: String
    let onNotice: @MainActor (String) -> Void
    let onCreated: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

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
                    onDismiss: onDismiss
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

    @State private var notice: String?
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
                    onNotice: { notice = $0 },
                    onCreated: onCreated,
                    onDismiss: { isPresented = false }
                )
            }
            .alert(
                notice ?? "",
                isPresented: Binding(
                    get: { notice != nil },
                    set: { if !$0 { notice = nil } }
                )
            ) {
                Button(AppStrings.translate(appLocale, "common.close")) { notice = nil }
            }
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
        onCreated: @escaping @MainActor () -> Void = {}
    ) -> some View {
        modifier(
            NewTaskSheetModifier(
                isPresented: isPresented,
                graph: graph,
                companyId: companyId,
                conversationId: conversationId,
                contactId: contactId,
                contactName: contactName,
                onCreated: onCreated
            )
        )
    }
}
