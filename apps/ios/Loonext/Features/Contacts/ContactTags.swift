import SwiftUI

/// #695 — the tags a customer carries, on their page.
///
/// The same workspace vocabulary the conversations use, so "Warranty" is one
/// word on a thread and on the person. Pick an existing tag from the menu, or
/// type a new one: the server reuses a tag of that spelling, refuses a new one
/// when the workspace has locked its list, and its message is shown as it is.
///
/// Removing a chip is one tap and needs no confirmation: the control that undid
/// it is the one that did it (docs/UNDO-AUDIT.md, self-reversing).
///
/// *Applying: Zen of Clarity — chips and one quiet add chip; creating is a
/// field that appears only when asked for.*
struct ContactTagsRow: View {
    let tags: [ContactTag]
    let available: [Tag]
    let onAdd: (_ tagId: String?, _ name: String?) -> Void
    let onRemove: (_ tagId: String) -> Void

    @State private var creating = false
    @State private var draft = ""

    @Environment(\.appLocale) private var appLocale

    private var unattached: [Tag] {
        available.filter { tag in !tags.contains { $0.id == tag.id } }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(AppStrings.translate(appLocale, "contactsTasks.tagsHeading"))
                .font(.golos(12, weight: .semibold))
                .foregroundStyle(BrandColor.muted700)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(tags, id: \.id) { tag in
                        Button {
                            onRemove(tag.id)
                        } label: {
                            HStack(spacing: 5) {
                                Text(tag.name)
                                    .font(.golos(13))
                                Image(systemName: "xmark")
                                    .font(.scaled(IconSize.small, weight: .semibold))
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(BrandColor.limeChip, in: Capsule())
                            .foregroundStyle(BrandColor.ink)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(
                            AppStrings.translate(
                                appLocale,
                                "contactsTasks.tagRemove",
                                ["name": tag.name]
                            )
                        )
                    }
                    Menu {
                        ForEach(unattached, id: \.id) { tag in
                            Button(tag.name) { onAdd(tag.id, nil) }
                        }
                        Button(AppStrings.translate(appLocale, "contactsTasks.tagNew")) {
                            creating = true
                        }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "plus")
                                .font(.scaled(IconSize.small, weight: .semibold))
                            Text(AppStrings.translate(appLocale, "contactsTasks.tagAdd"))
                                .font(.golos(13))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(BrandColor.inset, in: Capsule())
                        .foregroundStyle(BrandColor.muted600)
                    }
                }
            }
            if creating {
                TextField(
                    AppStrings.translate(appLocale, "contactsTasks.tagFindOrCreate"),
                    text: $draft
                )
                .font(.golos(13))
                .textFieldStyle(.roundedBorder)
                HStack(spacing: 8) {
                    Button(AppStrings.translate(appLocale, "contactsTasks.tagCreate")) {
                        let name = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !name.isEmpty else { return }
                        onAdd(nil, name)
                        draft = ""
                        creating = false
                    }
                    .font(.golos(13, weight: .semibold))
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button(AppStrings.translate(appLocale, "common.cancel")) {
                        draft = ""
                        creating = false
                    }
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
    }
}

/// #695 — "Merged from Jane Smith (Nov 2)", and the way back.
///
/// Shown on the SURVIVING contact for the most recent record folded into it.
/// Unmerge is gated like merge (`settings.manage`): the line is information for
/// everybody, the action only for those who could have done the merge.
///
/// The confirmation says what does NOT come back (the threads stay put, an
/// opt-out stays) before the button does anything.
struct MergedFromRow: View {
    let mergedFrom: MergedFrom
    let canUnmerge: Bool
    let onUnmerge: @MainActor () -> Void

    @State private var confirming = false

    @Environment(\.appLocale) private var appLocale

    private var name: String { describeContact(mergedFrom.name, mergedFrom.phone_e164) }

    private var mergedLine: TimedText {
        timedText(locale: appLocale) { time in
            AppStrings.translate(
                appLocale,
                "contactsTasks.mergedFromLine",
                ["name": name, "date": time(mergedFrom.merged_at)]
            )
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Text(mergedLine.visible)
            .spokenAs(mergedLine)
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted500)
            .frame(maxWidth: .infinity, alignment: .leading)
            if canUnmerge {
                Button(AppStrings.translate(appLocale, "contactsTasks.unmergeAction")) {
                    confirming = true
                }
                .buttonStyle(.plain)
                .font(.golos(12, weight: .semibold))
                .foregroundStyle(BrandColor.muted700)
            }
        }
        .padding(.horizontal, 4)
        .confirmDialog(
            AppStrings.translate(appLocale, "contactsTasks.unmergeTitle", ["name": name]),
            isPresented: $confirming,
            message: AppStrings.translate(appLocale, "contactsTasks.unmergeBody", ["name": name]),
            confirmLabel: AppStrings.translate(appLocale, "contactsTasks.unmergeConfirm"),
            tone: .standard
        ) {
            Haptics.confirm()
            onUnmerge()
        }
    }
}
