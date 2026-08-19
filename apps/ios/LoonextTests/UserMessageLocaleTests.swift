import XCTest

@testable import Loonext

/// #228 — a refusal in the language the reader chose.
///
/// The API composes its refusals in English, one per call site, 370 of them,
/// and this client rendered every one exactly as it arrived. Right for an
/// English crew; useless for the French one this issue exists for.
///
/// These assertions are about the ASYMMETRY, because that is the part somebody
/// would reasonably undo. Replacing a specific sentence with a generic one is a
/// loss, and it is only worth taking when the specific one could not be read at
/// all. Twin of `apps/web/src/lib/api/reader-facing-errors.test.ts` and
/// `UserMessageLocaleTest.kt`.
final class UserMessageLocaleTests: XCTestCase {
    /// Arguments follow ApiError's DECLARATION order — code, message,
    /// httpStatus, requestId — because Swift's memberwise init requires it even
    /// when every label is correct.
    private func serverError(
        _ code: String,
        _ message: String,
        status: Int = 400,
        requestId: String? = nil
    ) -> ApiError {
        ApiError(code: code, message: message, httpStatus: status, requestId: requestId)
    }

    func testEnglishReaderKeepsTheServersSpecificSentence() {
        let error = serverError("not_found", "No such API key.")
        // Not the catalogue's "We couldn't find that." — the server knew it was
        // a key, and that is the whole value of the sentence.
        XCTAssertEqual(error.userMessage(MessageLocale.en), "No such API key.")
    }

    func testFrenchReaderGetsTheCodesOwnSentence() {
        let error = serverError("not_found", "No such API key.")
        let shown = error.userMessage(MessageLocale.frCA)
        XCTAssertEqual(shown, ApiErrorStrings.section.frCA["apiErrors.not_found"])
        XCTAssertFalse(shown.contains("No such"))
    }

    func testOurOwnCopyStillWinsInBothLanguages() {
        // A key WE set names our own sentence. It must not be replaced by the
        // code's generic one just because the reader is French.
        var error = serverError("network", "Network unreachable.", status: 0)
        error.messageKey = "common.loadFailed"
        for locale in [MessageLocale.en, MessageLocale.frCA] {
            XCTAssertEqual(
                error.userMessage(locale),
                AppStrings.translate(locale, "common.loadFailed")
            )
        }
    }

    func testUnknownCodeNeverPutsARawKeyOnScreen() {
        // `translate` fails open, so a code this build has never heard of would
        // otherwise render `apiErrors.teapot_error` — worse than the English it
        // replaced.
        let shown = serverError("teapot_error", "Short and stout.")
            .userMessage(MessageLocale.frCA)
        XCTAssertFalse(shown.contains("apiErrors."))
        XCTAssertEqual(shown, ApiErrorStrings.section.frCA["apiErrors.internal_error"])
    }

    func testEveryCodeHasASentenceThatIsNeitherEnglishNorAKey() {
        for key in ApiErrorStrings.section.en.keys where key != "apiErrors.withReference" {
            let code = String(key.dropFirst("apiErrors.".count))
            let shown = serverError(code, "English.").userMessage(MessageLocale.frCA)
            XCTAssertFalse(shown.contains("apiErrors."), "\(code) left a raw key showing")
            XCTAssertNotEqual(shown, "English.", "\(code) was left in English")
        }
    }

    func testTheServersReferenceIsSaidInTheReadersLanguage() {
        let error = serverError(
            "internal_error",
            "Something went wrong.",
            status: 500,
            requestId: "8f2a1c9db4e60007"
        )
        XCTAssertEqual(
            error.userMessage(MessageLocale.en),
            "Something went wrong. Reference 8f2a1c9db4e60007."
        )
        let french = error.userMessage(MessageLocale.frCA)
        XCTAssertTrue(french.contains("Référence 8f2a1c9db4e60007."))
        XCTAssertFalse(french.contains("Reference "))
    }

    func testARefusalThatAlreadyNamesWhatIsWrongCarriesNoReference() {
        // A 422 explaining which field is wrong needs no reference, and
        // appending one to every refusal would be noise on copy doing its job.
        let error = serverError("validation_failed", "country is required.", status: 422)
        XCTAssertEqual(error.userMessage(MessageLocale.en), "country is required.")
    }

    func testTheSentencesThatWereAlwaysOursStillComeFromTheCatalogue() {
        // A decode failure and an unrecognised error were already keyed, and
        // this change rewrote the branches around them. A raw `common.` prefix
        // on screen would mean the branch now misses its key.
        struct Nameless: Error {}
        let decode = ApiDecodeError(path: "/v1/conversations", summary: "messages[0].body")
        for thrown in [decode as Error, Nameless() as Error] {
            let shown = thrown.userMessage(MessageLocale.frCA)
            XCTAssertFalse(shown.contains("common."), "left a raw key showing")
            XCTAssertTrue(shown.count > 10, "said nothing")
        }
    }
}
