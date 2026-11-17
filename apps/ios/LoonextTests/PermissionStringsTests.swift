import XCTest

final class PermissionStringsTests: XCTestCase {
    func testPermissionPromptsAreBundledInEnglishAndFrench() throws {
        let keys = [
            "NSMicrophoneUsageDescription",
            "NSLocationWhenInUseUsageDescription",
            "NSContactsUsageDescription",
            "NSFaceIDUsageDescription",
        ]
        let translations = try ["en", "fr"].map { language in
            let url = try XCTUnwrap(Bundle.main.url(
                forResource: "InfoPlist", withExtension: "strings", subdirectory: nil, localization: language
            ))
            let data = try Data(contentsOf: url)
            let strings = try XCTUnwrap(
                PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String]
            )
            return try keys.map { key in try XCTUnwrap(strings[key]) }
        }
        for (english, french) in zip(translations[0], translations[1]) {
            XCTAssertFalse(english.isEmpty)
            XCTAssertFalse(french.isEmpty)
            XCTAssertNotEqual(english, french)
        }
    }
}
