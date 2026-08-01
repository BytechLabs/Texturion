import SwiftUI

/// #354 — one period's pipeline, as GET /v1/reports/pipeline returns it.
///
/// Every figure is computed server-side: a win rate computed twice is a win rate
/// that can disagree with itself, and this one is a claim about the customer's
/// own business.
struct PipelineReport: Codable, Sendable {
    @Default<DefaultZero> var quoted: Int
    @Default<DefaultZero> var won: Int
    @Default<DefaultZero> var lost: Int
    /// Quoted, and neither won nor lost yet. The money still outstanding.
    @Default<DefaultZero> var open: Int
    var median_days_to_win: Double?
}

/// Which tag each stage currently IS, so a rename never breaks a link.
struct PipelineStageTag: Codable, Sendable {
    @Default<DefaultEmptyString> var stage: String
    @Default<DefaultEmptyString> var tag_id: String
    @Default<DefaultEmptyString> var name: String
}

enum DefaultEmptyPipelineReport: DefaultCodableProvider {
    static var defaultValue: PipelineReport { PipelineReport() }
}

struct PipelineReportResponse: Codable, Sendable {
    @Default<DefaultZero> var days: Int
    @Default<DefaultEmptyPipelineReport> var current: PipelineReport
    @Default<DefaultEmptyPipelineReport> var previous: PipelineReport
    var win_rate: Int?
    var previous_win_rate: Int?
    /// Nil when there is not enough decided work to say anything honest.
    var insight: String?
    @Default<DefaultEmptyList<PipelineStageTag>> var stages: [PipelineStageTag]
}

/// #354 — the pipeline panel on the home surface.
///
/// # What this has to achieve
///
/// #354 calls the win rate "the first honest business metric this product could
/// show an owner". That last word is the design constraint: an owner does not
/// act on a percentage, they act on "three quotes are still waiting on an
/// answer", which is a Monday morning's work.
///
/// *Applying: Meaningful Highlights & Context — the sentence is the headline and
/// the rate is the figure under it, matching the response-time card above.
/// Chunking — four figures at most. Loss Aversion — the outstanding quotes are
/// money the crew has not been paid yet.*
///
/// # Absent rather than empty
///
/// The card renders NOTHING when nothing has been quoted. A zero state would
/// tell a crew who have not sent a quote that they have a 0% win rate, which is
/// untrue and discouraging in the same breath. The server is silent below five
/// decided jobs for the same reason: a 100% rate off two quotes is noise
/// presented as an achievement.
///
/// # Every string is a computed property with an explicit type
///
/// Deliberately, and the reason is written down one file over: an interpolated
/// nested ternary in this view's neighbour made swiftc's type checker give up on
/// the whole body. iOS compiles only in CI here, so a body that cannot be
/// type-checked costs a full round trip to discover.
struct PipelineCard: View {
    /// Nil while it loads. The card says nothing rather than showing zeroes.
    let report: PipelineReportResponse?

    private var headline: String {
        guard let report else { return "" }
        if let insight = report.insight { return insight }
        let quoted: Int = report.current.quoted
        let noun: String = quoted == 1 ? "quote" : "quotes"
        return "\(quoted) \(noun) sent. Too early to call a win rate."
    }

    /// How the rate moved, or nil when there is nothing to compare against.
    ///
    /// Nil rather than zero when a side is missing: "unchanged" and "we do not
    /// know yet" are different facts and only one of them is reassuring.
    private var delta: Int? {
        guard let rate = report?.win_rate, let before = report?.previous_win_rate else {
            return nil
        }
        let moved: Int = rate - before
        return moved == 0 ? nil : moved
    }

    private var deltaLabel: String {
        guard let delta else { return "" }
        let sign: String = delta > 0 ? "+" : ""
        return "\(sign)\(delta) pts"
    }

    var body: some View {
        if let report, report.current.quoted > 0 {
            PaperCard {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Quotes, last 30 days")
                                .font(.golos(12.5, weight: .medium))
                                .foregroundStyle(BrandColor.muted700)
                            Text(headline)
                                .font(.golos(15, weight: .medium))
                                .foregroundStyle(BrandColor.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                        if let rate = report.win_rate {
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(rate)%")
                                    .font(.golos(24, weight: .semibold))
                                    .foregroundStyle(BrandColor.ink)
                                if delta != nil {
                                    Text(deltaLabel)
                                        .font(.golos(11, weight: .medium))
                                        .foregroundStyle(BrandColor.muted700)
                                }
                            }
                        }
                    }
                    HStack(alignment: .top, spacing: 16) {
                        pipelineFigure("Quoted", report.current.quoted)
                        pipelineFigure("Won", report.current.won)
                        pipelineFigure("Still out", report.current.open)
                    }
                }
                .padding(16)
            }
        }
    }

    private func pipelineFigure(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.golos(11, weight: .medium))
                .foregroundStyle(BrandColor.muted700)
            Text("\(value)")
                .font(.golos(20, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
