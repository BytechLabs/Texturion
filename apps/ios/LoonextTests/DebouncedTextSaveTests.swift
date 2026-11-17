import XCTest
@testable import Loonext

final class DebouncedTextSaveTests: XCTestCase {
    @MainActor
    func testFlushSavesTheLatestDraftOnce() async {
        let autosave = DebouncedTextSave("old")
        let didWrite = XCTestExpectation(description: "saved the latest edit")
        didWrite.assertForOverFulfill = true
        var writes: [String] = []

        autosave.schedule("first edit") { value in
            writes.append(value)
            return true
        }
        autosave.schedule(" latest edit ") { value in
            writes.append(value)
            didWrite.fulfill()
            return true
        }
        autosave.flush()
        autosave.flush()

        let result = await XCTWaiter.fulfillment(of: [didWrite], timeout: 2)
        XCTAssertEqual(result, .completed)
        XCTAssertEqual(writes, ["latest edit"])
    }
}
