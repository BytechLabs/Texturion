import SwiftUI
import UIKit

/// #294 — hand the customer a page with the photos on it.
///
/// ## Evaluation
///
/// The issue names a constraint nobody had written down: the best job documentation
/// is structurally internal-only. A full-resolution photo of a serial plate has to
/// travel as a note, because a text is capped at 1 MB per image and three per
/// message. So "here is everything we did" over MMS means picking three and hoping
/// the compression left something readable. A link does not have that problem.
///
/// ## What binds it
///
/// *Prioritize Intent* — draws nothing until the job HAS photos. An offer to share an
/// empty set is an offer to look unready.
///
/// *Ethical Friction, in proportion* — one press, no dialog. This does put a record of
/// the inside of somebody's home on the public internet, so it is audited and it
/// expires; but the tech pressing it is standing in front of the customer saying "I'll
/// send you the pictures", and a confirmation there is friction on the good path. The
/// undo is what matters, and it is one press too.
///
/// *Zen of Clarity* — the link and one Copy. No share sheet: the crew is about to
/// paste it into the thread they already have open with this customer, which is the
/// whole point of the product.
///
/// *Loss Aversion, honestly* — the expiry is on screen rather than buried, because a
/// customer opening a dead link months later reflects on the business, not on us.
@MainActor
struct ShareJobPhotos: View {
    let taskId: String
    let photoCount: Int
    let mutations: TaskMutations
    let companyId: String
    let onError: @MainActor (String) -> Void

    @State private var link: JobPhotoLink?
    @State private var busy = false

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        // Nothing to share, nothing to offer.
        if photoCount > 0 {
            if let link {
                madeIt(link)
            } else {
                Button {
                    busy = true
                    Task {
                        do {
                            link = try await mutations.shareJobPhotos(
                                companyId: companyId,
                                taskId: taskId
                            )
                        } catch {
                            onError(error.userMessage)
                        }
                        busy = false
                    }
                } label: {
                    Label(
                        AppStrings.translate(
                            appLocale,
                            busy
                                ? "contactsTasks.jobPhotosMakingLink"
                                : "contactsTasks.jobPhotosShare"
                        ),
                        systemImage: "link"
                    )
                    .font(.golos(13))
                }
                .buttonStyle(.bordered)
                .disabled(busy)
                .padding(.top, 8)
            }
        }
    }

    private func madeIt(_ link: JobPhotoLink) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(
                AppStrings.translate(
                    appLocale,
                    "contactsTasks.jobPhotosExpiry",
                    ["when": absoluteTime(link.expires_at)]
                )
            )
            .font(.golos(12.5))
            .foregroundStyle(BrandColor.muted600)

            HStack(spacing: 8) {
                Text(link.url)
                    .font(.golos(12))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    UIPasteboard.general.string = link.url
                } label: {
                    Label(
                        AppStrings.translate(appLocale, "contactsTasks.copy"),
                        systemImage: "doc.on.doc"
                    )
                        .font(.golos(12.5))
                }
                .buttonStyle(.bordered)
            }

            Button {
                busy = true
                Task {
                    do {
                        try await mutations.revokeJobPhotos(
                            companyId: companyId,
                            taskId: taskId
                        )
                        self.link = nil
                    } catch {
                        onError(error.userMessage)
                    }
                    busy = false
                }
            } label: {
                Text(AppStrings.translate(appLocale, "contactsTasks.jobPhotosTurnOff"))
                    .font(.golos(12))
            }
            .buttonStyle(.plain)
            .foregroundStyle(BrandColor.muted600)
            .disabled(busy)
        }
        .padding(12)
        .background(BrandColor.canvas, in: RoundedRectangle(cornerRadius: 12))
        .padding(.top, 8)
    }
}
