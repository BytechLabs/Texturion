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
///
/// #228: `locale` is LAST and defaulted on all three of these, so
/// `ResponseTimeCopyTests` — which pins the English word for word against web and
/// Android — keeps calling them unchanged and keeps reading the same sentence.
func responseArcSentence(
    _ report: ResponseTimeReport,
    _ locale: String? = nil
) -> String? {
    guard let direction = ResponseTimeFormat.arcDirection(report.improved_by_seconds),
          let then = report.baseline?.median_seconds
    else { return nil }
    let label = ResponseTimeFormat.format(then)
    return direction == "faster"
        ? AppStrings.translate(locale, "inbox.responseArcDown", ["then": label])
        : AppStrings.translate(locale, "inbox.responseArcUp", ["then": label])
}

/// Why there is no arc yet, said plainly rather than left blank.
func responseNoArcReason(_ report: ResponseTimeReport, _ locale: String? = nil) -> String {
    switch report.baseline_unavailable {
    case "too_new":
        return AppStrings.translate(locale, "inbox.responseNoArcTooNew")
    case "no_answered_leads":
        return AppStrings.translate(locale, "inbox.responseNoArcNoLeads")
    default:
        // A baseline exists and the change is under a minute: the same
        // performance measured twice, which is not a story.
        return AppStrings.translate(locale, "inbox.responseNoArcSame")
    }
}

/// "2 leads nobody answered" — singular when it is one, because it often is.
func responseUnansweredLine(_ count: Int, _ locale: String? = nil) -> String {
    count == 1
        ? AppStrings.translate(locale, "inbox.responseUnansweredOne")
        : AppStrings.translate(
            locale, "inbox.responseUnansweredMany", ["count": String(count)]
        )
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
    /// #228. Every sentence on this card now comes from the catalogue.
    /// `response-time-parity.test.ts` reads the Swift card AND
    /// `Core/I18n/InboxStrings.swift` for iOS, so the wording is still held word
    /// for word against web and Android — it just lives where a translator can
    /// find it.
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // #540: the SHARED heading, not a second copy of it. Two of the
            // four measures inlined their own, which is how one screen ends up
            // with two species of panel and a list nobody can put a finger on.
            MeasureHeader(AppStrings.translate(appLocale, "inbox.responseTimeTitle")) {
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

            PaperCard {
                if let report {
                    if report.leads == 0 {
                        // Not a zero. A workspace with no new leads has no
                        // response time, and "0 sec" would read as instant
                        // service.
                        Text(
                            AppStrings.translate(
                                appLocale,
                                "inbox.responseNoLeads",
                                ["days": String(days)]
                            )
                        )
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted600)
                        .padding(14)
                    } else {
                        content(for: report)
                    }
                } else {
                    Text(AppStrings.translate(appLocale, "inbox.responseLoading"))
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
                // #540: how much of the week actually got answered, as a shape.
                // The laptop has had this since the dashboard overhaul and the
                // phones did not, which read as two different products. Absent
                // when there were no new customers in the window, because an
                // empty ring beside a dash is a picture of nothing.
                if report.leads > 0 {
                    ProportionRing(
                        value: Double(report.answered),
                        total: Double(report.leads),
                        label: AppStrings.translate(
                            appLocale,
                            "inbox.responseRingAria",
                            [
                                "answered": String(report.answered),
                                "leads": String(report.leads),
                            ]
                        ),
                        color: BrandColor.olive,
                        // #540: the same mark web draws — 40, with the count
                        // inside it. At 20 the arc is an icon, and there is no
                        // room for the figure that says what it is counting.
                        size: 40,
                        centre: String(report.answered)
                    )
                }
                Image(systemName: "clock")
                    .font(.scaled(12, weight: .medium))
                    .foregroundStyle(BrandColor.muted500)
                Text(ResponseTimeFormat.format(report.median_seconds))
                    .font(.golos(24, weight: .semibold))
                    .monospacedDigit()
                Text(AppStrings.translate(appLocale, "inbox.responseToAnswer"))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
            }

            if let arc = responseArcSentence(report, appLocale) {
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
                Text(responseNoArcReason(report, appLocale))
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
                    Text(responseUnansweredLine(report.unanswered, appLocale))
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
                AppStrings.translate(appLocale, "inbox.responseUnansweredHint")
            )
        }

        Divider().overlay(BrandColor.muted250)
        Button {
            open.toggle()
        } label: {
            // #540: a chevron, so the one control on this card that expands
            // does not look like the copy above it — and the label comes
            // from the catalogue, because this read "Details" in English to
            // a French crew while Android and web both translated it.
            HStack(spacing: 0) {
                // Two literal calls rather than a ternary INSIDE translate:
                // check-ios-catalogue-keys reads the literal argument, so a
                // key chosen at runtime is invisible to it — the guard would
                // never notice these going missing.
                Text(open
                    ? AppStrings.translate(appLocale, "inbox.responseHideDetails")
                    : AppStrings.translate(appLocale, "inbox.responseDetails"))
                    .font(.golos(11.5, weight: .medium))
                    .foregroundStyle(BrandColor.muted600)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.down")
                    .font(.scaled(11, weight: .semibold))
                    .foregroundStyle(BrandColor.muted600)
                    // Points down when closed and up when open, so the glyph
                    // says which way the control goes.
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)

        if open {
            Divider().overlay(BrandColor.muted250)
            VStack(alignment: .leading, spacing: 0) {
                detailRow(
                    AppStrings.translate(appLocale, "inbox.responseSlowest"),
                    ResponseTimeFormat.format(report.p90_seconds)
                )
                detailRow(
                    AppStrings.translate(
                        appLocale,
                        "inbox.responseDuringHours",
                        ["count": String(report.business_hours.leads)]
                    ),
                    ResponseTimeFormat.format(report.business_hours.median_seconds)
                )
                detailRow(
                    AppStrings.translate(
                        appLocale,
                        "inbox.responseAfterHours",
                        ["count": String(report.after_hours.leads)]
                    ),
                    ResponseTimeFormat.format(report.after_hours.median_seconds)
                )
                // #482: which line is letting people down. Slowest first, and
                // present only when there is more than one to compare.
                ForEach(report.by_number ?? []) { number in
                    detailRow(
                        AppStrings.translate(
                            appLocale,
                            "inbox.responseByNumber",
                            [
                                "number": formatPhone(number.number_e164),
                                "count": String(number.leads - number.answered),
                            ]
                        ),
                        ResponseTimeFormat.format(number.median_seconds)
                    )
                }
                if let members = report.by_member {
                    ForEach(members) { member in
                        detailRow(
                            AppStrings.translate(
                                appLocale,
                                "inbox.responseByMember",
                                ["count": String(member.answered)]
                            ),
                            ResponseTimeFormat.format(member.median_seconds)
                        )
                    }
                }
                if report.split_truncated {
                    // Said out loud. A cap that reports nothing reads as "we
                    // looked at everything".
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "inbox.responseSplitTruncated",
                            [
                                "limit": String(report.split_row_limit),
                                "total": String(report.leads),
                            ]
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
