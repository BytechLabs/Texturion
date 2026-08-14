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
    /// #228: the CATALOGUE KEY, not the words — the same choice `WhatsNew.kt`
    /// made, field for field.
    ///
    /// The list below is a top-level `let` built before anybody has a locale,
    /// so an entry holding its own sentence could only ever hold one language's.
    /// Everything that reads these — the unseen marker, the port tests — works
    /// on the date and on identity, never on the prose.
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
        title: "settingsMore.whatsNewSavedViewsTitle",
        body: "settingsMore.whatsNewSavedViewsBody"
    ),
    WhatsNewEntry(
        date: "2026-08-01",
        title: "settingsMore.whatsNewQuotesTitle",
        body: "settingsMore.whatsNewQuotesBody"
    ),
    WhatsNewEntry(
        date: "2026-07-25",
        title: "settingsMore.whatsNewVoicemailTitle",
        body: "settingsMore.whatsNewVoicemailBody"
    ),
    WhatsNewEntry(
        date: "2026-07-24",
        title: "settingsMore.whatsNewDraftsTitle",
        body: "settingsMore.whatsNewDraftsBody"
    ),
    WhatsNewEntry(
        date: "2026-07-12",
        title: "settingsMore.whatsNewCallsTitle",
        body: "settingsMore.whatsNewCallsBody"
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    /// Keyed on the entry's `title`, which is now its catalogue KEY — so the
    /// marker survives a translation the way it never would have survived a
    /// comparison of prose.
    private var unseenTitles: Set<String> {
        Set(unseenWhatsNewEntries(lastSeen: seenAtOpen, joinedAt: joinedAt).map(\.title))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(t("settingsMore.whatsNewIntro"))
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
                                Text(t("settingsMore.whatsNewBadge"))
                                    .font(.golos(11, weight: .semibold))
                                    .foregroundStyle(BrandColor.paper)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 2)
                                    .background(BrandColor.ink, in: Capsule())
                            }
                        }
                        Text(t(entry.title))
                            .font(.golos(15, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                        Text(t(entry.body))
                            .font(.golos(13.5))
                            .foregroundStyle(BrandColor.muted700)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(16)
                }
            }

            Text(t("settingsMore.whatsNewFooter"))
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted700)
        }
        .onAppear { markWhatsNewSeen() }
    }
}
