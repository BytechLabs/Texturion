import SwiftUI

/// A load-once screen state (first load only — realtime updates patch data).
enum LoadState<T> {
    case loading
    case ready(T)
    case failed(String)
}

extension Error {
    /// The server's verbatim message when this is an ApiError; a calm generic
    /// line otherwise (never a raw decoding/transport dump).
    var userMessage: String {
        (self as? ApiError)?.message ?? "Something went wrong."
    }
}

/// Centered loading indicator — first load only, never spinners over data.
struct CenteredLoading: View {
    var body: some View {
        ProgressView()
            .controlSize(.large)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Calm inline error: one sentence what happened + retry.
struct CenteredError: View {
    let message: String
    let onRetry: @MainActor () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Try again", action: onRetry)
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Flat single-tone avatar: petrol-tint fill, petrol-deep initials (G11).
struct InitialsAvatar: View {
    let name: String?
    var size: CGFloat = 40

    var body: some View {
        Text(initialsOf(name))
            .font(.system(size: size * 0.38, weight: .semibold))
            .foregroundStyle(BrandColor.onPetrolContainer)
            .frame(width: size, height: size)
            .background(BrandColor.petrolContainer, in: Circle())
    }
}
