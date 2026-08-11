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

    @State private var sources: [LeadSource] = []
    @State private var current: String?
    @State private var origin: String?
    @State private var pending = false

    @Environment(\.appLocale) private var appLocale

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
                if origin == "number", let currentName {
                    Text(
                        AppStrings.translate(
                            appLocale, "thread.leadFromLine", ["name": currentName]
                        )
                    )
                    .font(.callout)
                } else if let currentName {
                    Text(
                        AppStrings.translate(
                            appLocale, "thread.leadSaidSo", ["name": currentName]
                        )
                    )
                    .font(.callout)
                } else {
                    Text(AppStrings.translate(appLocale, "thread.leadAsk"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                LeadSourceChips(
                    options: options,
                    current: current,
                    pending: pending,
                    onChoose: choose
                )
            }
            .task(id: detail.id) { await load() }
        } else {
            Color.clear.frame(height: 0).task(id: detail.id) { await load() }
        }
    }

    private func load() async {
        current = detail.lead_source_id
        origin = detail.lead_source_origin
        sources = (try? await controller.leadSources()) ?? []
    }

    private func choose(_ id: String?) {
        pending = true
        Task { @MainActor in
            defer { pending = false }
            if let next = try? await controller.setLeadSource(id) {
                current = next.lead_source_id
                origin = next.lead_source_origin
            }
        }
    }
}

private struct LeadSourceChips: View {
    let options: [LeadSource]
    let current: String?
    let pending: Bool
    let onChoose: (String?) -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        // A wrapping row of chips. `Flow` is not available on the deployment
        // target, so this is the same shape the tag sheet next door uses.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(options) { source in
                    let selected = source.id == current
                    Button {
                        // Tapping the chosen one again clears it: the fastest
                        // way back from a mistap is the control you just used.
                        onChoose(selected ? nil : source.id)
                    } label: {
                        Text(source.name)
                            .font(.caption)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                Capsule().fill(
                                    selected
                                        ? BrandColor.olive.opacity(0.18)
                                        : Color.secondary.opacity(0.10)
                                )
                            )
                            .overlay(
                                Capsule().stroke(
                                    selected ? BrandColor.olive.opacity(0.5) : .clear
                                )
                            )
                            .foregroundStyle(Color.primary)
                    }
                    .buttonStyle(.plain)
                    .disabled(pending)
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
            }
        }
    }
}
