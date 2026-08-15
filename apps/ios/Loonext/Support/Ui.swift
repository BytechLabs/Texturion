import SwiftUI

/// A load-once screen state (first load only — realtime updates patch data).
enum LoadState<T> {
    case loading
    case ready(T)
    case failed(String)
}

extension Error {
    /// The sentence a screen shows when a load or a save failed.
    ///
    /// THE SERVER'S OWN MESSAGE comes first and verbatim, as it always did: those
    /// are written to be read, and D80 is explicit that a client overwriting one
    /// "is making a bet that the server will never have anything more specific to
    /// say."
    ///
    /// A DECODE FAILURE SAYS SOMETHING DIFFERENT, because it is a different thing
    /// (#555). It means we could not read what the server sent — our bug, not the
    /// customer's, and one that "try again" cannot fix, because the same response
    /// will fail the same way. Telling somebody to retry a permanent failure is
    /// the specific dishonesty this replaces.
    ///
    /// The reason is never shown. "Response for /v1/conversations/abc did not
    /// match the client model" is a sentence for us, and it is recorded in the
    /// diagnostics log instead (see `ApiClient.decode`).
    ///
    /// An app update is named because it is the one action that genuinely might
    /// help — a Worker ahead of this build is the commonest cause, and the phones
    /// ship on their own cadence — and it is named as a possibility rather than a
    /// promise. The Diagnostics screen is deliberately NOT mentioned: it is behind
    /// a seven-tap unlock, so pointing anybody at it would be directions to a door
    /// they cannot see.
    ///
    /// Word for word the same as the Android twin in `ui/common/Ui.kt`.
    ///
    /// #228: both sentences are in the catalogue now, and the locale enters
    /// through a FUNCTION beside the property rather than by rewriting the 231
    /// call sites that read it. The property keeps its exact old behaviour, so
    /// nothing had to move; a screen that knows its reader opts in by calling
    /// `userMessage(locale)`.
    ///
    /// (The server-sentence branch was always fine in any language: it renders
    /// what the API wrote, which is the API's to word and to translate.)

    /// English, for a caller with no reader to ask.
    ///
    /// Unchanged behaviour for every existing call site — 231 of them across 69
    /// files — which is the point. A screen that KNOWS its reader calls
    /// `userMessage(locale)` below and gets French; one that does not keeps
    /// exactly what it had. Converting all of them in one commit is the mass
    /// rewrite this file's own header warns about.
    var userMessage: String { userMessage(MessageLocale.en) }

    /// The same sentence, in the reader's language where it is ours to give.
    func userMessage(_ locale: String) -> String {
        if let api = self as? ApiError {
            // #228: ours gets translated; the server's is rendered as it
            // arrived, because the API resolved the reader's locale already.
            if let key = api.messageKey {
                let translated = AppStrings.translate(locale, key, api.messageVars)
                if let reference = api.requestId, api.httpStatus >= 500 {
                    return "\(translated) Reference \(reference)."
                }
                return translated
            }
            // #555: a 500 carries the server's own reference, and saying it is what
            // makes "something went wrong" a report somebody can act on rather than
            // a shrug. Only on an internal error: a 422 explaining which field is
            // wrong needs no reference, and appending one to every refusal would be
            // noise on the copy that is already doing its job.
            if let reference = api.requestId, api.httpStatus >= 500 {
                return "\(api.message) Reference \(reference)."
            }
            return api.message
        }
        if self is ApiDecodeError {
            return AppStrings.translate(locale, "common.decodeFailed")
        }
        return AppStrings.translate(locale, "common.unknownError")
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
    /// How long the app must have been away before a return is worth a resync.
    /// A glance away — Control Center, the notification shade, a two-second app
    /// switch — cannot have missed a frame the socket was connected to receive,
    /// and `.active` fires for every one of them. Resyncing each time made every
    /// live screen refetch constantly; only a real absence earns the round-trip.
    private static let minAwaySeconds: TimeInterval = 30

    @Environment(\.scenePhase) private var scenePhase
    let resync: @MainActor () -> Void
    /// When we left `.active` (nil = not away).
    @State private var awaySince: Date?

    func body(content: Content) -> some View {
        content.onChange(of: scenePhase) { _, phase in
            if phase == .active {
                let awayFor = awaySince.map { Date().timeIntervalSince($0) } ?? 0
                awaySince = nil
                if awayFor >= Self.minAwaySeconds { resync() }
            } else if awaySince == nil {
                awaySince = Date()
            }
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

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(spacing: 16) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button(AppStrings.translate(appLocale, "common.retry"), action: onRetry)
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Flat single-tone avatar: avatar-tint fill, muted-ink initials (Paper & Olive).
///
/// The one initials badge in the app. Its glyph is bounded to its frame
/// (`TypeScale.boundedGlyph`) — see #569, where nine hand-rolled copies of this on
/// Android and three more here all clipped or spilled their letters at large text.
struct InitialsAvatar: View {
    let name: String?
    var size: CGFloat = 40
    /// The point size the initials WANT, before the reader's setting and the cap.
    /// Defaults to the historic `size * 0.38`, so every existing call is unchanged.
    var glyph: CGFloat?
    var typeface: AvatarTypeface = .system
    var shape: AnyShape = AnyShape(Circle())
    var tint: Color = BrandColor.avatarTint
    var content: Color = BrandColor.muted900

    var body: some View {
        // Already carries the reader's setting, so it is applied at a FIXED size —
        // a `relativeTo:` font here would scale it a second time and undo the cap.
        let rendered = TypeScale.boundedGlyph(box: size, wanted: glyph ?? size * 0.38)
        Text(initialsOf(name))
            .font(.boundedGlyph(rendered, face: typeface, weight: .semibold))
            .lineLimit(1)
            .foregroundStyle(content)
            .frame(width: size, height: size)
            .background(tint, in: shape)
    }
}
