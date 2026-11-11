import SwiftUI

/// #734: a call's own page, where a call row's Details action lands. Reads top
/// to bottom, like the web's call page: who called, what happened, the words,
/// then the facts, including why no phone rang (#721) and how it ended (#725).
///
/// Applying: Prioritize Intent. The words come first, because someone here is
/// usually here to read them.
@MainActor
struct CallDetailView: View {
    let graph: AppGraph
    let companyId: String
    let sessionId: String
    var onOpenConversation: (String) -> Void = { _ in }
    var onOpenContact: (String) -> Void = { _ in }

    @State private var state: LoadState<Call> = .loading
    @State private var refreshKey = 0

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String { AppStrings.translate(appLocale, key) }

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(BrandColor.canvas)
            .navigationTitle(t("shell.callActionDetails"))
            .navigationBarTitleDisplayMode(.inline)
            .task(id: "\(companyId)|\(sessionId)|\(refreshKey)") { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            CenteredLoading()
        case .failed(let message):
            LoadError(message: message) { refreshKey += 1 }
        case .ready(let call):
            detail(call)
        }
    }

    private func load() async {
        let service = CallsService(api: graph.api)
        do {
            state = .ready(try await service.call(companyId: companyId, sessionId: sessionId))
        } catch {
            if case .ready = state {
                // Keep what is on screen on a quiet refetch failure.
            } else {
                state = .failed(error.userMessage)
            }
        }
    }

    private func detail(_ call: Call) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header(call)
                wordsCard(call)
                factsCard(call)
                activitySection(call)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 32)
        }
    }

    private func header(_ call: Call) -> some View {
        let when = TimestampFormat.exact(call.started_at, locale: appLocale)
        return RecordHeader(
            showsActions: call.conversation_id != nil || call.contact_id != nil
        ) {
            EmptyView()
        } content: {
            ScreenTitle(text: callerDisplayName(call))
            Text(t(callOutcomeLineKey(call)) + " · " + when)
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted500)
        } trailing: {
            EmptyView()
        } actions: {
            onward(call)
        }
    }

    @ViewBuilder
    private func onward(_ call: Call) -> some View {
        if let id = call.conversation_id {
            onwardButton(t("shell.openConversation")) { onOpenConversation(id) }
        }
        if let id = call.contact_id {
            onwardButton(t("shell.viewContact")) { onOpenContact(id) }
        }
    }

    private func onwardButton(_ label: String, action: @escaping @MainActor () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Text(label)
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .background(BrandColor.paper, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func wordsCard(_ call: Call) -> some View {
        let transcript = callTranscriptState(call)
        return PaperCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(t("shell.voicemail"))
                    .font(.golos(13, weight: .bold))
                    .foregroundStyle(BrandColor.ink)
                if transcript.muted, let key = transcript.key {
                    Text(t(key))
                        .font(.golos(13.5))
                        .foregroundStyle(BrandColor.muted500)
                } else if let words = transcript.text {
                    VoicemailTranscript(text: words)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if call.has_voicemail == true {
                    VoicemailPlayerRow(
                        service: CallsService(api: graph.api),
                        companyId: companyId,
                        sessionId: call.call_session_id,
                        seconds: call.voicemail_seconds ?? 0,
                        transcriptShown: true
                    )
                }
            }
            .padding(16)
        }
    }

    /// One labelled fact: the label small and quiet, the value beside it.
    private struct Fact: Identifiable {
        let label: String
        let value: String
        var id: String { label }
    }

    private func facts(_ call: Call) -> [Fact] {
        let outbound = call.direction == "outbound"
        var rows: [Fact] = [
            Fact(
                label: t("shell.directionLabel"),
                value: t(outbound ? "shell.directionOutgoing" : "shell.directionIncoming")
            ),
        ]
        if let number = call.caller_e164, !number.isBlank {
            rows.append(Fact(label: t("shell.numberLabel"), value: formatPhone(number)))
        }
        if let name = call.answered_by_name, !name.isBlank {
            rows.append(Fact(label: t(outbound ? "shell.placedBy" : "shell.answeredBy"), value: name))
        }
        rows.append(
            Fact(
                label: t("shell.startedLabel"),
                value: TimestampFormat.exact(call.started_at, locale: appLocale)
            )
        )
        if let endedAt = call.ended_at {
            rows.append(
                Fact(
                    label: t("shell.endedLabel"),
                    value: TimestampFormat.exact(endedAt, locale: appLocale)
                )
            )
        }
        if let attestation = call.stir_attestation, !attestation.isBlank {
            let verified = attestation == "A"
                ? t("shell.callerVerifiedYes")
                : AppStrings.translate(
                    appLocale, "shell.callerVerifiedPartly", ["attestation": attestation]
                )
            rows.append(Fact(label: t("shell.callerVerified"), value: verified))
        }
        if let why = callRoutingReason(call.routing, appLocale) {
            rows.append(Fact(label: t("shell.whyNoPhoneRang"), value: why))
        }
        if let ended = callEndReason(call.ended_reason, appLocale) {
            rows.append(Fact(label: t("shell.howItEnded"), value: ended))
        }
        return rows
    }

    /// #714: the same activity timeline a customer, a job and a thread show,
    /// which for a call is its steps from ringing to hang-up (#725).
    private func activitySection(_ call: Call) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: t("activity.heading"))
            ActivityTimelineView(
                graph: graph,
                companyId: companyId,
                recordType: .call,
                recordId: call.id,
                onOpenConversation: activityOpenConversation,
                onOpenContact: activityOpenContact
            )
        }
    }

    /// The timeline calls back on the main actor; this screen's links are plain closures.
    private var activityOpenConversation: @MainActor (String, String?) -> Void {
        let go = onOpenConversation
        return { conversationId, _ in go(conversationId) }
    }

    private var activityOpenContact: @MainActor (String) -> Void {
        let go = onOpenContact
        return { contactId in go(contactId) }
    }

    private func factsCard(_ call: Call) -> some View {
        let rows = facts(call)
        return PaperCard {
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    Text(row.label)
                        .font(.golos(12))
                        .foregroundStyle(BrandColor.muted500)
                    Spacer(minLength: 8)
                    Text(row.value)
                        .font(.golos(14))
                        .foregroundStyle(BrandColor.ink)
                        .multilineTextAlignment(.trailing)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                if row.id != rows.last?.id {
                    RowDivider()
                }
            }
        }
    }
}
