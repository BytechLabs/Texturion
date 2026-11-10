import SwiftUI

/**
 #301 — "how did you hear about us?", as one tap.

 Hand-port of `apps/web/src/components/contact-panel/lead-source-picker.tsx`
 and `ContactPanelSheet.kt`'s picker.

 # The trap this is built around

 #301's devil's-advocate section names it exactly: asking the tech to
 categorise every inbound is a tax on the person with the least time, and if it
 is not one tap it will not happen — which produces a source field empty 80% of
 the time and a MISLEADING report rather than no report. So it is chips, not a
 menu.

 # It never asks a question it already knows the answer to

 When the LINE attributed the conversation — the truck number rang — there is
 nothing to ask, so it states the answer and offers no prompt. Asking anyway is
 how a crew learns to dismiss this control, and the whole value of per-number
 attribution is that nobody has to do anything.

 # It never turns a guess into a fact

 A source set by a person reads as one, and the way back is "Don't know" rather
 than an absence: clearing means unknown, never a silent fall back to the
 line's own source, which would dress a guess up as a fact again.
 */
struct LeadSourcePicker: View {
    let controller: ThreadController
    let detail: ConversationDetail
    /// #726: where lead sources are managed; nil for someone who cannot add one.
    var onAddSource: (@MainActor () -> Void)? = nil

    @State private var sources: [LeadSource] = []
    /// #726: held per conversation. Read through `shown`, so a thread never
    /// draws the last thread's choice, not even for the frame before it loads.
    @State private var held: LeadSourceChoice?
    @State private var pending = false

    @Environment(\.appLocale) private var appLocale

    private var shown: LeadSourceChoice {
        if let held, held.conversationId == detail.id { return held }
        return LeadSourceChoice.of(detail)
    }

    private var current: String? { shown.sourceId }

    private var options: [LeadSource] {
        sources.filter { $0.archived_at == nil }
    }

    /// An archived source still NAMES the thread it attributed — this
    /// conversation genuinely came from the yard sign, even after it came down.
    private var currentName: String? {
        guard let current else { return nil }
        return sources.first { $0.id == current }?.name
    }

    var body: some View {
        // A list that will not load hides the picker rather than showing a
        // prompt with no answers on offer.
        if !options.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                // #726: the empty state is a value of its own, said in words, so
                // the chips below read as choices rather than as the answer.
                switch leadSourceView(name: currentName, origin: shown.origin) {
                case .chosen(let name, let fromNumber):
                    Text(
                        AppStrings.translate(
                            appLocale,
                            fromNumber ? "thread.leadFromLine" : "thread.leadSaidSo",
                            ["name": name]
                        )
                    )
                    .font(.callout)
                case .unasked:
                    Text(AppStrings.translate(appLocale, "thread.leadAsk"))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                LeadSourceChips(
                    options: options,
                    current: current,
                    pending: pending,
                    onChoose: choose,
                    onAddSource: onAddSource
                )
            }
            .task(id: detail.id) { await load() }
        } else {
            Color.clear.frame(height: 0).task(id: detail.id) { await load() }
        }
    }

    private func load() async {
        held = LeadSourceChoice.of(detail)
        sources = (try? await controller.leadSources()) ?? []
    }

    private func choose(_ id: String?) {
        pending = true
        Task { @MainActor in
            defer { pending = false }
            if let next = try? await controller.setLeadSource(id) {
                held = LeadSourceChoice(
                    conversationId: detail.id,
                    sourceId: next.lead_source_id,
                    origin: next.lead_source_origin
                )
            }
        }
    }
}

private struct LeadSourceChips: View {
    let options: [LeadSource]
    let current: String?
    let pending: Bool
    let onChoose: (String?) -> Void
    let onAddSource: (@MainActor () -> Void)?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        // A wrapping row of chips. `Flow` is not available on the deployment
        // target, so this is the same shape the tag sheet next door uses.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(options) { source in
                    let selected = source.id == current
                    ChoiceChip(
                        label: source.name,
                        chosen: selected,
                        disabled: pending
                    ) {
                        // Tapping the chosen one again clears it: the fastest
                        // way back from a mistap is the control you just used.
                        onChoose(selected ? nil : source.id)
                    }
                }
                if current != nil {
                    Button(AppStrings.translate(appLocale, "thread.dontKnow")) {
                        onChoose(nil)
                    }
                        .font(.caption)
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .disabled(pending)
                }
                // One source is still a question, so whoever can add another
                // is offered the way to.
                if let onAddSource {
                    Button(AppStrings.translate(appLocale, "thread.addLeadSource")) {
                        onAddSource()
                    }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .foregroundStyle(BrandColor.olive)
                }
            }
        }
    }
}

/// #726: the lead source of ONE conversation.
///
/// Built from the conversation's own server value and held per conversation, so
/// opening another thread starts from that thread's answer and never from the
/// last thread's choice. A thread nobody asked about starts with nothing chosen.
struct LeadSourceChoice: Equatable {
    let conversationId: String
    var sourceId: String?
    var origin: String?

    static func of(_ detail: ConversationDetail) -> LeadSourceChoice {
        LeadSourceChoice(
            conversationId: detail.id,
            sourceId: detail.lead_source_id,
            origin: detail.lead_source_origin
        )
    }
}

/// What the source line says: an answer, or that nobody has asked.
enum LeadSourceView: Equatable {
    case unasked
    /// `fromNumber`: the line they called named it, so nobody had to ask.
    case chosen(name: String, fromNumber: Bool)
}

func leadSourceView(name: String?, origin: String?) -> LeadSourceView {
    guard let name else { return .unasked }
    return .chosen(name: name, fromNumber: origin == "number")
}

/// #726: only someone who can manage settings is offered "Add a source".
func canAddLeadSource(role: String?) -> Bool {
    MemberRole.has(role, Capability.settingsManage)
}
