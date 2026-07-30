import SwiftUI

/// #352 — what a rejected customer reads, and the one thing they do next.
///
/// Mirror of `apps/web/src/components/settings/rejection-notice.tsx` and the
/// Android `RejectionNotice`. `docs/DESIGN.md` G7 has always required
/// *"rejection reason in plain language + 'Fix and resubmit' form"*; the form
/// shipped and the plain language did not, so a customer saw the carrier's own
/// token — `BRAND_LEGAL_NAME_MISMATCH` — followed by a sixteen-field form.
///
/// Each part answers a specific failure, and they are the same on every client:
///
/// - **Two sentences, G10's shape** (*"what happened + what to do"*). The old
///   copy had only the first half, in the carrier's vocabulary.
/// - **A jump to the field**, which matters more on a phone than on the web: the
///   fix form is collapsed behind an "Edit your details" button, so the thing
///   that was wrong was two taps and a scroll away.
/// - **The carrier's own words stay on screen**, demoted, never hidden. When the
///   catalogue does not recognise a reason, that text is all the customer has.
/// - **The wait is stated**, because a second wait of unknown length is where
///   people give up.
/// - **The second rejection offers a person**, alongside the form rather than
///   instead of it.
struct RejectionNotice: View {
    let domain: RejectionDomain
    let reason: String?
    let submissionCount: Int?
    let onGoToField: (String) -> Void

    private var guidance: RejectionGuidance? { explainRejection(domain, reason) }
    private var subject: String { domain == .port ? "transfer" : "registration" }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(
                guidance?.what
                    ?? "The carrier turned down this \(subject) and did not say why in a way we can translate."
            )
            .font(.subheadline)

            Text(
                guidance?.fix
                    ?? "Check the details below against your official registration paperwork, and reply to us if nothing looks wrong."
            )
            .font(.footnote)

            if let reason, !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                // Carrier-authored, unbounded, and frequently one long token.
                // Kept visible so a support conversation can quote the same
                // string the customer is looking at.
                Text("The carrier said: \(reason)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(resubmissionWait(domain))
                .font(.caption2)
                .foregroundStyle(.secondary)

            if guidance?.field != nil || needsHumanHelp(submissionCount) {
                HStack(spacing: 12) {
                    if let field = guidance?.field {
                        Button("Take me to it") { onGoToField(field) }
                            .font(.footnote)
                    }
                    if needsHumanHelp(submissionCount) {
                        let encoded =
                            "My \(subject) keeps getting rejected"
                            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
                            ?? "Rejected"
                        if let url = URL(
                            string: "mailto:support@loonext.com?subject=\(encoded)"
                        ) {
                            Link("Get help from us", destination: url)
                                .font(.footnote)
                        }
                    }
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.red.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
    }
}
