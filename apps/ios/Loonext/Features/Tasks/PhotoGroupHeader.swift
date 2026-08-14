import SwiftUI

/// #294 — the line above one visit's photos.
///
/// ## Evaluation
///
/// The task screen's file strip was flat: a job with four site visits looked exactly
/// like a job with one, and nothing said which pictures were the finished work or who
/// took them. Everything needed was already in the data — each file knows the note it
/// arrived on, and a note has a time, an author and now a label.
///
/// ## What binds it
///
/// *Chunking* — one line per visit turns an undifferentiated strip into three or four
/// groups, which is the number a person can hold. The label, the person and the time
/// are one line rather than three, because they answer one question.
///
/// *Zen of Clarity* — the label is a quiet pill, not a coloured banner. Before and
/// after are equally ordinary; neither is a warning.
///
/// *Meaningful Highlights* — the customer's own photos are named as theirs rather than
/// left unattributed, because "who sent this" is the first thing anybody asks of a
/// photo they did not take.
@MainActor
struct PhotoGroupHeader: View {
    let phase: String?
    let at: String
    let addedByUserId: String?
    let fromCustomer: Bool
    let nameOf: (String?) -> String?

    @Environment(\.appLocale) private var appLocale

    private var who: String {
        if fromCustomer {
            return AppStrings.translate(appLocale, "contactsTasks.photosFromCustomer")
        }
        return nameOf(addedByUserId)
            ?? AppStrings.translate(appLocale, "contactsTasks.photosFromCrew")
    }

    var body: some View {
        HStack(spacing: 8) {
            if let phase {
                Text(WorkPhase.label(phase))
                    .font(.golos(11.5, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(BrandColor.canvas, in: Capsule())
            }
            Text(who)
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.ink)
            Text(absoluteTime(at))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
            Spacer(minLength: 0)
        }
        .padding(.top, 6)
    }
}
