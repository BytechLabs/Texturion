import SwiftUI

/// #310 — the waiting room, made into somewhere.
///
/// A tradesperson signs up at 9pm on a Sunday because they are fed up with
/// missing jobs, and we say "come back in a few days" while 10DLC registration
/// clears. The reason people leave is not the wait — it is that "pending" with
/// no visible movement is indistinguishable from broken.
///
/// Three things, and the order is the point: show the wait working, lead with
/// what already works (calls, from day one — a workspace that spends the wait
/// TAKING CALLS has already adopted the product), then sequence the setup that
/// does not depend on approval.
///
/// Ported 1:1 in behaviour from web's `while-you-wait.tsx` and Android's
/// `WhileYouWait.kt`; the copy comes from the shared derivation, so two devices
/// cannot describe the same wait differently.
struct WhileYouWait: View {
    let company: CompanyView?
    var onOpenSettings: ((String) -> Void)?

    private var brand: String? { company?.registration.brand?.status }
    private var campaign: String? { company?.registration.campaign?.status }

    var body: some View {
        // Only while the wait is genuinely on the carriers. A workspace we are
        // waiting ON gets nothing here — pointing it at setup work would point
        // away from the thing actually blocking it.
        if company != nil, isWaitingOnRegistration(brand: brand, campaign: campaign) {
            let progress = registrationProgress(brand: brand, campaign: campaign)

            VStack(alignment: .leading, spacing: 4) {
                Text(progress.title)
                    .font(.subheadline.weight(.semibold))
                Text(progress.next)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                // The bar marks steps BEHIND you, not time remaining — a
                // countdown we cannot honour is worse than none. Never 0: a bar
                // at zero for four days is the spinner this replaces.
                ProgressView(value: Double(progress.percent) / 100.0)
                    .padding(.top, 8)
                if let expected = progress.expected {
                    Text(expected)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                // What already works. FIRST, not as a footnote.
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "phone")
                        .font(.footnote)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Calls already work")
                            .font(.subheadline)
                        Text(
                            "Your number rings, takes voicemail, and texts back anyone "
                                + "you miss. None of that waits on the carriers."
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                }
                .padding(.top, 12)

                // Three, not the whole settings surface.
                setupStep("Bring your customers in", "contacts")
                setupStep("Invite your crew", "team")
                setupStep("Set your hours and greeting", "hours")
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    /// One thing worth doing now.
    ///
    /// Deliberately NOT a checkbox. Completion would need a definition of
    /// "enough contacts" we do not have, and a checklist that stays unticked
    /// while somebody has plainly done the work is its own small insult.
    @ViewBuilder
    private func setupStep(_ label: String, _ section: String) -> some View {
        Button {
            onOpenSettings?(section)
        } label: {
            HStack {
                Text(label)
                    .font(.subheadline)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 6)
    }
}
