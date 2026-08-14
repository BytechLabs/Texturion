import SwiftUI
import UIKit

/// #337 — the developer Diagnostics surface, the Android twin's missing half.
///
/// #198 shipped this on Android and closed. iOS never got it, on the platform
/// that needs it most: Swift compiles only in Mobile CI, so an iOS bug's whole
/// life is "somebody noticed something on a device and described it in prose".
/// This is the shortest path from that sentence to a fact.
///
/// Reached the same way as Android — seven quick taps on the version footer in
/// Settings — and it says the same words when it unlocks, so a founder walking
/// somebody through it gives one set of instructions for either phone.
///
/// TWO SECTIONS, and the split follows what a bug report actually needs:
///   Device   the facts every report needs, whatever went wrong.
///   Events   the recent-client-event ring, newest first, which is the half
///            that says what the client was doing when it went wrong.
///
/// Everything is read-only except the explicit Clear. Nothing is sent anywhere
/// on its own; sharing is always a person tapping share.
///
/// NO CUSTOMER CONTENT REACHES THIS SCREEN, and that is enforced upstream in
/// `DiagnosticsLog` rather than trusted here — the fields are short codes by
/// construction, and this view has no path to a message body, a contact or a
/// number. It matters because a diagnostics screen is exactly the thing a
/// customer screenshots and sends us.
@MainActor
struct DiagnosticsView: View {
    let snapshot: DiagnosticsSnapshot

    @State private var entries: [DiagnosticsEntry] = []
    @State private var crashes: [CrashReport] = []
    @State private var confirmingClear = false
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 13) {
                ScreenTitle(text: AppStrings.translate(appLocale, "shell.diagTitle"))

                SectionHeader(label: AppStrings.translate(appLocale, "shell.diagDevice"))
                PaperCard {
                    ForEach(Array(snapshot.rows.enumerated()), id: \.offset) { index, row in
                        if index > 0 { RowDivider() }
                        deviceRow(label: row.label, value: row.value)
                    }
                }

                SectionHeader(
                    label: AppStrings.translate(appLocale, "shell.diagRecentEvents"),
                    count: entries.count
                )
                PaperCard {
                    if entries.isEmpty {
                        Text(AppStrings.translate(appLocale, "shell.diagNoEvents"))
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.muted500)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 13)
                    } else {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            if index > 0 { RowDivider() }
                            eventRow(entry)
                        }
                    }
                }

                // #485. Below the events, because a crash is rarer and the
                // events are what somebody scrolls for day to day.
                SectionHeader(
                    label: AppStrings.translate(appLocale, "shell.diagCrashes"),
                    count: crashes.count
                )
                PaperCard {
                    if crashes.isEmpty {
                        // Says WHY it might be empty. MetricKit hands crashes
                        // over on Apple's schedule, not ours, so a list that
                        // is empty right after a crash means "not delivered
                        // yet" — and without this line it reads as "the
                        // capture is broken", which is the wrong conclusion to
                        // invite on a diagnostics screen.
                        Text(AppStrings.translate(appLocale, "shell.diagNoCrashes"))
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.muted500)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 13)
                    } else {
                        ForEach(Array(crashes.enumerated()), id: \.element.id) { index, crash in
                            if index > 0 { RowDivider() }
                            crashRow(crash)
                        }
                    }
                }

                // The point of the screen is getting this OFF the device, so the
                // share action is a full-width row rather than a toolbar button
                // somebody has to find. ShareLink hands the same text
                // #253's support reporting will send.
                PaperCard {
                    ShareLink(
                        item: DiagnosticsReport.text(
                            snapshot: snapshot,
                            entries: entries,
                            crashes: crashes
                        )
                    ) {
                        HStack(spacing: 12) {
                            Image(systemName: "square.and.arrow.up")
                                .font(.scaled(15, weight: .medium))
                                .foregroundStyle(BrandColor.muted500)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(
                                    AppStrings.translate(
                                        appLocale, "shell.diagShareEverything"
                                    )
                                )
                                .font(.golos(13.5, weight: .semibold))
                                .foregroundStyle(BrandColor.ink)
                                Text(
                                    AppStrings.translate(
                                        appLocale, "shell.diagShareCaption"
                                    )
                                )
                                .font(.golos(11.5))
                                .foregroundStyle(BrandColor.muted500)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 15)
                        .padding(.vertical, 13)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    if !entries.isEmpty {
                        RowDivider()
                        Button {
                            // #556: Android fires tap() here. Opening a confirm
                            // is an ordinary press — the weight belongs on the
                            // answer, not on the question.
                            Haptics.tap()
                            confirmingClear = true
                        } label: {
                            Text(AppStrings.translate(appLocale, "shell.diagClearEvents"))
                                .font(.golos(13.5, weight: .semibold))
                                .foregroundStyle(BrandColor.coral)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 15)
                                .padding(.vertical, 13)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 24)
            .contentMaxWidth()
        }
        .background(BrandColor.canvas)
        .task {
            entries = DiagnosticsLog.entries()
            crashes = CrashReportStore.all()
        }
        // Ethical friction: clearing is the one destructive thing here, and the
        // events it destroys are the evidence somebody came to this screen for.
        .confirmationDialog(
            AppStrings.translate(appLocale, "shell.diagClearTitle"),
            isPresented: $confirmingClear,
            titleVisibility: .visible
        ) {
            Button(
                AppStrings.translate(appLocale, "shell.diagClearEvents"),
                role: .destructive
            ) {
                // #556: reject(), the same weight Android gives this. A clear
                // is not undoable and the hand should be told so — Haptics.kt's
                // contract is that the feel carries the meaning, not the
                // control's type.
                Haptics.reject()
                DiagnosticsLog.clear()
                entries = []
            }
            // #485: crashes are cleared SEPARATELY and deliberately not by the
            // events button. They are the rarer, more valuable artefact, and a
            // person tidying a noisy event list should not lose the one stack
            // somebody has been waiting for.
            Button(
                AppStrings.translate(appLocale, "shell.diagClearAll"),
                role: .destructive
            ) {
                Haptics.reject()
                DiagnosticsLog.clear()
                CrashReportStore.clear()
                entries = []
                crashes = []
            }
            Button(AppStrings.translate(appLocale, "shell.diagKeep"), role: .cancel) {}
        } message: {
            Text(AppStrings.translate(appLocale, "shell.diagClearBody"))
        }
    }

    private func deviceRow(label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(label)
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted500)
            Spacer(minLength: 0)
            Text(value)
                // Monospaced because every value here is an identifier, a
                // version or a state word, and these get read aloud down a
                // phone line and typed into a search box.
                .font(.scaled(12.5, design: .monospaced))
                .foregroundStyle(BrandColor.ink)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
    }

    /// One crash: when it arrived, what the OS called it, and the top of the
    /// stack. The full stack goes in the shared report rather than on screen —
    /// a phone is the wrong place to read a hundred frames, and the person
    /// looking at this needs to know a crash EXISTS and get it to us.
    private func crashRow(_ crash: CrashReport) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text(crash.signal ?? "crash")
                    .font(.golos(10.5, weight: .bold))
                    .kerning(0.8)
                    .foregroundStyle(BrandColor.destructive)
                Text(shortTime(crash.receivedAt))
                    .font(.scaled(10.5, design: .monospaced))
                    .foregroundStyle(BrandColor.muted400)
                if let version = crash.appVersion {
                    Text(
                        AppStrings.translate(
                            appLocale, "shell.diagBuild", ["version": version]
                        )
                    )
                    .font(.scaled(10.5, design: .monospaced))
                    .foregroundStyle(BrandColor.muted400)
                }
            }
            Text(crash.reason ?? AppStrings.translate(appLocale, "shell.diagNoReason"))
                .font(.scaled(12, design: .monospaced))
                .foregroundStyle(BrandColor.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 15)
        .padding(.vertical, 10)
        .textSelection(.enabled)
    }

    private func eventRow(_ entry: DiagnosticsEntry) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text(entry.category.rawValue)
                    .font(.golos(10.5, weight: .bold))
                    .kerning(0.8)
                    .foregroundStyle(BrandColor.olive)
                Text(shortTime(entry.at))
                    .font(.scaled(10.5, design: .monospaced))
                    .foregroundStyle(BrandColor.muted400)
            }
            Text(entry.detail.map { "\(entry.event)  \($0)" } ?? entry.event)
                .font(.scaled(12, design: .monospaced))
                .foregroundStyle(BrandColor.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 15)
        .padding(.vertical, 10)
        .textSelection(.enabled)
    }

    private func shortTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d HH:mm:ss"
        return formatter.string(from: date)
    }
}

extension DiagnosticsSnapshot {
    /// Everything this build can say about itself, read at the moment the screen
    /// opens.
    ///
    /// `realtimeState` and `pushRegistered` are passed in rather than reached
    /// for: this type is also #253's payload, and a snapshot that reaches into
    /// live singletons cannot be constructed in a test or from a background
    /// support path.
    @MainActor
    static func current(
        realtimeState: String,
        pushRegistered: Bool,
        notificationsAllowed: Bool,
        companyId: String?
    ) -> DiagnosticsSnapshot {
        DiagnosticsSnapshot(
            appVersion: Bundle.main
                .object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            build: Bundle.main
                .object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            systemVersion: UIDevice.current.systemVersion,
            deviceModel: UIDevice.current.model,
            pushRegistered: pushRegistered,
            notificationsAllowed: notificationsAllowed,
            realtimeState: realtimeState,
            companyId: companyId
        )
    }
}
