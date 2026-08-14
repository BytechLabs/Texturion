import SwiftUI

/**
 #301 — where these customers came from, on the home surface.

 Hand-port of `apps/web/src/components/for-you/lead-sources-card.tsx` and
 `LeadSourcesCard.kt`.

 # The coverage row is the design

 #301's fourth Acceptance line — "reporting distinguishes attributed from
 unknown, and never infers silently" — either happens on this panel or does
 not. A ranking built on a third of the conversations can be reordered
 completely by the other two thirds, and an owner acting on it spends real
 money on an artefact.

 So "Don't know" is a ROW, in the same list and on the same bar scale as the
 sources rather than a footnote under them. That is the only presentation in
 which an owner sees it competing with the channels they are about to spend on.

 # Absent rather than empty

 A quiet month renders NOTHING — not a zero, not an encouraging placeholder. A
 workspace that has named no sources gets one sentence about the cheapest way
 to start, because a table whose only row reads "Don't know: 40" is a scolding
 rather than a finding.
 */
struct LeadSourcesCard: View {
    let report: LeadSourceReport?
    /// #540: where "put a source on the numbers you advertise" happens.
    ///
    /// Not optional. A default of nil turns "nobody wired this" into a
    /// silently inert card rather than a compile error, and this is the state
    /// a NEW workspace opens on.
    let onSetUpSources: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        // Loading, or a month in which nothing happened. Silence, not a zero.
        if let report, report.total > 0 {
            // #540: the same heading treatment as the other three measures. Two of
            // the four carried their title inside the card and two above it, which
            // read as two different species of panel in one list.
            VStack(alignment: .leading, spacing: 0) {
            MeasureHeader(AppStrings.translate(appLocale, "inbox.leadSourcesTitle"))
            PaperCard {
                VStack(alignment: .leading, spacing: 0) {

                    // #232: unless the website is answering, in which case
                    // there IS something true to show and "you haven't set any
                    // sources up" would be a reproach aimed at somebody whose
                    // attribution is already working.
                    if report.sources.isEmpty && report.widget == 0 {
                        // Sources exist as a feature and this workspace has
                        // set none up, so every conversation is unknown.
                        Text(AppStrings.translate(appLocale, "inbox.leadSourcesNoneSetUp"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                        // #540: the paragraph tells a new crew what to do and
                        // web has always offered the door to do it. Both phones
                        // printed the instruction and stopped.
                        Button {
                            Haptics.tap()
                            onSetUpSources()
                        } label: {
                            HStack(spacing: 4) {
                                Text(
                                    AppStrings.translate(
                                        appLocale, "inbox.leadSourcesSetOneUp"
                                    )
                                )
                                Image(systemName: "arrow.right")
                                    .font(.scaled(12, weight: .semibold))
                            }
                            .font(.subheadline)
                            .foregroundStyle(BrandColor.olive)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 8)
                    } else {
                        body(for: report)
                    }
                }
                .padding(16)
            }
            }
            .padding(.top, 12)
        }
    }

    @ViewBuilder
    private func body(for report: LeadSourceReport) -> some View {
        let rows = leadSourceRows(report, locale: appLocale)
        let max = ([report.unknown, 1] + rows.map(\.total)).max() ?? 1

        if let headline = leadSourceHeadline(report, locale: appLocale) {
            Text(headline).font(.callout).padding(.top, 6)
        }
        if let note = report.note {
            Text(note).font(.footnote).padding(.top, 8)
        }

        VStack(spacing: 6) {
            ForEach(rows) { row in
                LeadSourceRow(name: row.name, total: row.total, max: max, muted: false)
            }
            if report.unknown > 0 {
                LeadSourceRow(
                    name: AppStrings.translate(appLocale, "inbox.leadSourcesUnknown"),
                    total: report.unknown,
                    max: max,
                    muted: true
                )
            }
        }
        .padding(.top, 10)

        // One sentence per number rather than an "s" glued on: French pluralises
        // the noun AND its article, which a suffix cannot reach.
        Text(
            AppStrings.translate(
                appLocale,
                report.total == 1
                    ? "inbox.leadSourcesFooterOne"
                    : "inbox.leadSourcesFooterMany",
                ["count": String(report.total)]
            )
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.top, 10)
    }
}

private struct LeadSourceRow: View {
    let name: String
    let total: Int
    let max: Int
    let muted: Bool

    /**
     #238 — at a large Dynamic Type setting the BAR gives way, not the words.

     The row carries three things and they are not equal. The name says which
     channel and the number says how much; the bar restates the number as a
     length, for people who read a shape faster than a figure. When the reader's
     setting means all three cannot fit, keeping the decoration and truncating
     the label tells them a proportion about a source they can no longer
     identify — worse than no row at all.

     The Android twin was rendered at 200% and showed exactly that: "Your
     website" became "Your ..." and the count 14 broke across two lines as "1"
     over "4" — the number the row exists to convey, shown as a different
     number. These fixed 104 and 28 point frames are the same ones, so this
     carries the same fix rather than waiting for a device to prove it twice.

     *Applying: Zen of Clarity — when the space runs out, the decorative
     element goes first.*
     */
    @Environment(\.dynamicTypeSize) private var typeSize

    private var roomy: Bool { typeSize <= .large }

    var body: some View {
        HStack(spacing: 10) {
            Text(name)
                .font(.callout)
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(muted ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                // The original 104 at ordinary sizes, untouched — it holds
                // "Word of mouth" and "Don't know" in full, and a proportional
                // width tried on Android was NARROWER and truncated both. A fix
                // for the largest setting must not make the common one worse.
                .frame(maxWidth: roomy ? 104 : .infinity, alignment: .leading)
            if roomy {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color.secondary.opacity(0.18))
                        Capsule()
                            .fill(muted ? Color.secondary.opacity(0.4) : BrandColor.olive.opacity(0.7))
                            .frame(
                                width: geo.size.width * CGFloat(total) / CGFloat(Swift.max(max, 1))
                            )
                    }
                }
                .frame(height: 6)
            }
            Text("\(total)")
                .font(.callout)
                .monospacedDigit()
                // A MINIMUM, not a fixed width: 28 points is narrower than two
                // digits at the largest settings, and a fixed frame folds them.
                .fixedSize()
                .frame(minWidth: 28, alignment: .trailing)
        }
    }
}

/** One row of the table: a source, or the folded tail. */
struct LeadSourceRowValue: Identifiable {
    let name: String
    let total: Int
    var id: String { name }
}

/** How many sources get their own row before the rest are folded together. */
private let leadSourceTopN = 4

/**
 The headline, in words, or nil when no honest one exists.

 Silent when the leading source is under a third of the attributed work: at
 that point "most of your work came from X" is simply false, and the table says
 it better than a wrong sentence would.
 */
/**
 Every channel this window can name, biggest first.

 #232 puts the website in HERE rather than pinning it under the configured
 sources. It is a channel like any other — a workspace whose site brings in most
 of the work should read that at the top of the list, and a row pinned last says
 the opposite by position while its number says otherwise. The server keeps it
 disjoint from `sources` precisely so it can be ranked against them without
 double-counting anybody.

 Same tie-break as the server's and as the other two clients', so equal counts
 do not shuffle between a phone and a laptop looking at the same month.

 `locale` is defaulted rather than required: the two callers below are a view
 that knows the locale and a test that does not care, and a new required
 parameter is how every `#Preview` in a file stops compiling.
 */
struct RankedChannel {
    /// The row label. A title, so it takes a capital.
    let name: String
    /// The same channel inside the headline sentence. "came from Your website"
    /// is the kind of thing only a rendered picture shows you; a source the
    /// workspace named themselves reads the same either way.
    let sentenceName: String
    let total: Int
}

func leadSourceChannels(
    _ report: LeadSourceReport,
    locale: String = "en"
) -> [RankedChannel] {
    var channels = report.sources.map {
        RankedChannel(name: $0.name, sentenceName: $0.name, total: $0.total)
    }
    if report.widget > 0 {
        channels.append(
            RankedChannel(
                name: AppStrings.translate(locale, "inbox.leadSourcesWebsite"),
                sentenceName: AppStrings.translate(locale, "inbox.leadSourcesWebsiteInline"),
                total: report.widget
            )
        )
    }
    return channels.sorted {
        $0.total != $1.total ? $0.total > $1.total : $0.name < $1.name
    }
}

func leadSourceHeadline(
    _ report: LeadSourceReport,
    locale: String = "en"
) -> String? {
    guard let top = leadSourceChannels(report, locale: locale).first else { return nil }
    let attributed = report.total - report.unknown
    guard attributed > 0 else { return nil }
    guard Double(top.total) / Double(attributed) >= 0.34 else { return nil }
    return "Most of the work you can account for came from \(top.sentenceName) — "
        + "\(top.total) of \(attributed)."
}

/** The rows to render: the top few, then everything else as one. */
func leadSourceRows(
    _ report: LeadSourceReport,
    locale: String = "en"
) -> [LeadSourceRowValue] {
    let ranked = leadSourceChannels(report, locale: locale)
    var rows = ranked.prefix(leadSourceTopN).map {
        LeadSourceRowValue(name: $0.name, total: $0.total)
    }
    let rest = ranked.dropFirst(leadSourceTopN)
    if !rest.isEmpty {
        rows.append(
            LeadSourceRowValue(
                name: "\(rest.count) more",
                total: rest.reduce(0) { $0 + $1.total }
            )
        )
    }
    return rows
}
