import SwiftUI

/// #717: the one header every record panel and detail screen draws: who or
/// what this is, what it says about itself, and an action row under it.
/// Navigation to the record's own screen is a labelled link in that row
/// (`RecordOpenLink`), never an icon in a corner, so it cannot be mistaken for
/// editing and is found on first look.
///
/// Hand-port of `apps/web/src/components/ui/record-header.tsx`; Android's twin
/// is `ui/common/RecordHeader.kt`.
struct RecordHeader<Leading: View, Content: View, Trailing: View, Actions: View>: View {
    private let leading: Leading
    private let content: Content
    private let trailing: Trailing
    private let actions: Actions

    /// - leading: an avatar, or a task's done circle.
    /// - content: the title, then quiet lines under it (a number, an outcome, a
    ///   relationship).
    /// - trailing: icon toggles and the overflow menu, beside the title.
    /// - actions: the action row: call, copy, open.
    init(
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder content: () -> Content,
        @ViewBuilder trailing: () -> Trailing,
        @ViewBuilder actions: () -> Actions
    ) {
        self.leading = leading()
        self.content = content()
        self.trailing = trailing()
        self.actions = actions()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                leading
                VStack(alignment: .leading, spacing: 2) {
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                trailing
            }
            // The row wraps to a column rather than clipping at large type.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { actions }
                VStack(alignment: .leading, spacing: 4) { actions }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The action row's way to the record's own screen: a label and a chevron.
struct RecordOpenLink: View {
    let label: String
    let action: @MainActor () -> Void

    var body: some View {
        Button {
            action()
        } label: {
            HStack(spacing: 3) {
                Text(label)
                    .font(.golos(13, weight: .semibold))
                Image(systemName: "chevron.right")
                    .font(.scaled(11, weight: .semibold))
            }
            .foregroundStyle(BrandColor.olive)
            .padding(.vertical, 8)
            .padding(.horizontal, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// One section of a record panel: a quiet label over its content.
struct RecordSection<Content: View>: View {
    private let label: String
    private let content: Content

    init(label: String, @ViewBuilder content: () -> Content) {
        self.label = label
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(label: label)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
