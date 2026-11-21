import XCTest

@MainActor
final class DeviceChecklists: XCTestCase {
    private lazy var app = XCUIApplication()
    private lazy var springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private let fixture = URL(string: "http://127.0.0.1:8765")!

    private struct Write: Decodable {
        struct Field: Decodable {
            let text: String?

            init(from decoder: Decoder) {
                text = try? decoder.singleValueContainer().decode(String.self)
            }
        }

        let path: String
        let body: [String: Field]
        let idempotencyKey: String?
    }

    override func setUp() {
        continueAfterFailure = false
    }

    func testForegroundAlertForAnotherThread() async throws {
        try signIn(notifications: true)
        try openThread("Ada Fixture")
        try await control("push?thread=0&title=Current%20thread%20alert&inbound=1")
        XCTAssertFalse(notification("Current thread alert").waitForExistence(timeout: 2))
        try waitFor(label("Live test inbound"))
        shot("775 inbound while reading the thread")

        try await control("push?thread=1&title=Other%20thread%20alert")
        try waitFor(notification("Other thread alert"), timeout: 5)
        shot("775 other thread foreground banner")
        openNotificationCenter()
        try waitFor(notification("Other thread alert"))
        XCTAssertFalse(notification("Current thread alert").exists)
        shot("775 current thread excluded from Notification Center")
    }

    func testNotificationReply() async throws {
        let body = "Simulator shade reply"
        try signIn(notifications: true)
        XCUIDevice.shared.press(.home)
        try await control("push?thread=1&title=Reply%20from%20the%20shade")
        let title = springboard.staticTexts["Reply from the shade"].firstMatch
        let replyAction = springboard.buttons["Reply"].firstMatch
        let point = title.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5))
        if title.waitForExistence(timeout: 4), title.frame.minY < 150 {
            point.press(forDuration: 0.1, thenDragTo: point.withOffset(CGVector(dx: 0, dy: 140)))
        }
        if !replyAction.exists {
            openNotificationCenter()
            try waitFor(title)
            for _ in 0..<2 where !replyAction.exists {
                point.press(forDuration: 1.5)
            }
        }
        shot("777 native notification actions")
        try waitFor(replyAction).tap()
        let keyboardIntro = springboard.buttons["Continue"].firstMatch
        if keyboardIntro.waitForExistence(timeout: 5) {
            keyboardIntro.tap()
        }
        let reply = try waitFor(springboard.textViews.matching(
            NSPredicate(format: "identifier == %@ AND label == %@", "", "")
        ).firstMatch)
        XCTAssertTrue(reply.isHittable)
        reply.typeText(body)
        XCTAssertEqual(reply.value as? String, body)
        let send = try waitFor(springboard.buttons["Send text"].firstMatch)
        shot("777 reply ready to send in Notification Center")
        XCTAssertTrue(send.isEnabled && send.isHittable)
        send.tap()
        try await assertOneWrite(path: "/v1/messages/send", field: "body", value: body, requiresKey: true)
        app.activate()
        try openThread("Ben Fixture")
        try waitFor(label(body))
        shot("777 reply received in the fixture conversation")
    }

    func testNotificationTrayClearance() async throws {
        try signIn(notifications: true)
        try await control("push?thread=1&title=Clear%20on%20open")
        try waitFor(notification("Clear on open"), timeout: 5)
        openNotificationCenter()
        try waitFor(notification("Clear on open"))
        dismissNotificationCenter()
        try openThread("Ben Fixture")
        try waitFor(label("Second thread history"))
        openNotificationCenter()
        XCTAssertFalse(notification("Clear on open").exists)
        shot("777 opening the thread clears its card")
        dismissNotificationCenter()
        try waitFor(app.buttons["Back"].firstMatch).tap()

        try await control("push?thread=1&title=Clear%20on%20remote%20read&missed=1")
        try waitFor(notification("Clear on remote read"), timeout: 5)
        shot("777 missed-call alert")
        try await control("read")
        openNotificationCenter()
        let removed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: notification("Clear on remote read")
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
        let prompt = NSPredicate(format: "label == %@ OR placeholderValue == %@", "Text message", "Text message")
        let multiline = app.textViews.matching(prompt).firstMatch
        let composer = try waitFor(multiline.exists ? multiline : app.textFields.matching(prompt).firstMatch)
        composer.tap()
        composer.typeText("Simulator queued text")
        try waitFor(app.buttons["Send message"].firstMatch).tap()
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
        try await assertOneWrite(path: "/v1/contacts/20000000-0000-4000-8000-000000000020", field: "notes", value: "!Test notes")
        try waitFor(label("Ada Fixture")).tap()
        try reveal(field(value: "!Test notes"))
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
        try await assertOneWrite(path: "/v1/company", field: "mctb_message", value: "!Test message")
        app.activate()
        try reveal(field(value: "!Test message"))
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
        try waitFor(app.buttons["More actions for Test boiler"].firstMatch).tap()
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

    func testLongThreadRecapCitesMessages() async throws {
        try await control("long-thread")
        try signIn()
        try openThread("Ada Fixture")
        let recap = app.buttons["Recap"].firstMatch
        if recap.waitForExistence(timeout: 5) {
            recap.tap()
        } else {
            try waitFor(app.buttons["More"].firstMatch).tap()
            try reveal(label("Catch me up")).tap()
        }
        try waitFor(label("Lou's catch-up"))
        let citation = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Can u confirm Friday?")).firstMatch
        XCTAssertGreaterThan(try waitFor(citation).label.count, 300)
        try waitFor(app.buttons["Friday at ten works for me."].firstMatch)
        try waitFor(app.buttons["I still need the boiler checked 🙏"].firstMatch)
        try waitFor(app.buttons["The side door is open."].firstMatch)
        shot("794 catch-up shows four cited messages")
        try reveal(citation).tap()
        try waitFor(label("Can u confirm Friday?"))
    }

    func testCreateTaskFromSavedVoicemail() async throws {
        try await control("voicemail-event")
        try signIn()
        try openThread("Ada Fixture")
        try reveal(app.buttons["Make a task from this call"].firstMatch).tap()
        try waitFor(field(value: "Repair the boiler"))
        try waitFor(field(value: "The boiler stopped again. Could you come Wednesday morning?"))
        shot("794 task title and description came from the voicemail")
        try reveal(app.buttons["Create task"].firstMatch).tap()
        try waitFor(label("Made a task from this call."))
        try await assertOneWrite(path: "/v1/tasks", field: "source_call_id", value: "test-call")
    }

    private func signIn(notifications: Bool = false) throws {
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["LOONEXT_QA_TEST_EMAIL"] = "qa@example.invalid"
        app.launchEnvironment["LOONEXT_QA_TEST_PASSWORD"] = "Simulator12345"
        app.launch()
        app.launchEnvironment.removeValue(forKey: "LOONEXT_QA_TEST_EMAIL")
        app.launchEnvironment.removeValue(forKey: "LOONEXT_QA_TEST_PASSWORD")
        try waitFor(app.buttons["Conversations"].firstMatch, timeout: 30)
        let allow = app.buttons["Turn on notifications"].firstMatch
        if allow.waitForExistence(timeout: 4) {
            if notifications {
                let permission = springboard.buttons["Allow"].firstMatch
                for _ in 0..<2 where allow.exists && !permission.exists {
                    allow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                    if permission.waitForExistence(timeout: 3) { break }
                }
                try waitFor(permission).tap()
            } else {
                try waitFor(app.buttons["Not now"].firstMatch)
                    .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
            let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: allow)
            XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 10), .completed)
        }
    }

    private func openThread(_ name: String) throws {
        let tab = try waitFor(app.buttons["Conversations"].firstMatch, timeout: 30)
        for _ in 0..<3 where !tab.isSelected {
            tab.tap()
        }
        XCTAssertTrue(tab.isSelected)
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        try waitFor(row).coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()
        try waitFor(app.buttons["Back"].firstMatch)
    }

    private func openNotificationCenter() {
        let foreground = app.state == .runningForeground ? app : springboard
        let top = foreground.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0))
        top.press(forDuration: 0.1, thenDragTo: top.withOffset(CGVector(dx: 0, dy: 500)))
    }

    private func dismissNotificationCenter() {
        XCUIDevice.shared.press(.home)
        app.activate()
    }

    private func label(_ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func notification(_ title: String) -> XCUIElement {
        springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
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
        XCTAssertEqual(matching.first?.body[field]?.text, value)
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
