import SwiftUI

/// #239 — the response-time panel, Paper & Olive.
///
/// WHAT IT HAS TO ACHIEVE, before layout. The number is not the point; the ARC
/// is. "You answer in 4 minutes — down from 3 hours when you started" is the
/// sentence a contractor repeats to another contractor, and the reason they do not
/// churn. A panel leading with a bare median leads with the least persuasive thing
/// it knows.
///
/// Applying: Meaningful Highlights & Context — never just show the stat; package
/// it into a highlight the owner feels. Chunking — four things at most, with the
/// hours split and p90 behind disclosure. Loss Aversion — the unanswered leads are
/// named as leads nobody answered, because a metric that only congratulates is one
/// nobody acts on.
///
/// PARITY. Word-for-word identical copy to web's `response-time-card.tsx` and
/// Android's `ResponseTimeCard.kt`; `ResponseTimeCopyTests` asserts the sentences
/// so a crew comparing the phone and the laptop cannot read two different numbers
/// for the same fortnight.

/// The arc sentence, or nil when there is no arc worth drawing.
func responseArcSentence(_ report: ResponseTimeReport) -> String? {
    guard let direction = ResponseTimeFormat.arcDirection(report.improved_by_seconds),
          let then = report.baseline?.median_seconds
    else { return nil }
    let label = ResponseTimeFormat.format(then)
    return direction == "faster"
        ? "Down from \(label) when you started"
        : "Up from \(label) when you started"
}

/// Why there is no arc yet, said plainly rather than left blank.
func responseNoArcReason(_ report: ResponseTimeReport) -> String {
    switch report.baseline_unavailable {
    case "too_new":
        return "Your starting point lands once you have been here a fortnight"
    case "no_answered_leads":
        return "No answered leads in your first two weeks, so there is nothing to compare"
    default:
        // A baseline exists and the change is under a minute: the same
        // performance measured twice, which is not a story.
        return "About the same as when you started"
    }
}

/// "2 leads nobody answered" — singular when it is one, because it often is.
func responseUnansweredLine(_ count: Int) -> String {
    count == 1 ? "1 lead nobody answered" : "\(count) leads nobody answered"
}

struct ResponseTimeCard: View {
    let report: ResponseTimeReport?
    let days: Int
    let onWindow: (Int) -> Void
    /// #508: into the inbox, filtered to the leads this card is counting.
    ///
    /// A `let` with no default, like every other navigation callback here: the
    /// row named the leak and offered no way to act on it while web linked the
    /// same sentence, and a default is what lets that ship (#503).
    let onOpenUnanswered: () -> Void

    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("RESPONSE TIME")
                    .font(.golos(10.5, weight: .bold))
                    .kerning(1.2)
                    .foregroundStyle(BrandColor.muted500)
                Spacer(minLength: 8)
                // Segmented, not a menu: three choices are faster to hit, and the
                // current window stays readable at a glance.
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
                    if report.leads == 0 {
                        // Not a zero. A workspace with no new leads has no
                        // response time, and "0 sec" would read as instant
                        // service.
                        Text(
                            "No new customers texted you in the last \(days) days, "
                                + "so there is nothing to measure yet."
                        )
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted600)
                        .padding(14)
                    } else {
                        content(for: report)
                    }
                } else {
                    Text("Working out your response time…")
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted600)
                        .padding(14)
                }
            }
        }
        .padding(.top, 14)
    }

    @ViewBuilder
    private func content(for report: ResponseTimeReport) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                Image(systemName: "clock")
                    .font(.scaled(12, weight: .medium))
                    .foregroundStyle(BrandColor.muted500)
                Text(ResponseTimeFormat.format(report.median_seconds))
                    .font(.golos(24, weight: .semibold))
                    .monospacedDigit()
                Text("to answer a new customer")
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
            }

            if let arc = responseArcSentence(report) {
                let direction = ResponseTimeFormat.arcDirection(report.improved_by_seconds)
                HStack(spacing: 5) {
                    Image(
                        systemName: direction == "faster"
                            ? "arrow.down.right" : "arrow.up.right"
                    )
                    .font(.scaled(11, weight: .bold))
                    Text(arc)
                        .font(.golos(13, weight: .medium))
                }
                // Olive for the good direction, coral for the wrong one. A
                // workspace that got slower is TOLD — a metric that only reports
                // improvement is one nobody believes.
                .foregroundStyle(direction == "faster" ? BrandColor.olive : BrandColor.coral)
            } else {
                Text(responseNoArcReason(report))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 13)
        .padding(.bottom, 10)

        // #508: the leak, named, and a way to act on it. The chevron is the
        // promise that the row goes somewhere, so it appears only because the
        // destination now exists.
        if report.unanswered > 0 {
            Divider().overlay(BrandColor.muted250)
            Button(action: onOpenUnanswered) {
                HStack(spacing: 8) {
                    Text(responseUnansweredLine(report.unanswered))
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
            .accessibilityHint("Opens the inbox filtered to conversations nobody has answered")
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
                detailRow(
                    "Slowest 10% of answers",
                    ResponseTimeFormat.format(report.p90_seconds)
                )
                detailRow(
                    "During hours (\(report.business_hours.leads))",
                    ResponseTimeFormat.format(report.business_hours.median_seconds)
                )
                detailRow(
                    "After hours (\(report.after_hours.leads))",
                    ResponseTimeFormat.format(report.after_hours.median_seconds)
                )
                // #482: which line is letting people down. Slowest first, and
                // present only when there is more than one to compare.
                ForEach(report.by_number ?? []) { number in
                    detailRow(
                        "\(formatPhone(number.number_e164)) · "
                            + "\(number.leads - number.answered) unanswered",
                        ResponseTimeFormat.format(number.median_seconds)
                    )
                }
                if let members = report.by_member {
                    ForEach(members) { member in
                        detailRow(
                            "Member · \(member.answered) answered",
                            ResponseTimeFormat.format(member.median_seconds)
                        )
                    }
                }
                if report.split_truncated {
                    // Said out loud. A cap that reports nothing reads as "we
                    // looked at everything".
                    Text(
                        "The hours split covers your most recent "
                            + "\(report.split_row_limit) leads; the numbers above it "
                            + "cover all \(report.leads)."
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

    @ViewBuilder
    private func detailRow(_ label: String, _ value: String) -> some View {
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
