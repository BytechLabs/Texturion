import SwiftUI

/// #733: the one "couldn't load this" state: a plain sentence and an outline Retry
/// (web: `LoadError`). It replaces `CenteredError` and the screens' own retry buttons.
///
/// `fill` is centred in the space the content would have filled; `card` sits among
/// other cards, left-aligned on a paper surface; `inline` is one line, the sentence
/// beside a small Retry, for a spot inside a card with no room for a card of its own.
struct LoadError: View {
    enum Variant { case fill, card, inline }

    let message: String
    var variant: Variant
    let onRetry: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    init(
        message: String,
        variant: Variant = .fill,
        onRetry: @escaping @MainActor () -> Void
    ) {
        self.message = message
        self.variant = variant
        self.onRetry = onRetry
    }

    private var retry: some View {
        Button(AppStrings.translate(appLocale, "common.retry")) { onRetry() }
            .buttonStyle(.bordered)
            .controlSize(variant == .inline ? .small : .regular)
    }

    var body: some View {
        switch variant {
        case .fill:
            VStack(spacing: 16) {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                retry
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .card:
            VStack(alignment: .leading, spacing: 12) {
                Text(message)
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted700)
                retry
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                BrandColor.paper,
                in: RoundedRectangle(cornerRadius: 22, style: .continuous)
            )
        case .inline:
            HStack(spacing: 10) {
                Text(message)
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.muted700)
                    .frame(maxWidth: .infinity, alignment: .leading)
                retry
            }
        }
    }
}

#Preview("Load error") {
    VStack(spacing: 20) {
        LoadError(message: "Couldn't load this.", variant: .card) {}
        LoadError(message: "Couldn't load this.", variant: .inline) {}
    }
    .padding()
    .background(BrandColor.canvas)
}
