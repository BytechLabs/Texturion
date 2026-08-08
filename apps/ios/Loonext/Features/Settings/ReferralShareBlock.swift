import SwiftUI
import UIKit

/// #288 — one tap, with a message they can edit.
///
/// ## What this had to achieve
///
/// iOS had NO referral surface at all: the mechanism, the accounting and the
/// payout all shipped with #399, and the only client that could reach any of it
/// was the web app. #288 asks for "one tap, a pre-written message they can edit,
/// sent from the phone they are already holding" — and the phone was the one place
/// a contractor could not do it. A crew lead thinking of somebody to tell is
/// standing at a supply counter, not sitting at a laptop.
///
/// ## What it does not do
///
/// The sheet is the system's. The draft goes to the owner's own Messages, WhatsApp
/// or Mail, on their own number, and they pick the recipient — we never see who,
/// and nothing leaves through the carrier. That boundary is why this is not the
/// mass-texting D4 and D11 exclude: the product supplies the words, the person
/// supplies the distribution.
///
/// ## Why the link is not in the text field
///
/// The first owner to rewrite this in their own words would delete it, send it,
/// and get nothing for a referral they actually made. `ReferralShare.shareText`
/// appends it, so no version of this can go out without it.
///
/// Applying: Smart Defaults — the draft is written, because an empty box is a form
/// and #288 is explicit that contractors will not fill one in. Zen of Clarity —
/// one primary action, one fallback, and no formatting controls on a text message.
///
/// PARITY. Word-for-word identical copy to web's `referral-share.tsx` and
/// Android's `ReferralShareBlock.kt`; `ReferralShareTests` asserts it against the
/// shared TypeScript.
struct ReferralShareBlock: View {
    let link: String?
    let code: String

    @State private var note = ReferralShare.note
    @State private var copied = false

    private var text: String {
        ReferralShare.shareText(note: note, link: link, code: code)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(ReferralShare.draftLabel)
                .font(.golos(11.5, weight: .medium))
                .foregroundStyle(BrandColor.muted600)

            TextField(ReferralShare.note, text: $note, axis: .vertical)
                .font(.golos(13))
                .textFieldStyle(.roundedBorder)
                .lineLimit(3 ... 8)

            Text("\(ReferralShare.linkNote) \(link ?? code)")
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)

            HStack(spacing: 8) {
                ShareLink(item: text) {
                    Label(ReferralShare.action, systemImage: "square.and.arrow.up")
                        .font(.golos(13, weight: .medium))
                }
                .buttonStyle(.borderedProminent)

                Button {
                    UIPasteboard.general.string = text
                    copied = true
                } label: {
                    Text(copied ? ReferralShare.copied : ReferralShare.copy)
                        .font(.golos(13, weight: .medium))
                }
                .buttonStyle(.bordered)
            }
        }
    }
}
