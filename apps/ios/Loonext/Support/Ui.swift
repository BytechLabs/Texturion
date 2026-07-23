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

extension View {
    /// #215 Part A — the resync-on-foreground safety net. When the scene
    /// returns to `.active` (app foregrounded, or a system overlay dismissed),
    /// run `resync` so any realtime frame missed while backgrounded/blurred
    /// self-heals. This is the SAME refetch each live screen already runs on a
    /// socket re-JOIN (`reconnected()`), wired to a second trigger — a dropped
    /// or late broadcast is no longer lost until the user navigates away.
    func resyncOnForeground(_ resync: @escaping @MainActor () -> Void) -> some View {
        modifier(ResyncOnForegroundModifier(resync: resync))
    }
}

private struct ResyncOnForegroundModifier: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    let resync: @MainActor () -> Void

    func body(content: Content) -> some View {
        content.onChange(of: scenePhase) { _, phase in
            if phase == .active { resync() }
        }
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

/// Flat single-tone avatar: avatar-tint fill, muted-ink initials (Paper & Olive).
struct InitialsAvatar: View {
    let name: String?
    var size: CGFloat = 40

    var body: some View {
        Text(initialsOf(name))
            .font(.system(size: size * 0.38, weight: .semibold))
            .foregroundStyle(BrandColor.muted900)
            .frame(width: size, height: size)
            .background(BrandColor.avatarTint, in: Circle())
    }
}
