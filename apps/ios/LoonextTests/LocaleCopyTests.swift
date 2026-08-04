import XCTest
@testable import Loonext

/// #228: the language an automated text goes out in.
///
/// Two things are pinned here, and only one of them is copy.
///
/// The first is the resolution rule, hand-ported from
/// `packages/shared/src/locale.ts` because there is no shared Swift package.
/// Every hand-port is a place two platforms quietly start disagreeing, and this
/// one decides which words reach a customer.
///
/// The second is the inherit label. A per-contact control that cannot say "go
/// back to following the workspace", or that says it without naming the
/// language being followed, is the failure this whole three-state design exists
/// to prevent, so the label is asserted rather than left to a screenshot.
final class LocaleCopyTests: XCTestCase {

    // MARK: resolution

    func testTheContactsOwnLanguageWinsWhenItHasOne() {
        XCTAssertEqual(
            MessageLocale.resolve(contact: MessageLocale.frCA, company: MessageLocale.en),
            MessageLocale.frCA
        )
    }

    func testNoContactLanguageFollowsTheWorkspaceRatherThanEnglish() {
        // The whole semantic. A nil override means "whatever the business works
        // in": an owner who switches the workspace to French expects the
        // customers they never said anything about to move with it.
        XCTAssertEqual(
            MessageLocale.resolve(contact: nil, company: MessageLocale.frCA),
            MessageLocale.frCA
        )
    }

    func testAnUnrecognisedLanguageFallsBackRatherThanStickingToIt() {
        // A row carrying a language some later migration added must not leave a
        // screen naming a language this build cannot render or send.
        XCTAssertEqual(
            MessageLocale.resolve(contact: "de", company: MessageLocale.frCA),
            MessageLocale.frCA
        )
        XCTAssertEqual(MessageLocale.resolve(contact: nil, company: "de"), MessageLocale.en)
        XCTAssertEqual(MessageLocale.resolve(contact: nil, company: nil), MessageLocale.en)
    }

    // MARK: labels

    func testEachLanguageNamesItselfAndFrenchCarriesNoCedilla() {
        XCTAssertEqual(MessageLocale.label(MessageLocale.en), "English")
        // Not "Français". The shared table is written inside GSM-7 because
        // everything beside it is a message body billed by the segment, and the
        // clients must not disagree with it about the spelling.
        XCTAssertEqual(MessageLocale.label(MessageLocale.frCA), "Francais (Canada)")
    }

    func testThePickerOffersExactlyTheTwoLanguagesTheServerAccepts() {
        XCTAssertEqual(MessageLocale.all, ["en", "fr-CA"])
    }

    // MARK: the inherit option

    func testTheInheritOptionNamesTheLanguageItInherits() {
        XCTAssertEqual(
            inheritedLocaleLabel(companyLocale: MessageLocale.en),
            "Same as workspace (English)"
        )
        XCTAssertEqual(
            inheritedLocaleLabel(companyLocale: MessageLocale.frCA),
            "Same as workspace (Francais (Canada))"
        )
    }

    func testTheInheritOptionIsNeverBlankEvenWhenTheWorkspaceLanguageIsUnknown() {
        // Never blank, and never a GUESS either. This originally resolved the
        // way the send path does and named English, which is wrong in the one
        // case it covers: the workspace read has not landed, or failed, so the
        // answer is unknown. Naming English there tells a French workspace its
        // default is English, which is the exact confusion this control exists
        // to remove - and it is stated with the same confidence as a fact we
        // actually have.
        //
        // Vaguer beats misleading. The label degrades to the unqualified
        // sentence, which is still meaningful ("whatever the workspace uses")
        // and never renders "Same as workspace ()".
        XCTAssertEqual(
            inheritedLocaleLabel(companyLocale: nil),
            "Same as workspace"
        )
        // The same is true of a value this build does not recognise, which is
        // the shape a later locale reaching an older app would take.
        XCTAssertEqual(
            inheritedLocaleLabel(companyLocale: "de"),
            "Same as workspace"
        )
        XCTAssertFalse(inheritedLocaleLabel(companyLocale: nil).isEmpty)
    }

    func testTheInheritOptionIsDistinguishableFromThePlainLanguageBesideIt() {
        // Both send different instructions for an English workspace: one keeps
        // following it, the other pins this customer. Identical labels would
        // make the difference invisible at the moment of the choice.
        XCTAssertNotEqual(
            inheritedLocaleLabel(companyLocale: MessageLocale.en),
            MessageLocale.label(MessageLocale.en)
        )
    }

    // MARK: what the setting does, in both places

    func testBothScreensSayItDoesNotTranslateTheAppOrWhatSomebodyTyped() {
        // An owner who expects the whole app to change language and gets four
        // texts is right to feel misled, so neither screen may omit this.
        for copy in [localeScopeCaveat, localeContactScopeNote] {
            XCTAssertTrue(copy.contains("app"), copy)
            XCTAssertTrue(copy.contains("typed"), copy)
        }
    }

    // MARK: the wire

    func testClearingTheOverrideSendsAnExplicitNullRatherThanOmittingIt() throws {
        // An omitted key means "leave it alone" to the server; only an explicit
        // null hands this customer back to the workspace default.
        XCTAssertEqual(
            String(decoding: try JSONEncoder().encode(contactFieldBody("locale", nil)), as: UTF8.self),
            "{\"locale\":null}"
        )
        XCTAssertEqual(
            String(
                decoding: try JSONEncoder().encode(contactFieldBody("locale", MessageLocale.frCA)),
                as: UTF8.self
            ),
            "{\"locale\":\"fr-CA\"}"
        )
    }
}
