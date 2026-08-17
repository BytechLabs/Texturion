import SwiftUI

/// #233 — everything the workspace has queued, in one place.
///
/// The issue asks for this "so nobody is surprised", and that phrasing is the
/// whole brief. A crew shares one inbox: the owner writing six follow-ups on a
/// Sunday night is invisible to the tech who answers the same customer on
/// Monday morning, and the tech finds out when the customer replies to a
/// message they never saw.
///
/// Design notes, and the principles behind them:
///
/// - **Chunking.** Held rows lift to the top. A held message is the only kind
///   that needs a decision, and mixed into a chronological list it reads as one
///   more thing that is going fine.
/// - **Zen of Clarity.** Who, when, and the words. The reason is the only
///   second line, and only when there is one.
/// - **No ethical friction.** Cancelling something that has not gone is
///   reversible in the only sense that counts, so it is one tap.
///
/// Rows deliberately do NOT offer editing: a body worth rewriting is worth
/// rewriting in the thread it belongs to, where the conversation above it is
/// visible.
///
/// Mirrors apps/web/src/components/scheduled/scheduled-view.tsx and the Android
/// ScheduledSheet.kt.
@MainActor
struct ScheduledSheet: View {
    let rows: [ScheduledMessage]
    let onOpenConversation: @MainActor (String) -> Void
    let onCancel: @MainActor (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    private var held: [ScheduledMessage] { rows.filter(\.isHeld) }
    private var pending: [ScheduledMessage] { rows.filter { !$0.isHeld } }

    var body: some View {
        NavigationStack {
            Group {
                if rows.isEmpty {
                    // Reassurance IS the honest empty answer: the question this
                    // sheet exists to settle is "is something about to go out
                    // that I don't know about", and "no" is a complete reply.
                    ContentUnavailableView(
                        AppStrings.translate(appLocale, "inbox.scheduledEmptyTitle"),
                        systemImage: "calendar.badge.clock",
                        description: Text(
                            ScheduledSend.copyLine(
                                "nothing_scheduled", locale: appLocale
                            )
                        )
                    )
                } else {
                    List {
                        if !held.isEmpty {
                            Section(
                                AppStrings.translate(appLocale, "inbox.scheduledNeedsYou")
                            ) {
                                ForEach(held) { row in
                                    ScheduledSheetRow(row: row, onCancel: onCancel) {
                                        dismiss()
                                        onOpenConversation(row.conversation_id)
                                    }
                                }
                            }
                        }
                        if !pending.isEmpty {
                            Section(
                                AppStrings.translate(appLocale, "inbox.scheduledGoingOut")
                            ) {
                                ForEach(pending) { row in
                                    ScheduledSheetRow(row: row, onCancel: onCancel) {
                                        dismiss()
                                        onOpenConversation(row.conversation_id)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle(AppStrings.translate(appLocale, "inbox.scheduledTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(AppStrings.translate(appLocale, "inbox.done")) { dismiss() }
                }
            }
        }
    }
}

@MainActor
private struct ScheduledSheetRow: View {
    let row: ScheduledMessage
    let onCancel: @MainActor (String) -> Void
    let onOpen: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        // The thread, not a detail screen. A queued text only makes sense
        // beside what the customer last said, and that is one tap away.
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: row.isHeld ? "exclamationmark.triangle" : "clock")
                    .font(.caption)
                    .foregroundStyle(row.isHeld ? NoteAmber.ink : BrandColor.muted500)
                    .padding(.top, 2)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(scheduledRecipient(row, appLocale))
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(BrandColor.ink)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(
                            row.isHeld
                                ? AppStrings.translate(
                                    appLocale, "inbox.scheduledWaiting"
                                )
                                : sendAtOf(row, locale: appLocale)
                        )
                            .font(.caption2)
                            .monospacedDigit()
                            .foregroundStyle(row.isHeld ? NoteAmber.ink : BrandColor.muted500)
                    }
                    Text(row.body)
                        .font(.caption)
                        .foregroundStyle(BrandColor.muted500)
                        .lineLimit(1)
                    // The reason, in the API's own words. Not paraphrased per
                    // surface: two surfaces paraphrasing one sentence is how
                    // they end up disagreeing about why a text did not go.
                    // #228: the key where this build has words for it, the
                    // stored English otherwise.
                    if row.isHeld,
                       let reason = ScheduledSend.holdText(
                           reasonKey: row.held_reason_key,
                           storedEnglish: row.held_reason,
                           locale: appLocale
                       ),
                       !reason.isEmpty {
                        Text(reason)
                            .font(.caption2)
                            .foregroundStyle(NoteAmber.ink)
                    } else if !row.isHeld {
                        Text(ScheduledSend.clockProvenance(row.rung, locale: appLocale))
                            .font(.caption2)
                            .foregroundStyle(BrandColor.muted500)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button(
                AppStrings.translate(appLocale, "common.cancel"),
                role: .destructive
            ) { onCancel(row.id) }
        }
    }
}

/// Who this text is going to.
///
/// The list route embeds the contact, because the workspace view is a list of
/// texts to DIFFERENT people and a list of bodies with no names is the surprise
/// #233 asks us to prevent rather than the answer to it.
func scheduledRecipient(_ row: ScheduledMessage, _ locale: String? = nil) -> String {
    guard let contact = row.conversations?.contacts else {
        return AppStrings.translate(locale, "inbox.scheduledThisConversation")
    }
    let name = contact.name?.trimmingCharacters(in: .whitespaces) ?? ""
    return name.isEmpty ? formatPhone(contact.phone_e164) : name
}
