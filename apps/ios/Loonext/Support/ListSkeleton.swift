import SwiftUI

/// #733: the one loading skeleton for a list: rows of an optional avatar and one or two
/// lines, pulsing where the content will land so the screen does not jump when it
/// arrives (web: `ListSkeleton`). First load only, never on a realtime update.
///
/// A skeleton shaped like a thread, a board, a map or a calendar is not a list and a
/// detail page loading one record keeps the centred spinner; the guard names those.
struct ListSkeleton: View {
    let rows: Int
    var avatar: Bool
    var lines: Int
    var inset: CGFloat

    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.appLocale) private var appLocale

    init(rows: Int = 6, avatar: Bool = false, lines: Int = 1, inset: CGFloat = 18) {
        self.rows = rows
        self.avatar = avatar
        self.lines = lines
        self.inset = inset
    }

    private func bar(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: height / 2, style: .continuous)
            .fill(BrandColor.avatarTint)
            .frame(width: width, height: height)
    }

    private var row: some View {
        HStack(spacing: 12) {
            if avatar {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(BrandColor.avatarTint)
                    .frame(width: 38, height: 38)
            }
            VStack(alignment: .leading, spacing: 8) {
                bar(width: 170, height: 14)
                if lines >= 2 {
                    bar(width: 104, height: 11)
                }
            }
            Spacer(minLength: 0)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(0..<rows, id: \.self) { _ in
                row
            }
        }
        .padding(.horizontal, inset)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .opacity(dim ? 0.5 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                dim = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(AppStrings.translate(appLocale, "common.loading"))
    }
}

#Preview("List skeleton") {
    ListSkeleton(rows: 5, avatar: true, lines: 2)
        .background(BrandColor.canvas)
}
