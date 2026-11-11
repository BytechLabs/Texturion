import XCTest
@testable import Loonext

/// #749: the line under a setting that has left its default.
final class SettingChoiceNoteTests: XCTestCase {
    private func choice(
        by name: String? = "Dana Whitcomb",
        at when: String? = "2026-08-08T15:31:13Z",
        value: JSONValue = .string("voicemail")
    ) -> SettingChoice {
        SettingChoice(
            key: "after_hours_calls",
            value: value,
            default_value: .string("ring_everyone"),
            chosen_by: name,
            chosen_at: when
        )
    }

    func testANamedChoiceSaysWhoAndWhen() {
        let text = settingChoiceText(
            choice: choice(),
            current: .string("voicemail"),
            defaultLabel: "Ring everyone",
            locale: MessageLocale.en
        )
        XCTAssertEqual(text?.hasPrefix("Dana Whitcomb chose this on "), true)
        XCTAssertEqual(text?.hasSuffix(". The default is Ring everyone."), true)
        XCTAssertEqual(text?.contains("2026"), true)
    }

    func testAnUnknownActorFallsBackToTheShortLine() {
        let noName = settingChoiceText(
            choice: choice(by: nil),
            current: .string("voicemail"),
            defaultLabel: "Ring everyone",
            locale: MessageLocale.en
        )
        XCTAssertEqual(noName, "Changed from the default, which is Ring everyone.")
        let noDate = settingChoiceText(
            choice: choice(at: nil),
            current: .string("voicemail"),
            defaultLabel: "Ring everyone",
            locale: MessageLocale.en
        )
        XCTAssertEqual(noDate, "Changed from the default, which is Ring everyone.")
    }

    func testFrenchUsesTheFrenchSentences() {
        let text = settingChoiceText(
            choice: choice(by: nil),
            current: .string("voicemail"),
            defaultLabel: "Faire sonner tout le monde",
            locale: MessageLocale.frCA
        )
        XCTAssertEqual(text, "Différent du réglage par défaut : Faire sonner tout le monde.")
        XCTAssertEqual(settingOnOffLabel(true, locale: MessageLocale.frCA), "activé")
        XCTAssertEqual(settingOnOffLabel(false, locale: MessageLocale.frCA), "désactivé")
        XCTAssertEqual(settingOnOffLabel(true, locale: MessageLocale.en), "on")
        XCTAssertEqual(settingOnOffLabel(false, locale: MessageLocale.en), "off")
    }

    func testSilentAtTheDefaultAndWithNoRow() {
        XCTAssertNil(settingChoiceText(
            choice: choice(),
            current: .string("ring_everyone"),
            defaultLabel: "Ring everyone",
            locale: MessageLocale.en
        ))
        XCTAssertNil(settingChoiceText(
            choice: nil,
            current: .string("voicemail"),
            defaultLabel: "Ring everyone",
            locale: MessageLocale.en
        ))
    }

    /// A list fetched before a save names the previous value; it must not sit
    /// beside the new one.
    func testSilentWhenTheListIsStale() {
        XCTAssertNil(settingChoiceText(
            choice: choice(value: .string("voicemail")),
            current: .string("on_call_only"),
            defaultLabel: "Ring everyone",
            locale: MessageLocale.en
        ))
    }

    func testValuesCompareAcrossTypes() {
        XCTAssertTrue(sameSettingValue(.number(3), .string("3")))
        XCTAssertTrue(sameSettingValue(.number(3), .number(3.0)))
        XCTAssertTrue(sameSettingValue(.bool(false), .bool(false)))
        XCTAssertFalse(sameSettingValue(.bool(false), .bool(true)))
        XCTAssertFalse(sameSettingValue(.string("a"), .number(1)))
    }

    func testTheCalendarDateIsPlainAndLocalised() {
        let zone = TimeZone(identifier: "UTC") ?? .current
        XCTAssertEqual(
            TimestampFormat.calendarDate("2026-08-08T15:31:13Z", locale: MessageLocale.en, timeZone: zone),
            "Aug 8, 2026"
        )
        XCTAssertEqual(
            TimestampFormat.calendarDate("2026-08-08T15:31:13Z", locale: MessageLocale.frCA, timeZone: zone),
            "8 août 2026"
        )
        XCTAssertEqual(TimestampFormat.calendarDate(nil, locale: MessageLocale.en), "")
    }

    func testTheEndpointJsonDecodes() throws {
        let json = """
        {"data":[
          {"key":"after_hours_calls","value":"voicemail","default_value":"ring_everyone",
           "chosen_by":"Dana Whitcomb","chosen_at":"2026-08-08T03:31:13Z"},
          {"key":"away_enabled","value":true,"default_value":false,
           "chosen_by":null,"chosen_at":null},
          {"key":"overage_cap_multiplier","value":5,"default_value":3,
           "chosen_by":null,"chosen_at":null}
        ]}
        """
        let decoded = try JSONDecoder().decode(SettingChoices.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.data.count, 3)
        XCTAssertEqual(decoded.data[0].value, .string("voicemail"))
        XCTAssertEqual(decoded.data[0].chosen_by, "Dana Whitcomb")
        XCTAssertEqual(decoded.data[1].value, .bool(true))
        XCTAssertEqual(decoded.data[1].default_value, .bool(false))
        XCTAssertNil(decoded.data[1].chosen_by)
        XCTAssertNil(decoded.data[1].chosen_at)
        XCTAssertEqual(decoded.data[2].value, .number(5))
    }
}
