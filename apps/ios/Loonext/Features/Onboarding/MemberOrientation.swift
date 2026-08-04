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

// MARK: - The screens

struct OrientationScreen: Sendable {
    let title: String
    let body: String
    let icon: String
}

let orientationScreens: [OrientationScreen] = [
    OrientationScreen(
        title: "One inbox, the whole crew",
        body: "Every text your customers send lands here, and everyone on the "
            + "crew can see it. Nothing sits unanswered in one person's phone.",
        icon: "tray.full"
    ),
    OrientationScreen(
        title: "You answer as the business",
        body: "Your replies go out from the workspace's number, so customers "
            + "never get your personal one. If a number isn't shared with you, "
            + "Settings tells you which and why.",
        icon: "phone"
    ),
    OrientationScreen(
        title: "Notes stay inside",
        body: "Switch the composer to Note and only the crew sees it — the "
            + "customer never does. Mention a teammate in one and it lands on "
            + "their For you.",
        icon: "note.text"
    ),
    OrientationScreen(
        title: "You choose when we buzz you",
        body: "You're joining a workspace that already has traffic. Turn on "
            + "notifications for the work meant for you, and change them any "
            + "time in Settings.",
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
    let onFinished: () -> Void

    @State private var index = 0
    @State private var ask = NotificationAsk()

    private var screen: OrientationScreen { orientationScreens[index] }
    private var last: Bool { index == orientationScreens.count - 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ProgressRail(index: index)
            Image(systemName: screen.icon)
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: 44, height: 44)
                .background(Color.accentColor.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 8) {
                Text(screen.title).font(.title2.weight(.semibold))
                Text(screen.body).font(.body).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            HStack {
                // Skippable from the very first screen, per the Acceptance
                // line. A flow you must finish to escape is a wall, and this
                // one guards nothing.
                Button(last && ask.askable ? "Not now" : "Skip", action: onFinished)
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                Spacer()
                if last {
                    Button(ask.askable ? "Turn on notifications" : "Start working") {
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
                    Button("Next") { index += 1 }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(24)
        .presentationDetents([.height(360)])
        .interactiveDismissDisabled(false)
        .task { await ask.refresh() }
    }
}

/**
 Four segments, the current one filled — and the first is filled the moment this
 opens.

 *Applying: Goal Gradient Effect.*
 */
private struct ProgressRail: View {
    let index: Int

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
        .accessibilityLabel("Step \(index + 1) of \(orientationScreens.count)")
    }
}
