import SwiftUI

/// #566 — a voicemail transcript, and a way to get it out.
///
/// The founder's ask: *"What about other UX like copying the transcription? By
/// holding? Or something?"* Press-and-hold is exactly right, and it is already
/// this app's gesture for lifting text off a screen — `MessageBubbles` copies a
/// message body from a `.contextMenu`, and `AttachmentsGalleryView` chose the same
/// modifier over a trailing control with the reason written down: *"a thumbnail
/// has no room for a button, long-press is what a phone user already reaches
/// for."* A transcript is the same shape of problem.
///
/// ## Why a view rather than a modifier on four Texts
///
/// The same paragraph was rendered in four places — the call row, the voicemail
/// player, the contact detail's call history, and the thread timeline — each with
/// its own copy of the font and colour, and they had already drifted (12.5pt in
/// three, 12pt in the fourth, two different greys). A gesture added to one would
/// have been a gesture missing from three.
///
/// ## Why this one is silent, when the other two clients say something
///
/// Android posts a toast and web toasts too; this does neither, and that is not
/// an oversight. On those two the gesture ACTS immediately — an Android long-press
/// copies with nothing in between, a web button click likewise — so without a
/// word back, a successful copy is indistinguishable from a missed press. Here a
/// menu opens first and the reader taps a labelled item, so the acknowledgement
/// already happened before anything was copied.
///
/// It is also what every iOS app does. Copy from a context menu in Messages,
/// Mail or Safari and nothing appears. A first attempt at this flipped the label
/// to "Copied" — invisible, because selecting a menu item dismisses the menu that
/// would have shown it.
///
/// ## Why also `.textSelection`
///
/// Copying the whole transcript is the common case; lifting one line out of it —
/// an address, a part number — is the other. `.textSelection(.enabled)` costs
/// nothing and is already used at five sites in this app.
struct VoicemailTranscript: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.golos(12.5))
            // One grey, and specifically muted700: it is byte-identical to
            // Android's `onSurfaceVariant` in BOTH themes (0x5D5D5D light,
            // 0x979797 dark), so the two phones read a transcript the same way.
            //
            // This started as a `prominent` flag switching muted700/muted600 —
            // copied from the web twin, where the flag means the call permalink
            // and changes SIZE as well. On iOS the two greys differ by 8/255 in
            // light and are the same bytes in dark, so it rendered nothing at all
            // while claiming a hierarchy #320 had already decided is carried by
            // size and weight rather than by colour.
            .foregroundStyle(BrandColor.muted700)
            .textSelection(.enabled)
            .contextMenu {
                Button {
                    UIPasteboard.general.string = text
                } label: {
                    Label("Copy transcript", systemImage: "doc.on.doc")
                }
            }
            // A context menu is a long press, which a VoiceOver user never
            // performs — so the action is also published as one they can reach.
            // Without this the gesture does not exist for them at all, which is
            // the complaint #505 opened with, one surface further in.
            .accessibilityAction(named: "Copy transcript") {
                UIPasteboard.general.string = text
            }
    }
}
