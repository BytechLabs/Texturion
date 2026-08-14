import SwiftUI

/// #233 — "send this Monday at 8", from the thread composer.
///
/// Design notes, and the principles behind them:
///
/// - **Zen of Clarity.** Send keeps the whole primary control. Scheduling is a
///   separate button beside it that appears only when there are words to
///   schedule. Web splits its send pill, which works with a cursor; a 34pt
///   circle split under a thumb gives neither half a usable target. A
///   long-press would fit, but a gesture with no glyph is a feature only the
///   people who already know about it can use.
/// - **Chunking.** Two presets and a way out. #233 names exactly these, and the
///   count is the point — a preset list long enough to read is slower than the
///   picker it was meant to avoid.
/// - **Smart Defaults.** The picker opens on the next preset, never a blank
///   field or midnight.
/// - **Ethical friction, reserved for the irreversible.** Scheduling is undoable
///   until it fires, so it confirms rather than asking. The one alert is quiet
///   hours, where the message reaches a real person at a bad hour — and #225
///   ask 2 is that a human is WARNED, never blocked, so it offers both doors.
///
/// WHOSE 8AM. Presets are resolved in the DESTINATION's zone and the sheet says
/// which rung answered, rather than presenting an inference as a fact. On the
/// weakest rung it is the shop's own clock and the line admits it — the same
/// wording the thread's "their time" hint uses.
///
/// Mirrors apps/android/…/features/compose/SendLater.kt.

/// What the API said when a send-later was submitted.
enum ScheduleOutcome: Sendable {
    case scheduled

    /// #225: the fire instant lands in the customer's quiet window and nobody
    /// has confirmed it yet. Distinct from ``failed`` because the remedy is a
    /// question, not an error — the retry carries `quiet_hours_confirmed`.
    case needsQuietHoursConfirm

    /// Refused or unreachable. The caller has already said so.
    case failed
}

/// The two presets plus the picker.
///
/// A sheet rather than a menu because the rows sit under the thumb rather than
/// above the keyboard, and they are laid out like the snooze ladder's, so the
/// product has one way of offering a time.
@MainActor
struct SendLaterSheet: View {
    let clock: DestinationClock?
    let onPick: @MainActor (Date) -> Void
    let onPickCustom: @MainActor () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String { AppStrings.translate(appLocale, key) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(presets, id: \.id) { preset in
                        if let at = preset.at {
                            Button {
                                dismiss()
                                onPick(at)
                            } label: {
                                HStack {
                                    Label(preset.label, systemImage: "clock")
                                    Spacer()
                                    Text(clockOf(at, in: zone))
                                        .font(.footnote)
                                        .monospacedDigit()
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    Button {
                        dismiss()
                        onPickCustom()
                    } label: {
                        Label(t("thread.pickATime"), systemImage: "calendar.badge.clock")
                    }
                } header: {
                    Text(headerLine)
                }
            }
            .navigationTitle(t("thread.sendLater"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private var zone: TimeZone { destinationZone(clock) }

    // Resolved on each body evaluation rather than stored: the pair only
    // changes when the clock crosses 8am there, and on that pass the NEW pair
    // is the correct one.
    private var presets: [SchedulePreset] {
        schedulePresets(now: Date(), timeZone: zone, locale: appLocale)
    }

    private var headerLine: String {
        guard let clock else { return t("thread.workspaceTime") }
        return ScheduledSend.clockProvenance(clock.rung, locale: appLocale)
    }
}

/// The custom-time picker, in the DEVICE's zone.
///
/// THE ZONE HERE IS THE SENDER'S, ON PURPOSE, and the sheet says so. A picker
/// showing the customer's wall clock would have to be read back through their
/// zone, and every place that conversion is missed is a send hours away from
/// where somebody put it — invisible in any test where the two zones happen to
/// agree. Presets stay the customer's morning and are hinted in their zone; one
/// ambiguous field showing two clocks would be worse than either.
@MainActor
struct SendLaterPicker: View {
    let clock: DestinationClock?
    let onConfirm: @MainActor (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale
    @State private var value: Date
    /// #539: which clock the picked time is in — the switch the issue asks for
    /// ("why cant i choose? let me switch?").
    @State private var choice: TwoClocks.Choice = TwoClocks.defaultChoice

    init(clock: DestinationClock?, onConfirm: @escaping @MainActor (Date) -> Void) {
        self.clock = clock
        self.onConfirm = onConfirm
        // Smart Defaults: opens on the next preset rather than a blank field.
        // #228: no locale, and none is needed — an `init` runs before the
        // environment exists, and only `.at` is read here. The LABELS this
        // builds are never drawn.
        let seed = schedulePresets(now: Date(), timeZone: destinationZone(clock))
            .first(where: { $0.at != nil })?.at
        _value = State(initialValue: seed ?? Date().addingTimeInterval(3600))
    }

    var body: some View {
        NavigationStack {
            Form {
                DatePicker(
                    t("thread.sendAt"),
                    selection: $value,
                    in: horizon,
                    displayedComponents: [.date, .hourAndMinute]
                )
                if canSwitch {
                    // Two buttons, not a zone picker. The question a sender has is
                    // "did I mean 8am here or 8am there"; offering 400 IANA zones
                    // to answer it would be a worse version of the same confusion.
                    Picker(t("thread.whichClock"), selection: $choice) {
                        ForEach(TwoClocks.Choice.allCases) { option in
                            Text(option.localisedLabel(appLocale)).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                Text(clockNote)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle(t("thread.sendLater"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("thread.schedule")) {
                        dismiss()
                        // #539: resolved against whichever clock is selected. The
                        // digits on screen do not change; what they mean does.
                        onConfirm(resolved)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    /// The destination's zone, or the device's when there is nothing to resolve.
    private var theirZone: TimeZone { destinationZone(clock) }

    /// #539: only offered when it would change the answer.
    ///
    /// If the customer's clock reads the same as this device's, a Their/Your toggle
    /// is two buttons that do the same thing — worse than none, because it implies a
    /// difference that is not there.
    private var canSwitch: Bool {
        guard clock != nil else { return false }
        return !TwoClocks.sameClock(
            clockOf(value, in: theirZone),
            clockOf(value, in: .current)
        )
    }

    /// The instant the picked digits mean, on the chosen clock.
    private var resolved: Date {
        guard canSwitch, choice == .theirs else { return value }
        return TwoClocks.reinterpret(value, from: .current, to: theirZone)
    }

    /// The line under the picker: the same moment on the OTHER clock.
    ///
    /// #539 asked "what about my timzeone equivalent?" — answered with a rendered
    /// time rather than an hours-apart number, which is wrong every day in the
    /// half-hour zones and twice a year everywhere else.
    private var clockNote: String {
        guard canSwitch else {
            return senderClockNote(clock, device: .current, locale: appLocale)
        }
        return choice == .theirs
            ? t(
                "thread.pickerThats",
                [
                    "time": clockOf(resolved, in: .current),
                    "clock": AppStrings.translate(appLocale, TwoClocks.hereKey),
                ]
            )
            : t(
                "thread.pickerThats",
                [
                    "time": clockOf(resolved, in: theirZone),
                    "clock": AppStrings.translate(appLocale, TwoClocks.thereKey),
                ]
            )
    }

    /// Both bounds mirror the API's, so the wheel simply cannot reach a time
    /// the server would refuse.
    private var horizon: ClosedRange<Date> {
        let now = Date()
        return now ... now.addingTimeInterval(
            Double(ScheduledSend.horizonDays) * 86_400
        )
    }
}

/// "8:00 AM" in a given zone, in the device's locale.
func clockOf(_ at: Date, in zone: TimeZone) -> String {
    let formatter = DateFormatter()
    formatter.timeZone = zone
    formatter.timeStyle = .short
    formatter.dateStyle = .none
    return formatter.string(from: at)
}

/// "Tue, 8:00 AM" — enough to recognise what you picked, and no more.
func sendAtLabel(_ at: Date, in zone: TimeZone) -> String {
    let formatter = DateFormatter()
    formatter.timeZone = zone
    formatter.setLocalizedDateFormatFromTemplate("EEE j:mm")
    return formatter.string(from: at)
}

/// The destination's zone, falling back to this device's when unresolved.
func destinationZone(_ clock: DestinationClock?) -> TimeZone {
    guard let name = clock?.timezone, let zone = TimeZone(identifier: name) else {
        return .current
    }
    return zone
}

/// The sentence under the time picker: whose clock this field is, and how far
/// the customer is from it.
///
/// Measured against the real calendars rather than an offset table, so it stays
/// right across a DST boundary where two zones change on different dates.
///
/// #228: `locale` is defaulted and last, so the assertion table above is
/// untouched and nil still reads English.
func senderClockNote(
    _ clock: DestinationClock?,
    device: TimeZone,
    locale: String? = nil
) -> String {
    let reassurance = ScheduledSend.copyLine("picker_reassurance", locale: locale)
    guard
        let clock,
        clock.rung != "company",
        let zone = TimeZone(identifier: clock.timezone),
        zone != device
    else {
        return AppStrings.translate(
            locale,
            "thread.senderClockOwn",
            ["reassurance": reassurance]
        )
    }
    return AppStrings.translate(
        locale,
        "thread.senderClockApart",
        [
            "delta": hoursApart(zone, from: device, locale: locale),
            "reassurance": reassurance,
        ]
    )
}

/// "3 hours behind you", wrapped into (-12, 12] so 23 ahead reads as 1 behind.
///
/// #228: four whole sentences rather than a magnitude glued to a direction.
/// French does not assemble this the way English does — "une heure en avance
/// sur vous" puts the direction in the middle — so a client that builds the
/// phrase from parts can only ever be translated into English word order.
func hoursApart(
    _ there: TimeZone,
    from here: TimeZone,
    at now: Date = Date(),
    locale: String? = nil
) -> String {
    let minutes =
        (there.secondsFromGMT(for: now) - here.secondsFromGMT(for: now)) / 60
    var delta = minutes / 60
    if delta > 12 { delta -= 24 }
    if delta < -12 { delta += 24 }
    if delta == 0 { return AppStrings.translate(locale, "thread.clockSame") }
    let count = abs(delta)
    if count == 1 {
        return delta > 0
            ? AppStrings.translate(locale, "thread.clockAnHourAhead")
            : AppStrings.translate(locale, "thread.clockAnHourBehind")
    }
    return delta > 0
        ? AppStrings.translate(locale, "thread.clockHoursAhead", ["count": String(count)])
        : AppStrings.translate(locale, "thread.clockHoursBehind", ["count": String(count)])
}

/// #225 — the body of the "that lands late where they are" alert.
///
/// Ask 2 is warned and never blocked, so it states the hour there and offers
/// both doors rather than refusing. A function rather than a view because
/// SwiftUI alerts take their message as `Text`, and the buttons belong to the
/// composer that owns the retry.
func quietHoursScheduleMessage(localHour: Int?, locale: String? = nil) -> String {
    guard let localHour else {
        return ScheduledSend.copyLine("quiet_hours_unknown", locale: locale) + " "
            + ScheduledSend.copyLine("quiet_hours_choice", locale: locale)
    }
    let suffix = localHour < 12 ? "am" : "pm"
    let twelve = localHour % 12 == 0 ? 12 : localHour % 12
    return AppStrings.translate(
        locale,
        "thread.quietHoursAround",
        ["hour": "\(twelve)\(suffix)"]
    )
        + " "
        + ScheduledSend.copyLine("quiet_hours_choice", locale: locale)
}
