import XCTest

@MainActor
final class DeviceChecklists: XCTestCase {
    private let app = XCUIApplication()
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private let fixture = URL(string: "http://127.0.0.1:8765")!

    private struct Write: Decodable {
        let path: String
        let body: [String: String?]
        let idempotencyKey: String?
    }

    override func setUp() {
        continueAfterFailure = false
    }

    func testForegroundAlertForAnotherThread() async throws {
        try signIn()
        try openThread("Ada Fixture")
        try await control("push?thread=0&title=Current%20thread%20alert&inbound=1")
        try waitFor(label("Live test inbound"))
        shot("775 inbound while reading the thread")

        try await control("push?thread=1&title=Other%20thread%20alert")
        let banner = springboard.staticTexts["Other thread alert"].firstMatch
        try waitFor(banner, timeout: 5)
        shot("775 other thread foreground banner")
        openNotificationCenter()
        try waitFor(springboard.staticTexts["Other thread alert"].firstMatch)
        XCTAssertFalse(springboard.staticTexts["Current thread alert"].exists)
        shot("775 current thread excluded from Notification Center")
    }

    func testNotificationReplyAndTrayClearance() async throws {
        try signIn()
        XCUIDevice.shared.press(.home)
        try await control("push?thread=1&title=Reply%20from%20the%20shade")
        openNotificationCenter()
        let replyCard = springboard.staticTexts["Reply from the shade"].firstMatch
        try waitFor(replyCard).press(forDuration: 1.1)
        try waitFor(springboard.buttons["Reply"].firstMatch).tap()
        let reply = try waitFor(springboard.textFields.firstMatch)
        reply.tap()
        reply.typeText("Simulator shade reply")
        try waitFor(springboard.buttons["Send text"].firstMatch).tap()
        try await assertOneWrite(path: "/v1/messages/send", field: "body", value: "Simulator shade reply", requiresKey: true)
        shot("777 notification reply")

        app.activate()
        try await control("push?thread=1&title=Clear%20on%20open")
        try waitFor(springboard.staticTexts["Clear on open"].firstMatch, timeout: 5)
        openNotificationCenter()
        try waitFor(springboard.staticTexts["Clear on open"].firstMatch).tap()
        try waitFor(label("Second thread history"))
        openNotificationCenter()
        XCTAssertFalse(springboard.staticTexts["Clear on open"].exists)
        shot("777 opening the thread clears its card")
        dismissNotificationCenter()
        try waitFor(app.buttons["Back"].firstMatch).tap()

        try await control("push?thread=1&title=Clear%20on%20remote%20read&missed=1")
        try waitFor(springboard.staticTexts["Clear on remote read"].firstMatch, timeout: 5)
        shot("777 missed-call alert")
        try await control("read")
        openNotificationCenter()
        let removed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: springboard.staticTexts["Clear on remote read"].firstMatch
        )
        let result = await XCTWaiter.fulfillment(of: [removed], timeout: 10)
        XCTAssertEqual(result, .completed)
        shot("777 remote read clears the card")
    }

    func testOfflineRelaunchAndOutbox() async throws {
        try signIn()
        try openThread("Ada Fixture")
        try waitFor(label("Test thread history"))
        try await control("mode?value=offline")
        let composer = try waitFor(app.textViews.firstMatch)
        composer.tap()
        composer.typeText("Simulator queued text")
        try waitFor(app.buttons["Send text"].firstMatch).tap()
        try waitFor(label("Queued"))
        shot("778 queued during transport loss")
        app.terminate()
        app.launch()
        try openThread("Ada Fixture")
        try waitFor(label("Test thread history"))
        shot("778 cached thread after process relaunch")
        app.terminate()

        try await control("mode?value=online")
        app.launch()
        try await assertOneWrite(path: "/v1/messages/send", field: "body", value: "Simulator queued text", requiresKey: true)
        shot("778 outbox replay after reconnect")

        try await control("mode?value=revoked")
        app.terminate()
        app.launch()
        try waitFor(app.buttons["Sign in"].firstMatch)
        shot("778 revoked session returns to sign-in")
    }

    func testContactNotesSaveOnBack() async throws {
        try signIn()
        try waitFor(app.buttons["More"].firstMatch).tap()
        try waitFor(app.buttons["Contacts"].firstMatch).tap()
        try waitFor(label("Ada Fixture")).tap()
        let notes = try reveal(field(value: "Test notes"))
        notes.tap()
        let back = app.navigationBars.buttons.firstMatch
        try waitFor(back)
        notes.typeText("!")
        back.tap()
        try await assertOneWrite(path: "/v1/contacts/20000000-0000-4000-8000-000000000020", field: "notes", value: "Test notes!")
        try waitFor(label("Ada Fixture")).tap()
        try reveal(field(value: "Test notes!"))
        shot("780 contact notes persisted after back")
    }

    func testCallingSettingSavesOnBackground() async throws {
        try signIn()
        try waitFor(app.buttons["More"].firstMatch).tap()
        try waitFor(app.buttons["Settings"].firstMatch).tap()
        try reveal(label("Calling")).tap()
        let message = try reveal(field(value: "Test message"))
        message.tap()
        message.typeText("!")
        XCUIDevice.shared.press(.home)
        try await assertOneWrite(path: "/v1/company", field: "mctb_message", value: "Test message!")
        app.activate()
        try reveal(field(value: "Test message!"))
        shot("780 calling setting persisted after background")
    }

    func testSettingsLabelsAndTaskDeleteCopy() throws {
        try signIn()
        try waitFor(app.buttons["More"].firstMatch).tap()
        try waitFor(app.buttons["Settings"].firstMatch).tap()
        try reveal(label("Calling")).tap()
        try waitFor(label("Text back a missed call"))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", #"settings[A-Za-z]*\.[A-Za-z0-9]+"#)).firstMatch.exists)
        shot("805 settings display readable labels")

        app.terminate()
        app.launch()
        try waitFor(app.buttons["Tasks"].firstMatch).tap()
        try waitFor(label("Test boiler")).press(forDuration: 1.1)
        try waitFor(app.buttons["Delete task"].firstMatch).tap()
        try waitFor(label("This task will be removed for everyone on your team."))
        shot("805 task list delete confirmation")
    }

    func testVoicemailPlaybackProgress() throws {
        try signIn()
        try waitFor(app.buttons["Conversations"].firstMatch).tap()
        try waitFor(app.buttons["Calls"].firstMatch).tap()
        try reveal(app.buttons["Play voicemail"].firstMatch).tap()
        try waitFor(app.buttons["Pause voicemail"].firstMatch)
        try waitFor(label("0:01 / 0:05"), timeout: 4)
        shot("805 voicemail playback advances")
    }

    private func signIn() throws {
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let email = app.textFields["Email"].firstMatch
        let shell = app.buttons["Conversations"].firstMatch
        if email.waitForExistence(timeout: 5) {
            email.tap()
            email.typeText("qa@example.invalid")
            let password = try waitFor(app.secureTextFields.firstMatch)
            password.tap()
            password.typeText("Simulator12345")
            try waitFor(app.buttons["Sign in"].firstMatch).tap()
        }
        let allow = app.buttons["Turn on notifications"].firstMatch
        if allow.waitForExistence(timeout: 4) {
            allow.tap()
            try waitFor(springboard.buttons["Allow"].firstMatch).tap()
        }
        try waitFor(shell, timeout: 30)
    }

    private func openThread(_ name: String) throws {
        try waitFor(app.buttons["Conversations"].firstMatch, timeout: 30).tap()
        try waitFor(label(name)).tap()
    }

    private func openNotificationCenter() {
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0))
        top.press(forDuration: 0.1, thenDragTo: top.withOffset(CGVector(dx: 0, dy: 500)))
    }

    private func dismissNotificationCenter() {
        springboard.swipeUp()
    }

    private func label(_ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func field(value: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "value == %@", value)).firstMatch
    }

    @discardableResult
    private func waitFor(_ element: XCUIElement, timeout: TimeInterval = 15) throws -> XCUIElement {
        try XCTUnwrap(element.waitForExistence(timeout: timeout) ? element : nil, "Missing \(element)")
    }

    @discardableResult
    private func reveal(_ element: XCUIElement) throws -> XCUIElement {
        for _ in 0..<5 {
            if element.exists && element.isHittable { return element }
            app.swipeUp()
        }
        return try XCTUnwrap(element.isHittable ? element : nil, "Cannot reach \(element)")
    }

    private func control(_ path: String) async throws {
        var request = URLRequest(url: URL(string: "/__qa/\(path)", relativeTo: fixture)!)
        request.httpMethod = "POST"
        let (body, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200, String(decoding: body, as: UTF8.self))
    }

    private func assertOneWrite(path: String, field: String, value: String, requiresKey: Bool = false) async throws {
        let url = fixture.appending(path: "__qa/writes")
        let deadline = ContinuousClock.now + .seconds(15)
        var matching: [Write] = []
        while ContinuousClock.now < deadline {
            let (data, _) = try await URLSession.shared.data(from: url)
            matching = try JSONDecoder().decode([Write].self, from: data).filter { $0.path == path }
            if !matching.isEmpty { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        XCTAssertEqual(matching.count, 1)
        XCTAssertEqual(matching.first?.body[field] ?? nil, value)
        if requiresKey { XCTAssertFalse(matching.first?.idempotencyKey?.isEmpty ?? true) }
        try await Task.sleep(for: .seconds(1))
        let (data, _) = try await URLSession.shared.data(from: url)
        let writes = try JSONDecoder().decode([Write].self, from: data).filter { $0.path == path }
        XCTAssertEqual(writes.count, 1, "Duplicate write after the debounce window")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
