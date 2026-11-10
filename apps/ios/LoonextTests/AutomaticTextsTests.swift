import XCTest
@testable import Loonext

/// #689 — the automatic-texts settings: decode defaults, choice lists, duration
/// words (French plurals included), PATCH bodies, and who sees the section.
final class AutomaticTextsTests: XCTestCase {
    private let en = MessageLocale.en
    private let fr = MessageLocale.frCA

    private func company(_ extra: String = "") throws -> CompanyView {
        let json = """
        {"id":"c1","name":"Acme","country":"US","us_texting_enabled":true,
         "requested_area_code":"415","timezone":"America/Toronto",
         "subscription_status":"active",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"\(extra)}
        """
        return try JSONDecoder().decode(CompanyView.self, from: Data(json.utf8))
    }

    // MARK: decoding

    /// A Worker that predates the settings omits every key; each reads as the
    /// server's default, never false or 0.
    func testAbsentKeysDecodeToTheServerDefaults() throws {
        let c = try company()
        XCTAssertTrue(c.hold_scheduled_on_reply)
        XCTAssertTrue(c.hold_reminders_on_reply)
        XCTAssertTrue(c.hold_rating_ask_on_reply)
        XCTAssertTrue(c.hold_reminders_unverified_calendar)
        XCTAssertTrue(c.rating_ask_enabled)
        XCTAssertEqual(c.rating_ask_delay_hours, 4)
        XCTAssertEqual(c.rating_ask_expiry_hours, 24)
        XCTAssertEqual(c.rating_ask_cooldown_days, 30)
        XCTAssertEqual(c.scheduled_text_expiry_hours, 24)
        XCTAssertEqual(c.reminder_expiry_hours, 2)
        XCTAssertEqual(c.auto_reply_cooldown_minutes, 180)
    }

    func testPresentKeysWinOverTheDefaults() throws {
        let c = try company(
            #","hold_scheduled_on_reply":false,"rating_ask_enabled":false,"#
                + #""rating_ask_delay_hours":0,"auto_reply_cooldown_minutes":30"#
        )
        XCTAssertFalse(c.hold_scheduled_on_reply)
        XCTAssertFalse(c.rating_ask_enabled)
        XCTAssertEqual(c.rating_ask_delay_hours, 0)
        XCTAssertEqual(c.auto_reply_cooldown_minutes, 30)
        XCTAssertTrue(c.hold_reminders_on_reply)
    }

    func testTheRowsReadTheirOwnField() throws {
        let c = try company(#","reminder_expiry_hours":12,"hold_rating_ask_on_reply":false"#)
        XCTAssertEqual(AutoTextNumber.reminderExpiry.value(in: c), 12)
        XCTAssertEqual(AutoTextNumber.ratingDelay.value(in: c), 4)
        XCTAssertFalse(AutoTextFlag.holdRating.value(in: c))
        XCTAssertTrue(AutoTextFlag.holdScheduled.value(in: c))
    }

    // MARK: choices

    func testEveryDefaultIsOnItsOwnList() {
        for number in AutoTextNumber.allCases {
            XCTAssertTrue(number.choices.contains(number.fallback), number.key)
            XCTAssertEqual(number.choices, number.choices.sorted(), number.key)
        }
    }

    func testTheListsAreTheSpecsLists() {
        XCTAssertEqual(AutoTextNumber.ratingDelay.choices, [0, 1, 2, 4, 8, 12, 24, 48])
        XCTAssertEqual(AutoTextNumber.ratingExpiry.choices, [6, 12, 24, 48, 72, 168])
        XCTAssertEqual(AutoTextNumber.ratingCooldown.choices, [7, 14, 30, 60, 90, 180])
        XCTAssertEqual(AutoTextNumber.scheduledExpiry.choices, [6, 12, 24, 48, 72, 168, 720])
        XCTAssertEqual(AutoTextNumber.reminderExpiry.choices, [1, 2, 6, 12, 24, 72])
        XCTAssertEqual(AutoTextNumber.autoReplyCooldown.choices, [30, 60, 180, 360, 720, 1440])
    }

    func testAnOffListCurrentValueIsAddedInOrder() {
        XCTAssertEqual(
            AutomaticTexts.choices(.ratingDelay, current: 5),
            [0, 1, 2, 4, 5, 8, 12, 24, 48]
        )
        XCTAssertEqual(
            AutomaticTexts.choices(.autoReplyCooldown, current: 90),
            [30, 60, 90, 180, 360, 720, 1440]
        )
    }

    func testAnOnListCurrentValueAddsNothing() {
        XCTAssertEqual(
            AutomaticTexts.choices(.reminderExpiry, current: 2),
            AutoTextNumber.reminderExpiry.choices
        )
    }

    // MARK: duration words

    func testEnglishDurations() {
        XCTAssertEqual(AutomaticTexts.duration(0, unit: .hours, locale: en), "Right away")
        XCTAssertEqual(AutomaticTexts.duration(1, unit: .hours, locale: en), "1 hour")
        XCTAssertEqual(AutomaticTexts.duration(4, unit: .hours, locale: en), "4 hours")
        XCTAssertEqual(AutomaticTexts.duration(24, unit: .hours, locale: en), "1 day")
        XCTAssertEqual(AutomaticTexts.duration(720, unit: .hours, locale: en), "30 days")
        XCTAssertEqual(AutomaticTexts.duration(30, unit: .days, locale: en), "30 days")
        XCTAssertEqual(AutomaticTexts.duration(30, unit: .minutes, locale: en), "30 minutes")
        XCTAssertEqual(AutomaticTexts.duration(180, unit: .minutes, locale: en), "3 hours")
        XCTAssertEqual(AutomaticTexts.duration(1440, unit: .minutes, locale: en), "1 day")
        XCTAssertEqual(AutomaticTexts.duration(90, unit: .minutes, locale: en), "90 minutes")
    }

    func testFrenchDurationsTakeTheRightPlural() {
        XCTAssertEqual(AutomaticTexts.duration(0, unit: .hours, locale: fr), "Tout de suite")
        XCTAssertEqual(AutomaticTexts.duration(1, unit: .hours, locale: fr), "1 heure")
        XCTAssertEqual(AutomaticTexts.duration(4, unit: .hours, locale: fr), "4 heures")
        XCTAssertEqual(AutomaticTexts.duration(1440, unit: .minutes, locale: fr), "1 jour")
        XCTAssertEqual(AutomaticTexts.duration(72, unit: .hours, locale: fr), "3 jours")
        XCTAssertEqual(AutomaticTexts.duration(1, unit: .minutes, locale: fr), "1 minute")
        XCTAssertEqual(AutomaticTexts.duration(30, unit: .minutes, locale: fr), "30 minutes")
    }

    func testEveryChoiceHasAWordNotAKey() {
        for number in AutoTextNumber.allCases {
            for locale in [en, fr] {
                for value in number.choices {
                    let words = AutomaticTexts.label(number, value: value, locale: locale)
                    XCTAssertFalse(words.contains("domain."), "\(number.key) \(value)")
                }
            }
        }
    }

    // MARK: captions

    func testEveryDefaultIsStatedInTheControlsOwnCaption() {
        XCTAssertEqual(AutomaticTexts.defaultCaption(AutoTextFlag.holdScheduled, locale: en), "Default: on")
        XCTAssertEqual(
            AutomaticTexts.defaultCaption(AutoTextFlag.holdScheduled, locale: fr),
            "Par défaut : activé"
        )
        XCTAssertEqual(
            AutomaticTexts.defaultCaption(AutoTextNumber.ratingDelay, locale: en),
            "Default: 4 hours"
        )
        XCTAssertEqual(
            AutomaticTexts.defaultCaption(AutoTextNumber.autoReplyCooldown, locale: en),
            "Default: 3 hours"
        )
        XCTAssertEqual(
            AutomaticTexts.defaultCaption(AutoTextNumber.ratingCooldown, locale: fr),
            "Par défaut : 30 jours"
        )
    }

    func testOnlyTheHoldSwitchesExplainTheirPosition() {
        XCTAssertEqual(
            AutomaticTexts.positionCaption(.holdReminders, isOn: true, locale: en),
            "On: it waits for you."
        )
        XCTAssertEqual(
            AutomaticTexts.positionCaption(.holdReminders, isOn: false, locale: en),
            "Off: it goes out anyway."
        )
        XCTAssertNil(AutomaticTexts.positionCaption(.ratingEnabled, isOn: true, locale: en))
        XCTAssertNil(
            AutomaticTexts.positionCaption(.holdUnverifiedCalendar, isOn: true, locale: en)
        )
    }

    // MARK: PATCH bodies

    func testASwitchPatchesOnlyItsOwnField() {
        XCTAssertEqual(
            AutomaticTexts.patch(AutoTextFlag.holdScheduled, isOn: false),
            JSONValue.object(["hold_scheduled_on_reply": .bool(false)])
        )
    }

    func testAPickerPatchesOnlyItsOwnField() {
        XCTAssertEqual(
            AutomaticTexts.patch(AutoTextNumber.ratingCooldown, value: 60),
            JSONValue.object(["rating_ask_cooldown_days": .number(60)])
        )
    }

    func testTheWireKeysAreTheServers() {
        XCTAssertEqual(
            AutoTextFlag.allCases.map(\.key),
            [
                "hold_scheduled_on_reply", "hold_reminders_on_reply",
                "hold_rating_ask_on_reply", "hold_reminders_unverified_calendar",
                "rating_ask_enabled",
            ]
        )
        XCTAssertEqual(
            AutoTextNumber.allCases.map(\.key),
            [
                "rating_ask_delay_hours", "rating_ask_expiry_hours",
                "rating_ask_cooldown_days", "scheduled_text_expiry_hours",
                "reminder_expiry_hours", "auto_reply_cooldown_minutes",
            ]
        )
    }

    // MARK: who sees it

    func testOnlyAnAdminOrOwnerSeesTheSection() {
        let section = SettingsSection.automaticTexts
        XCTAssertEqual(section.needs, Capability.settingsManage)
        for role in [MemberRole.owner, MemberRole.admin] {
            XCTAssertTrue(MemberRole.has(role, section.needs), role)
            XCTAssertTrue(SettingsRoleGate.canEditWorkspace(role), role)
        }
        for role in [MemberRole.member, MemberRole.bookkeeper, MemberRole.readOnly] {
            XCTAssertFalse(MemberRole.has(role, section.needs), role)
            XCTAssertFalse(SettingsRoleGate.canEditWorkspace(role), role)
        }
    }

    func testTheSectionHasWordsInBothLanguages() {
        let key = SettingsSection.automaticTexts.titleKey
        XCTAssertEqual(AppStrings.translate(en, key), "Automatic texts")
        XCTAssertEqual(AppStrings.translate(fr, key), "Textos automatiques")
        XCTAssertFalse(SettingsSection.automaticTexts.blurb.contains("domain."))
    }

    func testTheMemberCategoryComesRightAfterTasks() throws {
        let keys = OnCall.localisedCategoryLabels(nil).map { $0.key }
        let tasks = try XCTUnwrap(keys.firstIndex(of: "tasks"))
        XCTAssertEqual(keys[tasks + 1], "scheduled_texts")
        XCTAssertEqual(
            OnCall.localisedCategoryLabels(fr).first { $0.key == "scheduled_texts" }?.label,
            "Textos planifiés retenus ou non envoyés"
        )
    }
}
