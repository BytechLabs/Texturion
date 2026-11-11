import SwiftUI

/// #733: the one empty state. A quiet icon in a disc, one warm line, an optional second
/// line, and at most one outline action, centred with room to breathe (web:
/// `EmptyState`). Never "No data", never an illustration.
///
/// `page` fills a list area or a screen; `panel` sits inside a card or a sheet section.
/// `fill` centres it in all the room the parent gives it, for a list that has nothing
/// else on screen; leave it off inside a scroll view that has more below.
struct EmptyState: View {
    enum Size { case page, panel }

    let title: String
    var description: String?
    var systemImage: String?
    var size: Size
    var fill: Bool
    var actionTitle: String?
    var action: (@MainActor () -> Void)?

    init(
        title: String,
        description: String? = nil,
        systemImage: String? = nil,
        size: Size = .page,
        fill: Bool = false,
        actionTitle: String? = nil,
        action: (@MainActor () -> Void)? = nil
    ) {
        self.title = title
        self.description = description
        self.systemImage = systemImage
        self.size = size
        self.fill = fill
        self.actionTitle = actionTitle
        self.action = action
    }

    var body: some View {
        let page = size == .page
        return VStack(spacing: page ? 12 : 8) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.scaled(IconSize.large))
                    .foregroundStyle(BrandColor.muted700)
                    .frame(width: 44, height: 44)
                    .background(BrandColor.inset, in: Circle())
                    .accessibilityHidden(true)
            }
            VStack(spacing: 6) {
                Text(title)
                    .font(.golos(15, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                    .multilineTextAlignment(.center)
                if let description {
                    Text(description)
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted600)
                        .multilineTextAlignment(.center)
                }
            }
            if let actionTitle, let action {
                Button(actionTitle) { action() }
                    .buttonStyle(.bordered)
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, page ? 32 : 16)
        .padding(.vertical, page ? 48 : 20)
        .frame(maxWidth: .infinity, maxHeight: fill ? CGFloat.infinity : nil)
    }
}

#Preview("Empty state") {
    VStack(spacing: 24) {
        EmptyState(
            title: "Nothing waiting",
            description: "New texts land here.",
            systemImage: "tray"
        )
        EmptyState(title: "Nothing here yet", size: .panel)
    }
    .background(BrandColor.canvas)
}
