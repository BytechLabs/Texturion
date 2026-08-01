import Foundation
import SwiftUI

/// #321 — what shipped, in the app.
///
/// # A hand port of `packages/shared/src/whats-new.ts`
///
/// The entries and the marker rule are shared because three clients show them,
/// and a badge that lights on one client and not another is worse than no
/// badge. `WhatsNewPortTests` pins the rule; the prose is checked by eye
/// against the TypeScript because prose cannot be asserted.
///
/// # The two rules that make the marker worth having
///
/// It does NOT light for a workspace that just arrived. Somebody who signed up
/// today has no memory of missing anything, and a badge advertising six months
/// of changes is one they learn to ignore immediately.
///
/// The seen-stamp happens when the section OPENS, not when the app launches.
/// Stamping on launch would clear the marker for somebody who never looked,
/// which is the one way to make the feature actively misleading.

struct WhatsNewEntry: Identifiable, Sendable {
    /// ISO date the change reached customers.
    let date: String
    let title: String
    let body: String

    var id: String { "\(date)-\(title)" }
}

/// Newest first. Mirrors `WHATS_NEW` in packages/shared.
///
/// No links on this client, deliberately: the settings detail cannot deep-link
/// into a tab without a router it does not have, and a link that goes nowhere
/// is worse than a sentence saying where to look. The web page carries them.
let whatsNewEntries: [WhatsNewEntry] = [
    WhatsNewEntry(
        date: "2026-08-01",
        title: "Save the filters you use every morning",
        body: """
            Arrange the inbox how you want it, name it, and it is one tap away \
            tomorrow. Share one with the crew and everybody opens the same list.
            """
    ),
    WhatsNewEntry(
        date: "2026-08-01",
        title: "See how many quotes turned into work",
        body: """
            Your home screen now shows how many quotes you sent, how many you \
            won, and how many are still waiting on an answer.
            """
    ),
    WhatsNewEntry(
        date: "2026-07-25",
        title: "Voicemails are written down",
        body: """
            A missed call leaves a voicemail you can read at a red light \
            instead of listening to it. It is searchable like any other message.
            """
    ),
    WhatsNewEntry(
        date: "2026-07-24",
        title: "Lou drafts the reply for you",
        body: """
            Lou reads the thread and offers a reply you can edit before it \
            goes. You send it, or you ignore it; nothing is sent on your behalf.
            """
    ),
    WhatsNewEntry(
        date: "2026-07-12",
        title: "Answer calls in the app",
        body: """
            Calls to your business number ring your whole crew right here. \
            Pick up, put someone on hold, or hand the call to a teammate.
            """
    ),
]

/// The newest entry's date, which is what the marker compares against.
func latestWhatsNewDate(_ entries: [WhatsNewEntry] = whatsNewEntries) -> String {
    entries.reduce("") { newest, entry in entry.date > newest ? entry.date : newest }
}

/// Is there something this member has not seen?
///
/// `lastSeen` is nil until they open the section. The fallback is when the
/// WORKSPACE arrived, and where neither is known the answer is NO — a wrong
/// badge costs trust in every later one.
func hasUnseenWhatsNew(
    lastSeen: String?,
    joinedAt: String?,
    entries: [WhatsNewEntry] = whatsNewEntries
) -> Bool {
    let latest = latestWhatsNewDate(entries)
    if latest.isEmpty { return false }
    guard let floor = lastSeen ?? joinedAt else { return false }
    return latest > String(floor.prefix(10))
}

/// Entries newer than the floor, for the list to mark as new.
func unseenWhatsNewEntries(
    lastSeen: String?,
    joinedAt: String?,
    entries: [WhatsNewEntry] = whatsNewEntries
) -> [WhatsNewEntry] {
    guard let floor = lastSeen ?? joinedAt else { return [] }
    let cut = String(floor.prefix(10))
    return entries.filter { $0.date > cut }
}

private let whatsNewSeenKey = "loonext.whats-new.seen-at"

/// The stored instant, or nil when they have never opened it on this device.
func readWhatsNewSeen() -> String? {
    let raw = UserDefaults.standard.string(forKey: whatsNewSeenKey)
    // Anything that is not ISO-ish is treated as never seen: a corrupted value
    // must not silently suppress the marker forever.
    guard let raw, raw.count >= 10 else { return nil }
    let head = raw.prefix(10)
    let shaped = head.filter { $0.isNumber || $0 == "-" }.count == 10
    return shaped ? raw : nil
}

/// Stamp now. Called when the section opens, never when the app launches.
func markWhatsNewSeen(_ now: Date = Date()) {
    UserDefaults.standard.set(
        ISO8601DateFormatter().string(from: now),
        forKey: whatsNewSeenKey
    )
}

/// The section body.
///
/// *Applying: Zen of Clarity (a dated list, one line and two sentences each),
/// and Chunking — the new ones are MARKED rather than split into a second list,
/// which would be a decision the reader has to make for no reason.*
struct WhatsNewSectionView: View {
    let joinedAt: String?

    /// Captured before the stamp in `onAppear`, so entries stay marked while
    /// they are being read.
    @State private var seenAtOpen: String? = readWhatsNewSeen()

    private var unseenTitles: Set<String> {
        Set(unseenWhatsNewEntries(lastSeen: seenAtOpen, joinedAt: joinedAt).map(\.title))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Everything here has already shipped and is in the product now.")
                .font(.golos(13, weight: .medium))
                .foregroundStyle(BrandColor.muted700)

            ForEach(whatsNewEntries) { entry in
                PaperCard {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(entry.date)
                                .font(.golos(11, weight: .medium))
                                .foregroundStyle(BrandColor.muted700)
                            if unseenTitles.contains(entry.title) {
                                Text("New")
                                    .font(.golos(11, weight: .semibold))
                                    .foregroundStyle(BrandColor.paper)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 2)
                                    .background(BrandColor.ink, in: Capsule())
                            }
                        }
                        Text(entry.title)
                            .font(.golos(15, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                        Text(entry.body)
                            .font(.golos(13.5))
                            .foregroundStyle(BrandColor.muted700)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(16)
                }
            }

            Text(
                """
                Smaller repairs ship most days and are not listed. If you \
                reported something and want to know where it got to, ask us on \
                the Help page.
                """
            )
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted700)
        }
        .onAppear { markWhatsNewSeen() }
    }
}
