import SwiftUI

/// #233 — what this thread is about to say, before it says it.
///
/// Design notes, and the principles behind them:
///
/// - **It sits with the COMPOSER, not in the message history.** A scheduled
///   message is not a message; it has no delivery status and may never become
///   one. Putting it in the transcript would mean a reader has to check a badge
///   before believing that anything above the fold was actually sent, which is
///   the failure the separate table exists to prevent.
/// - **Zen of Clarity.** One line each, and the strip disappears entirely when
///   nothing is queued — which is almost always. A permanently-present empty
///   panel would cost every reader attention to tell them nothing.
/// - **Disclosure is the point.** A held message says WHY in the API's own
///   words, in the amber this product already uses for "needs a human".
///   `docs/DECISIONS.md` makes that binding: silent disappearance is the one
///   unacceptable option, and a strip showing only a time would be silent about
///   the only state that matters.
/// - **No ethical friction.** Cancelling something that has not gone is
///   reversible in the only sense that counts — you can schedule it again — so
///   it is one tap and a toast, not a confirmation.
///
/// Mirrors apps/web/src/components/thread/scheduled-strip.tsx and the Android
/// ScheduledStrip.kt.
@MainActor
struct ScheduledStrip: View {
    let rows: [ScheduledMessage]
    let onCancel: @MainActor (String) -> Void

    var body: some View {
        // No skeleton and no empty state. This is a strip that is usually
        // absent, and reserving space for it on every thread would be a
        // permanent cost paid for a rare event.
        if !rows.isEmpty {
            VStack(spacing: 4) {
                ForEach(rows) { row in
                    ScheduledStripRow(row: row) { onCancel(row.id) }
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 4)
        }
    }
}

@MainActor
private struct ScheduledStripRow: View {
    let row: ScheduledMessage
    let onCancel: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: row.isHeld ? "exclamationmark.triangle" : "clock")
                .font(.caption)
                .foregroundStyle(row.isHeld ? NoteAmber.ink : BrandColor.muted500)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 2) {
                let lead = row.isHeld
                    ? AppStrings.translate(appLocale, "thread.scheduledWaiting")
                    : sendAtOf(row)
                Text("\(lead) — \(row.body)")
                    .font(.caption)
                    .lineLimit(2)

                // The reason, in the API's own words. Not paraphrased here:
                // three clients paraphrasing one sentence is how one of them
                // ends up saying nothing at all.
                if row.isHeld, let reason = row.held_reason, !reason.isEmpty {
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(NoteAmber.ink)
                } else if !row.isHeld {
                    Text(ScheduledSend.clockProvenance(row.rung))
                        .font(.caption2)
                        .foregroundStyle(BrandColor.muted500)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundStyle(BrandColor.muted500)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                AppStrings.translate(
                    appLocale,
                    "thread.cancelScheduledAria",
                    ["when": sendAtSpokenOf(row)]
                )
            )
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(row.isHeld ? NoteAmber.bg : BrandColor.paper)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(
                            row.isHeld ? NoteAmber.line : BrandColor.insetDeep,
                            lineWidth: 1
                        )
                )
        )
    }
}

/// "Tue, 8:00 AM" in the DESTINATION's zone.
///
/// The zone stored on the row, not this device's: a dispatcher in Toronto
/// looking at a send scheduled for a customer in Vancouver has to see the time
/// that customer will experience, because that is the time the sender chose.
func sendAtOf(_ row: ScheduledMessage) -> String {
    // `parseSnoozeInstant` rather than a formatter written here: PostgREST
    // renders timestamptz with a fractional part only sometimes, and a single
    // ISO8601DateFormatter silently returns nil for the other shape. That
    // helper already carries both, and a scheduled row falling back to
    // "Scheduled" because of a missing `.SSS` would hide the one fact this
    // strip exists to show.
    guard let at = parseSnoozeInstant(row.send_at) else { return "Scheduled" }
    return TwoClocks.bothClocks(theirClock(at, row), mineClock(at))
}

/// The same, spelled out, for VoiceOver.
func sendAtSpokenOf(_ row: ScheduledMessage) -> String {
    guard let at = parseSnoozeInstant(row.send_at) else { return "Scheduled" }
    return TwoClocks.bothClocksSpoken(theirClock(at, row), mineClock(at))
}

/// #539: the customer's clock, and this device's, so the row cannot be misread.
///
/// This used to render the destination's clock with nothing marking it, so a
/// dispatcher in Toronto looking at a send queued for a customer in Vancouver read
/// "8:00 AM" as their own eight o'clock and was three hours out — the string was
/// correct and the reader was wrong, which is the worst kind of label because there
/// is nothing on screen to argue with. `TwoClocks` adds the second clock only when
/// the two actually read differently, so a crew whose customers are all in town
/// still sees one time.
///
/// An unknown stored zone resolves to `.current`, so the two read the same and the
/// label stays quiet — rather than inventing a third clock and announcing a
/// difference about nothing.
private func theirClock(_ at: Date, _ row: ScheduledMessage) -> String {
    sendAtLabel(at, in: TimeZone(identifier: row.clock_timezone) ?? .current)
}

private func mineClock(_ at: Date) -> String {
    sendAtLabel(at, in: .current)
}
