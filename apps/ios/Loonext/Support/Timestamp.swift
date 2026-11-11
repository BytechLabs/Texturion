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
    @Environment(\.recordMenuOwnsLongPress) private var menuOwnsLongPress
    @State private var showsExact = false

    @ViewBuilder
    func body(content: Content) -> some View {
        let labelled = content.accessibilityLabel(TimestampFormat.spoken(iso, locale: appLocale))
        // #712: inside a record that opens a menu on long-press, the menu wins and leads
        // with this same exact time. The time then carries no gesture at all, so it is
        // not a second, tiny touch target inside the row.
        if menuOwnsLongPress {
            labelled
        } else {
            labelled
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
}

private struct RecordMenuOwnsLongPressKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// #712: true under a row whose long-press opens a record menu.
    var recordMenuOwnsLongPress: Bool {
        get { self[RecordMenuOwnsLongPressKey.self] }
        set { self[RecordMenuOwnsLongPressKey.self] = newValue }
    }
}

/// #238: a line with a compact time in it. `visible` is drawn; `spoken` is what VoiceOver
/// says. They differ only in the time, which is "5m" on screen and a full date and zone aloud.
struct TimedText: Equatable {
    let visible: String
    let spoken: String
}

/// Builds a line twice, once with each time as the screen draws it and once as VoiceOver
/// says it. `build` gets `time` and writes it wherever the line wants a time; `drawTime` is
/// how the screen draws one. This is the one way a sentence with a time in it is built, so
/// no screen pairs a compact label with its spoken twin by hand.
func timedText(
    locale: String? = nil,
    now: Date = Date(),
    timeZone: TimeZone = .current,
    _ build: (_ time: (String?) -> String) -> String
) -> TimedText {
    timedText(
        locale: locale,
        now: now,
        timeZone: timeZone,
        drawTime: { relativeTime($0 ?? "") },
        build
    )
}

/// `timedText` with its own way of drawing a time, such as `formatDue` for a due moment.
func timedText(
    locale: String? = nil,
    now: Date = Date(),
    timeZone: TimeZone = .current,
    drawTime: (String?) -> String,
    _ build: (_ time: (String?) -> String) -> String
) -> TimedText {
    let visible = build(drawTime)
    let spoken = build { iso in
        let said = TimestampFormat.spoken(iso, locale: locale, now: now, timeZone: timeZone)
        return said.isEmpty ? drawTime(iso) : said
    }
    return TimedText(visible: visible, spoken: spoken)
}

extension View {
    /// VoiceOver says `text.spoken` for the Text that draws `text.visible`.
    func spokenAs(_ text: TimedText) -> some View {
        accessibilityLabel(text.spoken)
    }

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
