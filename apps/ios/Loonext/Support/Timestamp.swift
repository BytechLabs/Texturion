import SwiftUI

/// #720: a date or time a person reads, with its exact time one long-press away.
///
/// The visible label is drawn by `TimestampFormat` (usually through `relativeTime`);
/// this modifier adds what the label hides. A long-press shows the exact time with its
/// zone ("Tue, Nov 10, 2026, 3:42 PM EST"), and VoiceOver reads the label followed by that
/// exact time.
///
/// It is a simultaneous gesture, so a row that opens on tap still opens when the time is
/// what was touched.
private struct ExactTimeModifier: ViewModifier {
    let iso: String?

    @Environment(\.appLocale) private var appLocale
    @State private var showsExact = false

    func body(content: Content) -> some View {
        content
            .accessibilityLabel(TimestampFormat.spoken(iso, locale: appLocale))
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.45).onEnded { _ in
                    showsExact = true
                }
            )
            .popover(isPresented: $showsExact) {
                Text(TimestampFormat.exact(iso, locale: appLocale))
                    .font(.footnote)
                    .padding(12)
                    .presentationCompactAdaptation(.popover)
            }
    }
}

extension View {
    /// Long-press for the exact time; VoiceOver hears it after the visible label.
    @ViewBuilder
    func exactTime(_ iso: String?) -> some View {
        if TimestampFormat.exact(iso).isEmpty {
            self
        } else {
            modifier(ExactTimeModifier(iso: iso))
        }
    }
}
