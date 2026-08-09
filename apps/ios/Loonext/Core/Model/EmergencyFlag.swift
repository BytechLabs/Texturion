import SwiftUI

/// #414 / #565 — is this thread still flagged urgent?
///
/// The hand-port of `packages/shared/src/emergency-flag.ts`, asserted against it
/// by `EmergencyFlagTests`.
///
/// One rule, because it is now asked in two places on this client — the inbox row
/// and the thread header — and the same two on each of the others. It was written
/// out three times before the shared module existed and the fourth copy is what
/// prompted it: a predicate that spreads by copying is how "is anything filtered"
/// came to disagree with itself across the same three clients (#548).
///
/// ## Why closing is what clears it
///
/// A badge that never clears is decoration. Closing the thread is the product's
/// existing word for "handled", so it is the honest thing to clear on: no second
/// notion of resolved to keep in step, and no timer quietly deciding an emergency
/// stopped mattering while somebody was still driving to it.
///
/// ## Why it is not "was it ever urgent"
///
/// `emergency_at` is a timestamp and is never cleared — the timeline keeps the
/// fact that this happened. The BADGE is about now.
///
/// Takes the two fields rather than a model, because the two models that carry
/// them (`Conversation`/`ConversationListItem` for the list, `ConversationDetail`
/// for the thread) share no protocol, and inventing one for two optional strings
/// would be worse than passing them.
func isConversationFlaggedUrgent(emergencyAt: String?, closedAt: String?) -> Bool {
    emergencyAt != nil && closedAt == nil
}

/// The word on the mark, in one place so the inbox and the thread cannot drift
/// into saying different things about the same thread. Upper-cased by the badge's
/// own styling — a screen reader should say "Urgent", not spell it.
let urgentBadgeLabel = "Urgent"

/// #414: the one row state worth breaking the row's own visual rhythm for.
///
/// A fourth quiet glyph beside the attachment clip and the unread dot would blend
/// into that rhythm, which is the opposite of what this state needs — the whole
/// point is to be found at a glance, at 11pm, by someone a push notification just
/// woke.
///
/// #565: extracted from the inbox row, where it was inline markup, because the
/// thread header needs the same mark. Somebody arriving from that notification
/// lands on the thread, and the thread was the one screen that did not say why.
/// Two drawings of one mark would be two things to keep in step — and this badge
/// exists precisely so the state is recognised without being read.
struct UrgentBadge: View {
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.scaled(8.5, weight: .bold))
            Text(urgentBadgeLabel.uppercased())
                .font(.golos(9.5, weight: .bold))
        }
        .foregroundStyle(BrandColor.destructive)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(BrandColor.destructiveContainer, in: Capsule())
        .accessibilityLabel(urgentBadgeLabel)
    }
}
