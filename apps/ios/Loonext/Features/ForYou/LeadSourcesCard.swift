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

    var body: some View {
        // Loading, or a month in which nothing happened. Silence, not a zero.
        if let report, report.total > 0 {
            PaperCard {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Where your customers come from")
                        .font(.subheadline.weight(.medium))

                    if report.sources.isEmpty {
                        // Sources exist as a feature and this workspace has
                        // set none up, so every conversation is unknown.
                        Text(
                            "You haven't told us yet. Put a source on the numbers you "
                                + "advertise — the one on the truck, the one in the ad — and "
                                + "every call and text to them is counted from then on, with "
                                + "nobody tapping anything."
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                    } else {
                        body(for: report)
                    }
                }
                .padding(16)
            }
            .padding(.top, 12)
        }
    }

    @ViewBuilder
    private func body(for report: LeadSourceReport) -> some View {
        let rows = leadSourceRows(report)
        let max = ([report.unknown, 1] + rows.map(\.total)).max() ?? 1

        if let headline = leadSourceHeadline(report) {
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
                    name: "Don't know",
                    total: report.unknown,
                    max: max,
                    muted: true
                )
            }
        }
        .padding(.top, 10)

        Text(
            "Last 30 days · \(report.total) conversation"
                + (report.total == 1 ? "" : "s")
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

    var body: some View {
        HStack(spacing: 10) {
            Text(name)
                .font(.callout)
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(muted ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                .frame(width: 104, alignment: .leading)
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
            Text("\(total)")
                .font(.callout)
                .monospacedDigit()
                .frame(width: 28, alignment: .trailing)
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
func leadSourceHeadline(_ report: LeadSourceReport) -> String? {
    guard let top = report.sources.first else { return nil }
    let attributed = report.total - report.unknown
    guard attributed > 0 else { return nil }
    guard Double(top.total) / Double(attributed) >= 0.34 else { return nil }
    return "Most of the work you can account for came from \(top.name) — "
        + "\(top.total) of \(attributed)."
}

/** The rows to render: the top few, then everything else as one. */
func leadSourceRows(_ report: LeadSourceReport) -> [LeadSourceRowValue] {
    var rows = report.sources.prefix(leadSourceTopN).map {
        LeadSourceRowValue(name: $0.name, total: $0.total)
    }
    let rest = report.sources.dropFirst(leadSourceTopN)
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
