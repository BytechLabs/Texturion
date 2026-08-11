import SwiftUI

/**
 #286 — what a new tech gets instead of nothing.

 "An invited member sees a short, skippable, member-specific orientation on
 first sign-in."

 WHO THIS IS FOR, AND WHY IT IS NOT THE OWNER'S FLOW. The owner walked a
 five-step wizard and chose this product. The tech had it chosen for them: they
 are on a job site, on a phone, mildly annoyed, and their opinion in the first
 ten minutes decides whether the crew adopts the tool or the owner ends up as
 its only user.

 WHY IT ENDS ON NOTIFICATIONS. #286's other Acceptance line is "notification
 permission is requested with context, not cold", and joining is the moment that
 context exists — this is somebody walking into a workspace that already has
 traffic. iOS gives an app ONE system prompt: refuse it and the only way back is
 the Settings app, which almost nobody opens. Spending that prompt four seconds
 into a first launch is spending it at the worst possible moment.

 Copy hand-ported from apps/web/src/components/onboarding/member-orientation.tsx
 and held word for word by packages/shared/src/member-orientation-copy.test.ts.

 #228: the words themselves now live in `Core/I18n/ShellStrings.swift`, and the
 guard above reads that file as the iOS half — exactly as it already reads
 `apps/web/src/i18n/sections/onboarding.ts` as web's and
 `core/i18n/ShellStrings.kt` as Android's. What is left here is the ORDER and
 the marks beside each screen, which are this file's own decisions.
 */

// MARK: - The decision

/**
 Show the joining orientation?

 Hand-ported from packages/shared/src/member-orientation.ts and covered by the
 same vectors. `oriented` is the server's answer for THIS membership, so a skip
 on a phone is a skip on the laptop too; nil means the read has not landed, and
 flashing four screens at somebody who has been here for months then taking them
 away is worse than the wait.

 The audience is the one #405 already drew for the first-run checklist: somebody
 who answers customers and does not run the workspace. Deliberately not a
 read-only observer or a bookkeeper — every screen is about answering customers,
 and four screens explaining a job that is not yours is worse than no screens.
 */
func shouldShowOrientation(_ role: String?, _ oriented: Bool?) -> Bool {
    guard oriented == false, let role else { return false }
    if MemberRole.has(role, Capability.settingsManage) { return false }
    return MemberRole.has(role, Capability.conversationsSend)
}

/**
 How far along the bar reads, 0...1 — never zero.

 Somebody on screen one has already done something: they accepted an invite,
 signed in and opened the app. A bar that starts empty says otherwise and makes
 four screens feel like a form.

 *Applying: Goal Gradient Effect.*
 */
func orientationProgress(_ index: Int, total: Int = orientationScreenCount) -> Double {
    let clamped = min(max(index, 0), total - 1)
    return Double(clamped + 1) / Double(total)
}

// MARK: - The joining note (#521)

/**
 The note to put on the first screen, or nil when there is nothing to put there.

 `{ note: null, from: null }` is the ORDINARY answer from the route: every
 membership predating the field, every owner who made their own workspace, every
 invite sent without a note. So nil is not an empty state to fill. It leaves the
 flow exactly as it was, with no extra screen and no paragraph saying nobody
 wrote one.

 The server already normalises blank to null. The trim here is for the note that
 is somehow whitespace anyway, because a quotation mark around three spaces is
 worse than no quotation at all.
 */
func joiningNoteText(_ answer: JoiningNote?) -> String? {
    guard
        let text = answer?.note?.trimmingCharacters(in: .whitespacesAndNewlines),
        !text.isEmpty
    else { return nil }
    return text
}

/**
 Whose words these are.

 Word for word what the invite email says above the same note, so the sentence a
 new teammate read in their mail is signed the same way when it meets them
 again here.

 `from` can be null while the note is not, and the fallback still names a person
 rather than the workspace: somebody wrote this, and "Your workspace says" would
 turn a colleague's sentence into product copy.

 #228: `locale` defaults to English rather than being required, because the only
 caller that cannot supply one is a unit test asserting the RULE — which name
 goes where, and what an unnamed note reads as — rather than the words. Same
 shape as the Kotlin twin, for the same reason.
 */
func joiningNoteAttribution(
    _ from: String?,
    locale: String = MessageLocale.en
) -> String {
    guard let from, !from.isBlank else {
        return AppStrings.translate(locale, "shell.orientationTheySaid")
    }
    return AppStrings.translate(locale, "shell.orientationSays", ["name": from])
}

// MARK: - The screens

/// One screen: which words, and which mark beside them.
///
/// #228: KEYS rather than sentences. The four screens are one feature on three
/// clients and the copy guard reads all three, so the words live in the
/// catalogue and the order and the glyphs live here.
struct OrientationScreen: Sendable {
    let titleKey: String
    let bodyKey: String
    let icon: String
}

let orientationScreens: [OrientationScreen] = [
    OrientationScreen(
        titleKey: "shell.orientationInboxTitle",
        bodyKey: "shell.orientationInboxBody",
        icon: "tray.full"
    ),
    OrientationScreen(
        titleKey: "shell.orientationNumberTitle",
        bodyKey: "shell.orientationNumberBody",
        icon: "phone"
    ),
    OrientationScreen(
        titleKey: "shell.orientationNotesTitle",
        bodyKey: "shell.orientationNotesBody",
        icon: "note.text"
    ),
    OrientationScreen(
        titleKey: "shell.orientationNotificationsTitle",
        bodyKey: "shell.orientationNotificationsBody",
        icon: "bell.badge"
    ),
]

/// The number of screens, so a test can assert the flow stayed short.
let orientationScreenCount: Int = orientationScreens.count

// MARK: - The sheet

/**
 Presented from the shell rather than a screen: it belongs to the SESSION, not
 to whichever tab happened to be selected.

 `onFinished` is called for BOTH outcomes — finished and skipped — because a
 skip that comes back tomorrow is not a skip, and #286 promises a skippable
 flow.
 */
struct MemberOrientationSheet: View {
    /// #521: what the person who added them said, read before this opens so the
    /// first screen arrives whole. nil is the ordinary case.
    let joining: JoiningNote?
    let onFinished: () -> Void

    @State private var index = 0
    @State private var ask = NotificationAsk()
    @Environment(\.appLocale) private var appLocale

    private var screen: OrientationScreen { orientationScreens[index] }
    private var last: Bool { index == orientationScreens.count - 1 }
    private var note: String? { joiningNoteText(joining) }

    /**
     A note is up to 500 characters of somebody's writing, which does not fit
     the height four short screens were sized for.

     Chosen ONCE for the whole flow rather than per screen: a sheet that resizes
     under your thumb when you tap Next reads as a glitch. With no note the
     height is the one it has always been.
     */
    private var detents: Set<PresentationDetent> {
        guard note != nil else { return [.height(360)] }
        return [.medium, .large]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ProgressRail(index: index)
            // Scrolling is what a NOTE needs, so only a note gets it. Up to 500
            // characters of somebody's writing can outrun the sheet, and
            // without a scroll it would push the buttons past the bottom edge.
            //
            // Without one the layout is the fixed one these four short screens
            // were sized for. A ScrollView with nothing to scroll is not free:
            // it rubber-bands, and it does that against the downward drag the
            // shell deliberately reads as the skip, on a sheet with a single
            // detent that has nowhere to go.
            if note == nil {
                screenBody
                Spacer(minLength: 0)
            } else {
                ScrollView {
                    screenBody
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            HStack {
                // Skippable from the very first screen, per the Acceptance
                // line. A flow you must finish to escape is a wall, and this
                // one guards nothing.
                Button(
                    AppStrings.translate(
                        appLocale,
                        last && ask.askable
                            ? "shell.notificationsNotNow"
                            : "shell.orientationSkip"
                    ),
                    action: onFinished
                )
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                Spacer()
                if last {
                    Button(
                        AppStrings.translate(
                            appLocale,
                            ask.askable
                                ? "shell.notificationsTurnOn"
                                : "shell.orientationStartWorking"
                        )
                    ) {
                        Task {
                            // The one action that reaches past the app, and by
                            // now three screens have said what it is for. A
                            // no-op where the question is already answered,
                            // which is what makes the other label honest.
                            await ask.request()
                            onFinished()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Button(AppStrings.translate(appLocale, "shell.orientationNext")) {
                        index += 1
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(24)
        .presentationDetents(detents)
        // Only where there is a second height to reach: a grabber on a sheet
        // that cannot move is a control that does nothing. `.automatic` is the
        // default, so the flow without a note is untouched.
        .presentationDragIndicator(note == nil ? .automatic : .visible)
        .interactiveDismissDisabled(false)
        .task { await ask.refresh() }
    }

    /// One screen: the note where there is one, then the icon, title and body.
    ///
    /// Its own property because the sheet places it two ways (inside a scroll
    /// where a note may run long, bare where the height is fixed), and a screen
    /// that differed between those two would be two screens.
    private var screenBody: some View {
        VStack(alignment: .leading, spacing: 18) {
            // #521: their crew's words before the product's, and only here.
            // Somebody reads this once, in their first minute; repeating it on
            // all four screens would turn a colleague's sentence into a banner.
            if index == 0, let note = note {
                JoiningNoteBlock(note: note, from: joining?.from)
            }
            Image(systemName: screen.icon)
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: 44, height: 44)
                .background(Color.accentColor.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 8) {
                Text(AppStrings.translate(appLocale, screen.titleKey))
                    .font(.title2.weight(.semibold))
                Text(AppStrings.translate(appLocale, screen.bodyKey))
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/**
 #521: somebody's sentence, above the first screen, signed.

 A left rule and no box, which is the device the invite email already uses for
 the same words: this is a quotation from a person, not a product callout, and a
 tinted panel would make it read as the third kind of banner an app shows on
 first launch.

 The attribution goes ABOVE the words. Below it, the reader has already decided
 whose voice they were hearing, and by then they have guessed wrong.
 */
private struct JoiningNoteBlock: View {
    let note: String
    let from: String?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(joiningNoteAttribution(from, locale: appLocale))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(note)
                .font(.body)
                // Long notes wrap rather than shrink to fit the line.
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        // An overlay takes the height of what it sits on, so the rule matches
        // the note however many lines it runs to.
        .overlay(alignment: .leading) {
            Capsule()
                .fill(Color.accentColor)
                .frame(width: 3)
        }
        // One phrase to VoiceOver: the name and the words are one sentence, and
        // two elements would read them as two unrelated labels.
        .accessibilityElement(children: .combine)
    }
}

/**
 Four segments, the current one filled — and the first is filled the moment this
 opens.

 *Applying: Goal Gradient Effect.*
 */
private struct ProgressRail: View {
    let index: Int

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        let filled = orientationProgress(index) * Double(orientationScreens.count)
        HStack(spacing: 4) {
            ForEach(0..<orientationScreens.count, id: \.self) { position in
                Capsule()
                    .fill(
                        Double(position) < filled
                            ? Color.accentColor
                            : Color.secondary.opacity(0.25)
                    )
                    .frame(height: 4)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            AppStrings.translate(
                appLocale,
                "shell.orientationStepOf",
                ["index": "\(index + 1)", "total": "\(orientationScreens.count)"]
            )
        )
    }
}
