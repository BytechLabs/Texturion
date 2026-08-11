import SwiftUI

/// #540 — "What's on this screen", on the phone.
///
/// ## Evaluation
///
/// The dashboard was not customisable anywhere. An owner who never sells on
/// referrals reads past "Where customers came from" every morning, and a screen
/// nobody can adjust slowly becomes somebody else's screen.
///
/// ## What binds it
///
/// *Zen of Clarity* — five toggles ON the tab would be five controls competing
/// with the work. One quiet button in the header opens this; the toggles exist
/// nowhere else.
///
/// *Direct manipulation* — no Save button, no spinner. The member is looking at
/// the screen they are changing, so the feedback is the screen changing behind the
/// sheet. A Save step would make a layout preference feel like a form, and would
/// let somebody dismiss the sheet and lose it. "Done" closes; it does not commit.
///
/// *The Safety Principle* — a sheet, like every other secondary surface on this
/// tab, reached from beside the notification bell that was already there.
///
/// ## What is deliberately NOT offered
///
/// The queue. Not "Unassigned", not "Waiting on you", not "Chase these". Hiding
/// those is not a preference — it is a way to stop seeing customers nobody has
/// answered. The reasoning lives in `Core/DashboardPanels.swift`.
///
/// Manual reordering either: the queue is ordered by what has actually gone wrong,
/// and a member-set order would put an overdue task below "Unread".
///
/// Mirrors `apps/web/src/components/for-you/customise-dashboard.tsx` and
/// `apps/android/.../features/foryou/CustomiseSheet.kt`.
///
/// *Applying: Zen of Clarity, the Safety Principle, and Chunking — two labelled
/// groups rather than one list of five.*
@MainActor
struct CustomiseSheet: View {
    let hidden: [String]
    let onToggle: @MainActor (DashboardPanels.Panel, Bool) -> Void
    /// True after a save failed — the row has already moved back by then.
    let failed: Bool

    @Environment(\.dismiss) private var dismiss

    private var measures: [DashboardPanels.Panel] {
        DashboardPanels.Panel.allCases.filter { $0 != .recentCalls }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(measures) { panel in
                        PanelRow(panel: panel, hidden: hidden, onToggle: onToggle)
                    }
                } header: {
                    Text("Measures")
                } footer: {
                    // Says what is NOT on offer, once, here — rather than leaving
                    // somebody hunting for a toggle that does not exist.
                    Text("The queue always stays. Work isn't something you can switch off.")
                }

                Section("History") {
                    PanelRow(panel: .recentCalls, hidden: hidden, onToggle: onToggle)
                }

                // One line, and only when a write actually failed. The toggle is
                // optimistic, so this has to say the row went BACK rather than that
                // something is still pending.
                if failed {
                    Section {
                        Text(
                            "We couldn't save that — it's back the way it was. "
                                + "Try again in a moment."
                        )
                        .font(.footnote)
                        .foregroundStyle(BrandColor.destructive)
                    }
                }
            }
            .navigationTitle("What's on this screen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    // Closes the sheet. It does not commit anything — every toggle
                    // has already taken effect behind it.
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

@MainActor
private struct PanelRow: View {
    let panel: DashboardPanels.Panel
    let hidden: [String]
    let onToggle: @MainActor (DashboardPanels.Panel, Bool) -> Void

    var body: some View {
        Toggle(
            isOn: Binding(
                get: { DashboardPanels.isVisible(hidden, panel) },
                set: { onToggle(panel, $0) }
            )
        ) {
            VStack(alignment: .leading, spacing: 2) {
                Text(DashboardPanels.label(panel)).font(.body)
                // The reason it exists, under its name. Four headings alone do not
                // distinguish "Pipeline" from "Response time" for anybody who has
                // not already read both cards.
                Text(DashboardPanels.note(panel))
                    .font(.caption)
                    .foregroundStyle(BrandColor.muted500)
            }
        }
        // VoiceOver announces a Toggle as "on"/"off", which does not say on WHAT.
        .accessibilityValue(
            DashboardPanels.isVisible(hidden, panel) ? "On this screen" : "Put away"
        )
    }
}
