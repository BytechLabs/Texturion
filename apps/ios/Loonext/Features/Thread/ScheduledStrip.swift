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
/// - A row opens to show the full text. The strip hides when the queue is empty.
/// - **Disclosure is the point.** A held message says WHY in the API's own
///   words, in the amber this product already uses for "needs a human".
///   `docs/DECISIONS.md` makes that binding: silent disappearance is the one
///   unacceptable option, and a strip showing only a time would be silent about
///   the only state that matters.
/// - Cancel takes effect immediately. The toast offers Undo.
///
/// Mirrors apps/web/src/components/thread/scheduled-strip.tsx and the Android
/// ScheduledStrip.kt.
@MainActor
struct ScheduledStrip: View {
    let rows: [ScheduledMessage]
    let clock: DestinationClock?
    let onUpdate: @MainActor (String, String?, String?, Bool) async -> ScheduleOutcome
    let onCancel: @MainActor (String) -> Void

    var body: some View {
        // No skeleton and no empty state. This is a strip that is usually
        // absent, and reserving space for it on every thread would be a
        // permanent cost paid for a rare event.
        if !rows.isEmpty {
            VStack(spacing: 4) {
                ForEach(rows) { row in
                    ScheduledStripRow(
                        row: row,
                        clock: clock,
                        onUpdate: { body, at, confirmed in await onUpdate(row.id, body, at, confirmed) },
                        onCancel: { onCancel(row.id) }
                    )
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
    let clock: DestinationClock?
    let onUpdate: @MainActor (String?, String?, Bool) async -> ScheduleOutcome
    let onCancel: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale
    @State private var expanded = false
    @State private var editing = false
    @State private var pickingTime = false
    @State private var quietTime: Date?
    @State private var saving = false
    @State private var draft = ""

    private func t(_ key: String) -> String { AppStrings.translate(appLocale, key) }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: row.isHeld ? "exclamationmark.triangle" : "clock")
                .font(.caption)
                .foregroundStyle(row.isHeld ? NoteAmber.ink : BrandColor.muted500)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 2) {
                let lead = row.isHeld
                    ? AppStrings.translate(appLocale, "thread.scheduledWaiting")
                    : sendAtOf(row, locale: appLocale)
                Button {
                    expanded.toggle()
                } label: {
                    Text("\(lead) — \(row.body)")
                        .font(.caption)
                        .lineLimit(expanded ? nil : 2)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)

                if row.isHeld, let reason = ScheduledSend.holdText(
                    reasonKey: row.held_reason_key,
                    storedEnglish: row.held_reason,
                    locale: appLocale
                ), !reason.isEmpty {
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(NoteAmber.ink)
                } else if !row.isHeld {
                    Text(ScheduledSend.clockProvenance(row.rung, locale: appLocale))
                        .font(.caption2)
                        .foregroundStyle(BrandColor.muted500)
                }
                if row.isHeld, row.allowed_actions.allows("edit") {
                    Button(t("thread.pickAnotherTime")) { pickingTime = true }
                        .font(.caption2)
                        .disabled(saving)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if row.allowed_actions.allows("edit") {
                HStack(spacing: 8) {
                    Button {
                        draft = row.body
                        editing = true
                    } label: {
                        Label(t("thread.scheduledEditText"), systemImage: "square.and.pencil")
                    }
                    if !row.isHeld {
                        Button {
                            pickingTime = true
                        } label: {
                            Label(t("thread.scheduledChangeTime"), systemImage: "clock")
                        }
                    }
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .font(.caption)
                .disabled(saving)
            }

            // #722: no cancel where the server will not take it.
            if row.allowed_actions.allows("cancel") {
                Button {
                    // Calling off a queued message is a refusal, not a tap: it is
                    // the one press on this strip that destroys something somebody
                    // wrote.
                    Haptics.reject()
                    onCancel()
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption)
                        .foregroundStyle(BrandColor.muted500)
                }
                .buttonStyle(.plain)
                .disabled(saving)
                .accessibilityLabel(
                    AppStrings.translate(
                        appLocale,
                        "thread.cancelScheduledAria",
                        ["when": sendAtSpokenOf(row, locale: appLocale)]
                    )
                )
            }
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
        .sheet(isPresented: $editing) {
            NavigationStack {
                TextEditor(text: $draft)
                    .padding()
                    .accessibilityLabel(t("thread.scheduledEditText"))
                    .navigationTitle(t("thread.scheduledEditText"))
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button(t("common.cancel")) { editing = false }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button(t("common.save")) { save(body: draft) }
                                .disabled(saving || draft.utf16.count > ScheduledSend.bodyMax
                                    || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
            }
        }
        .sheet(isPresented: $pickingTime) {
            SendLaterPicker(clock: clock) { at in save(at: at) }
        }
        .confirmDialog(
            t("thread.quietHoursTitle"),
            item: $quietTime,
            message: { _ in quietHoursScheduleMessage(localHour: nil, locale: appLocale) },
            confirmLabel: t("thread.scheduleAnyway"),
            cancelLabel: t("thread.pickAnotherTime"),
            tone: .standard,
            onCancel: { pickingTime = true }
        ) { at in
            save(at: at, confirmed: true)
        }
    }

    private func save(body: String? = nil, at: Date? = nil, confirmed: Bool = false) {
        guard !saving else { return }
        saving = true
        Task { @MainActor in
            defer { saving = false }
            let iso = at.map { ISO8601DateFormatter().string(from: $0) }
            switch await onUpdate(body, iso, confirmed) {
            case .scheduled:
                editing = false
            case .needsQuietHoursConfirm:
                quietTime = at
            case .failed:
                break
            }
        }
    }
}

/// "Tue, 8:00 AM" in the DESTINATION's zone.
///
/// The zone stored on the row, not this device's: a dispatcher in Toronto
/// looking at a send scheduled for a customer in Vancouver has to see the time
/// that customer will experience, because that is the time the sender chose.
/// #228: `locale` is LAST and DEFAULTED, so `SendLaterTests` keeps calling this
/// with one argument and keeps reading the English, while the row that knows its
/// reader passes `appLocale`.
func sendAtOf(_ row: ScheduledMessage, locale: String? = nil) -> String {
    // `parseSnoozeInstant` rather than a formatter written here: PostgREST
    // renders timestamptz with a fractional part only sometimes, and a single
    // ISO8601DateFormatter silently returns nil for the other shape. That
    // helper already carries both, and a scheduled row falling back to
    // "Scheduled" because of a missing `.SSS` would hide the one fact this
    // strip exists to show.
    guard let at = parseSnoozeInstant(row.send_at) else { return "Scheduled" }
    return TwoClocks.bothClocks(
        theirClock(at, row), mineClock(at), locale: locale
    )
}

/// The same, spelled out, for VoiceOver.
func sendAtSpokenOf(_ row: ScheduledMessage, locale: String? = nil) -> String {
    guard let at = parseSnoozeInstant(row.send_at) else { return "Scheduled" }
    return TwoClocks.bothClocksSpoken(
        theirClock(at, row), mineClock(at), locale: locale
    )
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
