import XCTest

@MainActor
final class CustomerJourneys: XCTestCase {
    private enum Language: String {
        case english = "en"
        case french = "fr-CA"

        func label(_ english: String, _ french: String) -> String {
            self == .english ? english : french
        }
    }

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

    private let fixture = URL(string: "http://127.0.0.1:8765")!
    private let conversation = "20000000-0000-4000-8000-000000000010"
    private lazy var app = XCUIApplication()
    private var earlierWrites = 0

    func testOwnerEnglishLight() async throws { try await owner(.english, "light") }
    func testOwnerEnglishDark() async throws { try await owner(.english, "dark") }
    func testOwnerFrenchLight() async throws { try await owner(.french, "light") }
    func testOwnerFrenchDark() async throws { try await owner(.french, "dark") }

    func testTechnicianEnglishLight() async throws { try await technician(.english, "light") }
    func testTechnicianEnglishDark() async throws { try await technician(.english, "dark") }
    func testTechnicianFrenchLight() async throws { try await technician(.french, "light") }
    func testTechnicianFrenchDark() async throws { try await technician(.french, "dark") }

    func testBookkeeperEnglishLight() async throws { try await bookkeeper(.english, "light") }
    func testBookkeeperEnglishDark() async throws { try await bookkeeper(.english, "dark") }
    func testBookkeeperFrenchLight() async throws { try await bookkeeper(.french, "light") }
    func testBookkeeperFrenchDark() async throws { try await bookkeeper(.french, "dark") }

    func testFieldworkEnglishLight() async throws { try await fieldwork(.english, "light") }
    func testFieldworkEnglishDark() async throws { try await fieldwork(.english, "dark") }
    func testFieldworkFrenchLight() async throws { try await fieldwork(.french, "light") }
    func testFieldworkFrenchDark() async throws { try await fieldwork(.french, "dark") }

    private func owner(_ language: Language, _ theme: String) async throws {
        let text = language.label
        let suffix = "\(language.rawValue)-\(theme)"
        earlierWrites = try await allWrites().count
        try await profile(language, role: "owner", stage: "new")
        launch(language, theme)
        let signOut = button(text("Sign out", "Se déconnecter"))
        if signOut.waitForExistence(timeout: 4) { signOut.tap() }
        try reveal(button(text("New to Loonext? Create your account", "Nouveau sur Loonext ? Créez votre compte"))).tap()

        let email = "owner-\(suffix.lowercased())@example.invalid"
        try enter("Test Owner", in: app.textFields.firstMatch)
        try enter(email, in: app.textFields.element(boundBy: 1))
        try fillSignupPassword()
        let create = try reveal(button(text("Create account", "Créer le compte")))
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: create)
        let ready = await XCTWaiter.fulfillment(of: [enabled], timeout: 10)
        XCTAssertEqual(ready, .completed)
        create.tap()
        try waitFor(label(text("Check your email", "Vérifiez vos courriels")))
        shot("Owner email confirmation requested \(suffix)")
        let signup = try await write("/auth/v1/signup", field: "email", value: email)
        XCTAssertEqual(signup.body["locale"]?.text, language.rawValue)

        launch(language, theme, signIn: true)
        try waitFor(button(text("Open app.loonext.com", "Ouvrir app.loonext.com")), timeout: 30)
        shot("Owner workspace setup \(suffix)")

        try await profile(language, role: "owner", stage: "incomplete")
        try waitFor(button(text("I've done this — refresh", "C'est fait — actualiser"))).tap()
        try waitFor(button(text("Finish checkout", "Terminer le paiement")))
        shot("Owner checkout handoff \(suffix)")

        try await profile(language, role: "owner", stage: "active")
        try waitFor(button(text("I've done this — refresh", "C'est fait — actualiser"))).tap()
        try waitFor(button("Conversations"), timeout: 30)
        dismissNotificationPrimer(language)
        try waitFor(button(text("More", "Plus"))).tap()
        try waitFor(button(text("Settings", "Paramètres"))).tap()
        try reveal(label(text("Numbers", "Numéros"), prefix: true)).tap()
        try reveal(label("(416) 555-0100"))
        try reveal(button(text("Choose a number", "Choisir un numéro"))).tap()
        try waitFor(button(text("Use area code 416", "Utiliser l'indicatif 416"))).tap()
        let provision = try await write("/v1/numbers/provision", field: "requested_area_code", value: "416")
        XCTAssertFalse(provision.idempotencyKey?.isEmpty ?? true)
        let ordered = label("(416) 555-0103")
        for _ in 0..<4 where !ordered.isHittable { app.swipeDown() }
        try reveal(ordered)
        shot("Owner chose and ordered a number \(suffix)")

        try waitFor(app.navigationBars.buttons.firstMatch).tap()
        try reveal(label(text("Team", "Équipe"), prefix: true)).tap()
        let invite = "crew-\(suffix.lowercased())@example.invalid"
        try enter(invite, in: app.textFields[text("Email", "Courriel")].firstMatch)
        try reveal(button(text("Invite", "Inviter"))).tap()
        let sent = try await write("/v1/invites", field: "email", value: invite)
        XCTAssertEqual(sent.body["role"]?.text, "member")
        try reveal(label(invite))
        shot("Owner invited a teammate \(suffix)")
    }

    private func technician(_ language: Language, _ theme: String) async throws {
        let text = language.label
        let suffix = "\(language.rawValue)-\(theme)"
        earlierWrites = try await allWrites().count
        try await profile(language, role: "member", stage: "active")
        launch(language, theme, signIn: true)
        try waitFor(button("Conversations"), timeout: 30)
        dismissNotificationPrimer(language)
        let inbox = button("Conversations")
        for _ in 0..<3 where !inbox.isSelected { inbox.tap() }
        XCTAssertTrue(inbox.isSelected)
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Ada Fixture")).firstMatch
        try waitFor(row).coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()
        try waitFor(label("Test thread history"))
        shot("Technician thread \(suffix)")

        let sms = "Simulator text \(suffix)"
        try enter(sms, in: composer(text("Text message", "Texto")))
        try waitFor(button(text("Send message", "Envoyer le message"))).tap()
        let sent = try await write("/v1/messages/send", field: "body", value: sms)
        XCTAssertEqual(sent.body["conversation_id"]?.text, conversation)
        XCTAssertFalse(sent.idempotencyKey?.isEmpty ?? true)
        try waitFor(label(sms))
        shot("Technician text sent \(suffix)")

        try waitFor(button(text("Add to message", "Ajouter au message"))).tap()
        try waitFor(button("Note")).tap()
        let note = "Simulator internal note \(suffix)"
        try enter(note, in: composer(text("Write an internal note…", "Écrire une note interne…")))
        try waitFor(button(text("Save note", "Enregistrer la note"))).tap()
        _ = try await write("/v1/conversations/\(conversation)/notes", field: "body", value: note)
        try waitFor(label(note))
        shot("Technician internal note saved \(suffix)")

        try waitFor(button("Note")).tap()
        try waitFor(button(text("Text", "Texto"))).tap()
        let scheduled = "Simulator scheduled text \(suffix)"
        try enter(scheduled, in: composer(text("Text message", "Texto")))
        try waitFor(button(text("Send later", "Envoyer plus tard"))).tap()
        let nextMorning = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", text("Tomorrow", "Demain"))
        ).firstMatch
        try waitFor(nextMorning).tap()
        let queued = try await write("/v1/scheduled-messages", field: "body", value: scheduled)
        XCTAssertEqual(queued.body["conversation_id"]?.text, conversation)
        XCTAssertFalse(queued.idempotencyKey?.isEmpty ?? true)
        let sendAt = try XCTUnwrap(queued.body["send_at"]?.text)
        let sendDate = try XCTUnwrap(ISO8601DateFormatter().date(from: sendAt))
        var recipientCalendar = Calendar(identifier: .gregorian)
        recipientCalendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Toronto"))
        XCTAssertEqual(recipientCalendar.component(.hour, from: sendDate), 8)
        XCTAssertEqual(recipientCalendar.component(.minute, from: sendDate), 0)
        let writes = try await allWrites()
        XCTAssertFalse(writes.contains { record in
            record.path == "/v1/messages/send" && [note, scheduled].contains(record.body["body"]?.text ?? "")
        })
        shot("Technician text scheduled \(suffix)")

        let draft = text("I can return", "Je peux revenir")
        let suggestion = draft + text(" on Friday.", " vendredi.")
        let message = composer(text("Text message", "Texto"))
        try enter(draft, in: message)
        try waitFor(button(text("Finish with Lou", "Terminer avec Lou"))).tap()
        _ = try await write("/v1/conversations/\(conversation)/reply-suggestions", field: "draft", value: draft)
        try waitFor(button(suggestion)).tap()
        XCTAssertEqual(message.value as? String, suggestion)
        let beforeSend = try await allWrites()
        XCTAssertEqual(beforeSend.filter { $0.path == "/v1/messages/send" }.count,
                       writes.filter { $0.path == "/v1/messages/send" }.count)
        shot("Lou loaded a draft for review \(suffix)")

        try waitFor(button(text("Send message", "Envoyer le message"))).tap()
        let approved = try await write("/v1/messages/send", field: "body", value: suggestion)
        XCTAssertEqual(approved.body["conversation_id"]?.text, conversation)
        try waitFor(label(suggestion))
    }

    private func bookkeeper(_ language: Language, _ theme: String) async throws {
        let text = language.label
        try await profile(language, role: "bookkeeper", stage: "active")
        launch(language, theme, signIn: true)
        dismissNotificationPrimer(language)
        try waitFor(label(text("Payment & invoices", "Paiement et factures")), timeout: 30)
        XCTAssertFalse(button("Conversations").exists)
        XCTAssertFalse(button(text("Tasks", "Tâches")).exists)
        XCTAssertFalse(label("Ada Fixture").exists)
        shot("Bookkeeper billing \(language.rawValue)-\(theme)")
    }

    private func fieldwork(_ language: Language, _ theme: String) async throws {
        let text = language.label
        let suffix = "\(language.rawValue)-\(theme)"
        earlierWrites = try await allWrites().count
        try await profile(language, role: "member", stage: "active", fieldwork: true)
        launch(language, theme, signIn: true)
        try waitFor(button("Conversations"), timeout: 30)
        dismissNotificationPrimer(language)
        try waitFor(button(text("More", "Plus"))).tap()
        try waitFor(button("Contacts")).tap()
        try waitFor(label("Ada Fixture")).tap()
        let notes = app.descendants(matching: .any)
            .matching(NSPredicate(format: "value == %@", "Test notes")).firstMatch
        try enter("!", in: notes)
        try waitFor(app.navigationBars.buttons.firstMatch).tap()
        let contact = "/v1/contacts/20000000-0000-4000-8000-000000000020"
        _ = try await write(contact, field: "notes", value: "!Test notes")
        try waitFor(label("Ada Fixture")).tap()
        let savedNotes = app.descendants(matching: .any)
            .matching(NSPredicate(format: "value == %@", "!Test notes")).firstMatch
        try reveal(savedNotes)
        shot("Contact notes persisted \(suffix)")

        app.launch()
        try waitFor(button(text("Tasks", "Tâches")), timeout: 30).tap()
        try waitFor(label("Test boiler"))
        try waitFor(button(text("Calendar view", "Vue calendrier"))).tap()
        try waitFor(label(text(", 1 task", ", 1 tâche")))
        shot("Dated task in calendar \(suffix)")
        try waitFor(button(text("Map view", "Vue carte"))).tap()
        try waitFor(label(text("1 on the map", "1 sur la carte")))
        shot("Located task on map \(suffix)")
        try waitFor(button(text("Planner", "Planificateur"))).tap()
        try waitFor(label(text("UNSCHEDULED WORK", "TRAVAIL À PLANIFIER")))
        try waitFor(label("Test boiler"))
        shot("Task in dispatch planner \(suffix)")
    }

    private func launch(_ language: Language, _ theme: String, signIn: Bool = false) {
        app.launchArguments = ["-theme", theme, "-ui_locale", language.rawValue,
                               "-AppleLanguages", "(\(language.rawValue))",
                               "-AppleLocale", language.label("en_CA", "fr_CA")]
        if signIn {
            app.launchEnvironment["LOONEXT_QA_TEST_EMAIL"] = "qa@example.invalid"
            app.launchEnvironment["LOONEXT_QA_TEST_PASSWORD"] = "Simulator12345"
        }
        app.launch()
    }

    private func dismissNotificationPrimer(_ language: Language) {
        let later = button(language.label("Not now", "Pas maintenant"))
        if later.waitForExistence(timeout: 4) {
            later.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    private func profile(_ language: Language, role: String, stage: String, fieldwork: Bool = false) async throws {
        var url = URLComponents(url: fixture.appending(path: "__qa/profile"), resolvingAgainstBaseURL: false)!
        url.queryItems = [
            URLQueryItem(name: "locale", value: language.rawValue),
            URLQueryItem(name: "role", value: role),
            URLQueryItem(name: "stage", value: stage),
        ]
        if fieldwork { url.queryItems?.append(URLQueryItem(name: "fieldwork", value: "1")) }
        var request = URLRequest(url: try XCTUnwrap(url.url))
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }

    private func allWrites() async throws -> [Write] {
        let (data, _) = try await URLSession.shared.data(from: fixture.appending(path: "__qa/writes"))
        return try JSONDecoder().decode([Write].self, from: data)
    }

    private func write(_ path: String, field: String, value: String) async throws -> Write {
        let deadline = ContinuousClock.now + .seconds(15)
        var matches: [Write] = []
        while ContinuousClock.now < deadline {
            matches = try await allWrites().dropFirst(earlierWrites)
                .filter { $0.path == path && $0.body[field]?.text == value }
            if !matches.isEmpty { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        XCTAssertLessThanOrEqual(matches.count, 1, "Duplicate writes to \(path)")
        return try XCTUnwrap(matches.first, "No matching request to \(path)")
    }

    private func enter(_ text: String, in field: XCUIElement) throws {
        try reveal(field).tap()
        field.typeText(text)
    }

    private func fillSignupPassword() throws {
        let password = try reveal(app.secureTextFields.firstMatch)
        password.tap()
        let suggested = button("GenerateStrongPasswordButton")
        if !suggested.waitForExistence(timeout: 2) {
            password.typeText("Simulator12345")
        }
        if suggested.waitForExistence(timeout: 2) { suggested.tap() }
    }

    private func composer(_ placeholder: String) -> XCUIElement {
        let prompt = NSPredicate(format: "label == %@ OR placeholderValue == %@", placeholder, placeholder)
        let multiline = app.textViews.matching(prompt).firstMatch
        return multiline.waitForExistence(timeout: 2) ? multiline : app.textFields.matching(prompt).firstMatch
    }

    private func label(_ text: String, prefix: Bool = false) -> XCUIElement {
        let predicate = prefix ? "label BEGINSWITH %@" : "label CONTAINS %@"
        return app.descendants(matching: .any).matching(NSPredicate(format: predicate, text)).firstMatch
    }

    private func button(_ label: String) -> XCUIElement { app.buttons[label].firstMatch }

    @discardableResult
    private func waitFor(_ element: XCUIElement, timeout: TimeInterval = 15) throws -> XCUIElement {
        try XCTUnwrap(element.waitForExistence(timeout: timeout) ? element : nil, "Missing \(element)")
    }

    private func reveal(_ element: XCUIElement) throws -> XCUIElement {
        for _ in 0..<5 {
            if element.exists && element.isHittable { return element }
            app.swipeUp()
        }
        return try XCTUnwrap(element.isHittable ? element : nil, "Cannot reach \(element)")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
