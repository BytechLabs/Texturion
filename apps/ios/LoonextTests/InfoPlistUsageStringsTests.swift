import XCTest

/// The purpose strings are build settings in project.yml, and nothing at build
/// time notices one going missing: iOS ends the app at the microphone or contacts
/// request, silently ignores the location request, and refuses Face ID to App
/// Lock (#330). This reads the Info.plist the host app actually shipped with.
final class InfoPlistUsageStringsTests: XCTestCase {
    private let requiredKeys = [
        // App Lock (#330), Features/Security/AppLockGate.swift.
        "NSFaceIDUsageDescription",
        // Calls, the spoken wrap-up (#507) and the voicemail greeting.
        "NSMicrophoneUsageDescription",
        // The phone's own contacts on the Contacts tab (#459).
        "NSContactsUsageDescription",
        // The task map's My location button.
        "NSLocationWhenInUseUsageDescription",
    ]

    func testTheseTestsReadTheAppsOwnInfoPlist() {
        // Unhosted, Bundle.main is the xctest runner and every key reads as missing.
        XCTAssertEqual(Bundle.main.bundleURL.pathExtension, "app")
    }

    func testEveryPermissionTheAppAsksForHasAPurposeString() {
        for key in requiredKeys {
            let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? ""
            XCTAssertFalse(
                value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                "\(key) is missing or empty: set INFOPLIST_KEY_\(key) under targets.Loonext.settings.base in project.yml"
            )
        }
    }
}
