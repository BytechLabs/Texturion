import SwiftUI

/// #313 — the satisfaction panel, Paper & Olive, under response time.
///
/// WHAT IT HAS TO ACHIEVE. Response time says how fast the business answers;
/// this says whether that mattered. "Satisfaction alongside response time is the
/// beginnings of an honest picture of how the business is doing" — and a panel
/// that only ever shows a flattering average adds nothing to that pair.
///
/// Applying: Meaningful Highlights & Context — the arc is the headline, not the
/// mean. Loss Aversion — the jobs that needed a call back are named and tappable
/// rather than folded into a satisfaction percentage. Chunking — four things in
/// the primary view, with the distribution and the per-person breakdown behind
/// disclosure.
///
/// PARITY. Word-for-word identical copy to web's `satisfaction-card.tsx` and
/// Android's `SatisfactionCard.kt`; `SatisfactionCopyTests` asserts the
/// sentences.

/// The arc sentence, or nil when there is no arc worth drawing.
func satisfactionArcSentence(_ report: SatisfactionReport) -> String? {
    guard let direction = SatisfactionFormat.arcDirection(report.improved_by),
          let baseline = report.baseline
    else { return nil }
    let then = SatisfactionFormat.format(baseline.average)
    return direction == "better"
        ? "Up from \(then) the month before"
        : "Down from \(then) the month before"
}

/// Why there is no number yet — four different facts, never collapsed into one.
///
/// Saying "no data" for all of them is what makes an owner think the feature is
/// broken when it is working exactly as intended.
func satisfactionGapReason(_ report: SatisfactionReport) -> String {
    if report.asked == 0 {
        return "No finished jobs have been asked about in this window. The question "
            + "goes out a few hours after a job is marked done."
    }
    if report.answered == 0 {
        return "Nobody has answered yet. Most people do not, which is why one answer "
            + "is worth reading rather than counting."
    }
    return "Too few answers to average yet — \(report.answered) of \(report.minimum_sample)"
}

struct SatisfactionCard: View {
    let report: SatisfactionReport?
    let days: Int
    let onWindow: (Int) -> Void
    /// Into the inbox. A `let` with no default, like every other navigation
    /// callback here: a default is what lets an inert row ship (#503).
    let onOpenPoor: () -> Void

    @State private var open = false
    /// #228, and the same arrangement as the card above: the sentences this file
    /// still writes out are the ones `satisfaction-parity.test.ts` reads OUT OF
    /// THIS FILE for iOS. See the note in `ResponseTimeCard`.
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(AppStrings.translate(appLocale, "inbox.satisfactionTitle"))
                    .font(.golos(10.5, weight: .bold))
                    .kerning(1.2)
                    .foregroundStyle(BrandColor.muted500)
                Spacer(minLength: 8)
                // The same control in the same place as the card above it.
                HStack(spacing: 2) {
                    ForEach([7, 30, 90], id: \.self) { option in
                        Button {
                            onWindow(option)
                        } label: {
                            Text("\(option)d")
                                .font(.golos(10.5, weight: .bold))
                                .monospacedDigit()
                                .foregroundStyle(
                                    option == days ? BrandColor.olive : BrandColor.muted400
                                )
                                .padding(4)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 7)

            PaperCard {
                if let report {
                    if report.average == nil {
                        gap(for: report)
                    } else {
                        content(for: report)
                    }
                } else {
                    Text(AppStrings.translate(appLocale, "inbox.satisfactionLoading"))
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted600)
                        .padding(14)
                }
            }
        }
        .padding(.top, 14)
    }

    /// No average, and why.
    ///
    /// The poor count still shows. Two answers is too thin to average but not
    /// too thin to act on, and burying an unhappy customer behind a sample-size
    /// rule would be the panel choosing tidiness over the thing that matters.
    @ViewBuilder
    private func gap(for report: SatisfactionReport) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(satisfactionGapReason(report))
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
            if report.poor > 0 {
                Button(action: onOpenPoor) {
                    HStack(spacing: 8) {
                        Text(SatisfactionFormat.poorRatingLine(report.poor))
                            .font(.golos(13, weight: .medium))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "arrow.right")
                            .font(.scaled(12, weight: .medium))
                            .foregroundStyle(BrandColor.muted500)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
    }

    @ViewBuilder
    private func content(for report: SatisfactionReport) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                // #540: the mark, in place of the star. A star beside a score out
                // of five was decoration — it said "this is a rating", which the
                // words already say. The ring says how far up the scale the month
                // landed, which is the fact a glance wants and cannot get from
                // "4.2" without already knowing the ceiling.
                ProportionRing(
                    value: report.average ?? 0,
                    total: 5,
                    label: "\(SatisfactionFormat.format(report.average)) out of 5, "
                        + "from \(report.answered) answers",
                    color: BrandColor.olive,
                    size: 18
                )
                Text(SatisfactionFormat.format(report.average))
                    .font(.golos(24, weight: .semibold))
                    .monospacedDigit()
                Text("out of 5, from \(report.answered) answers")
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
            }

            if let arc = satisfactionArcSentence(report) {
                let direction = SatisfactionFormat.arcDirection(report.improved_by)
                HStack(spacing: 5) {
                    Image(
                        systemName: direction == "better"
                            ? "arrow.up.right" : "arrow.down.right"
                    )
                    .font(.scaled(11, weight: .bold))
                    Text(arc)
                        .font(.golos(13, weight: .medium))
                }
                // Olive for the good direction, coral for the wrong one. A
                // workspace whose customers are less happy is TOLD.
                .foregroundStyle(direction == "better" ? BrandColor.olive : BrandColor.coral)
            } else {
                Text(
                    report.baseline == nil
                        ? "No month before this one to compare against yet"
                        : "About the same as the month before"
                )
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 13)
        .padding(.bottom, 10)

        if report.poor > 0 {
            Divider().overlay(BrandColor.muted250)
            Button(action: onOpenPoor) {
                HStack(spacing: 8) {
                    Text(SatisfactionFormat.poorRatingLine(report.poor))
                        .font(.golos(13))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "arrow.right")
                        .font(.scaled(12, weight: .medium))
                        .foregroundStyle(BrandColor.muted500)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(
                AppStrings.translate(appLocale, "inbox.satisfactionPoorHint")
            )
        }

        Divider().overlay(BrandColor.muted250)
        Button {
            open.toggle()
        } label: {
            Text(open ? "Hide details" : "Details")
                .font(.golos(11.5, weight: .medium))
                .foregroundStyle(BrandColor.muted600)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
        }
        .buttonStyle(.plain)

        if open {
            Divider().overlay(BrandColor.muted250)
            VStack(alignment: .leading, spacing: 0) {
                ForEach([5, 4, 3, 2, 1], id: \.self) { score in
                    satisfactionDetailRow(
                        score == 1 ? "1 star" : "\(score) stars",
                        "\(report.distribution[String(score)] ?? 0)"
                    )
                }
                satisfactionDetailRow("Asked", "\(report.asked) in \(days) days")

                if let members = report.by_member {
                    ForEach(members) { member in
                        satisfactionDetailRow(
                            "\(member.name ?? "Member") · \(member.answered) answered",
                            member.average == nil
                                ? "Too few answers to average yet"
                                : SatisfactionFormat.format(member.average)
                        )
                    }
                } else {
                    Text(
                        "Per-person scores are off. In a small crew a bad week is "
                            + "noise, so this stays a coaching signal rather than a "
                            + "scoreboard — turn it on in Settings."
                    )
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                    .padding(.top, 6)
                    .padding(.bottom, 4)
                }

                if report.truncated {
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "inbox.satisfactionTruncated",
                            ["count": String(report.row_limit)]
                        )
                    )
                        .font(.golos(10.5))
                        .foregroundStyle(BrandColor.muted500)
                        .padding(.top, 4)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
        }
    }

    /// Its own row rather than reaching into ResponseTimeCard's private one.
    ///
    /// Same look on purpose — these two panels sit together and a different row
    /// metric between them would read as a rendering bug.
    @ViewBuilder
    private func satisfactionDetailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .lastTextBaseline) {
            Text(label)
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
            Spacer(minLength: 12)
            Text(value)
                .font(.golos(13))
                .monospacedDigit()
        }
        .padding(.vertical, 4)
    }
}
