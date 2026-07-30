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
    @State private var confirmingClear = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 13) {
                ScreenTitle(text: "Diagnostics")

                SectionHeader(label: "Device")
                PaperCard {
                    ForEach(Array(snapshot.rows.enumerated()), id: \.offset) { index, row in
                        if index > 0 { RowDivider() }
                        deviceRow(label: row.label, value: row.value)
                    }
                }

                SectionHeader(label: "Recent events", count: entries.count)
                PaperCard {
                    if entries.isEmpty {
                        Text("Nothing recorded on this device.")
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

                // The point of the screen is getting this OFF the device, so the
                // share action is a full-width row rather than a toolbar button
                // somebody has to find. ShareLink hands the same text
                // #253's support reporting will send.
                PaperCard {
                    ShareLink(
                        item: DiagnosticsReport.text(snapshot: snapshot, entries: entries)
                    ) {
                        HStack(spacing: 12) {
                            Image(systemName: "square.and.arrow.up")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(BrandColor.muted500)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Share everything")
                                    .font(.golos(13.5, weight: .semibold))
                                    .foregroundStyle(BrandColor.ink)
                                Text("Device facts and recent events in one message")
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
                            confirmingClear = true
                        } label: {
                            Text("Clear events")
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
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(BrandColor.canvas)
        .task { entries = DiagnosticsLog.entries() }
        // Ethical friction: clearing is the one destructive thing here, and the
        // events it destroys are the evidence somebody came to this screen for.
        .confirmationDialog(
            "Clear recorded events?",
            isPresented: $confirmingClear,
            titleVisibility: .visible
        ) {
            Button("Clear", role: .destructive) {
                DiagnosticsLog.clear()
                entries = []
            }
            Button("Keep", role: .cancel) {}
        } message: {
            Text("This is the only copy. Share it first if somebody asked for it.")
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
                .font(.system(size: 12.5, design: .monospaced))
                .foregroundStyle(BrandColor.ink)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
    }

    private func eventRow(_ entry: DiagnosticsEntry) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text(entry.category.rawValue)
                    .font(.golos(10.5, weight: .bold))
                    .kerning(0.8)
                    .foregroundStyle(BrandColor.olive)
                Text(shortTime(entry.at))
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(BrandColor.muted400)
            }
            Text(entry.detail.map { "\(entry.event)  \($0)" } ?? entry.event)
                .font(.system(size: 12, design: .monospaced))
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
