import XCTest

@testable import Loonext

/// #690: references in notes, descriptions and comments.
///
/// The scan is a hand port of `packages/shared/src/task-references.ts`, and the
/// cases are the ones the TypeScript generates into
/// `packages/shared/vectors/task-references.json`, read from the repository the
/// same way `ParityVectorsTests` reads its own. A port that merely transliterated
/// would agree with itself; the vectors are what it has to agree with.
final class TaskReferencesTests: XCTestCase {
    private struct Vector: Decodable {
        struct Token: Decodable {
            let kind: String
            let key: String
            let start: Int
            let end: Int
        }

        struct At: Decodable {
            let start: Int
            let query: String
        }

        let kind: String
        let text: String
        let tokens: [Token]?
        let caret: Int?
        let at: At?
    }

    private func vectors() throws -> [Vector] {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir
                .appendingPathComponent("packages/shared/vectors")
                .appendingPathComponent("task-references.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try JSONDecoder().decode([Vector].self, from: Data(contentsOf: candidate))
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTFail("task-references.json not found; run node scripts/generate-parity-vectors.mjs")
        return []
    }

    func testTokensMatchTheSharedVectors() throws {
        let cases = try vectors().filter { $0.kind == "tokens" }
        XCTAssertFalse(cases.isEmpty, "no token vectors")
        for vector in cases {
            let found = parseReferenceTokens(vector.text)
            let expected = vector.tokens ?? []
            XCTAssertEqual(found.count, expected.count, "token count for: \(vector.text)")
            for (got, want) in zip(found, expected) {
                XCTAssertEqual(got.kind.rawValue, want.kind, vector.text)
                XCTAssertEqual(got.key, want.key, vector.text)
                XCTAssertEqual(got.start, want.start, vector.text)
                XCTAssertEqual(got.end, want.end, vector.text)
            }
        }
    }

    func testQueriesMatchTheSharedVectors() throws {
        let cases = try vectors().filter { $0.kind == "query" }
        XCTAssertFalse(cases.isEmpty, "no query vectors")
        for vector in cases {
            let found = referenceQueryAt(vector.text, caret: vector.caret ?? 0)
            if let want = vector.at {
                XCTAssertEqual(found?.start, want.start, vector.text)
                XCTAssertEqual(found?.query, want.query, vector.text)
            } else {
                XCTAssertNil(found, vector.text)
            }
        }
    }

    func testThePickerWritesPlainText() {
        XCTAssertEqual(taskReferenceText(142), "#T-142")
        XCTAssertEqual(taskNumberLabel(142), "T-142")
        XCTAssertEqual(
            recordReferenceText(.contact, id: "1A2B3C4D-0000-4000-8000-000000000001"),
            "#contact-1a2b3c4d"
        )
        XCTAssertEqual(
            recordReferenceText(.conversation, id: "abcdef01-0000-4000-8000-000000000001"),
            "#conv-abcdef01"
        )
    }

    func testWhatThePickerWritesIsReadBackAsTheSameReference() {
        let text = "see "
            + taskReferenceText(7) + " and "
            + recordReferenceText(.contact, id: "1a2b3c4d-0000-4000-8000-000000000001") + " and "
            + recordReferenceText(.conversation, id: "abcdef01-0000-4000-8000-000000000001")
        let tokens = parseReferenceTokens(text)
        XCTAssertEqual(tokens.map(\.kind), [.task, .contact, .conversation])
        XCTAssertEqual(tokens.map(\.key), ["7", "1a2b3c4d", "abcdef01"])
    }

    func testPickingReplacesTheHashTheMemberTyped() {
        XCTAssertEqual(insertingReference(into: "see #", insert: "#T-142"), "see #T-142 ")
        XCTAssertEqual(insertingReference(into: "see #fur", insert: "#T-142"), "see #T-142 ")
        XCTAssertEqual(insertingReference(into: "#", insert: "#T-1"), "#T-1 ")
        // The hash was deleted before choosing: the reference is not glued to a word.
        XCTAssertEqual(insertingReference(into: "abc", insert: "#T-1"), "abc #T-1 ")
    }

    func testThePickerOpensOnlyOnAFreshHashAppendedByTyping() {
        XCTAssertTrue(opensReferencePicker(previous: "see ", value: "see #"))
        XCTAssertTrue(opensReferencePicker(previous: "", value: "#"))
        // Glued to a word: a URL fragment or "No.#4".
        XCTAssertFalse(opensReferencePicker(previous: "No", value: "No#"))
        // Not a single typed character: a paste or a restored draft.
        XCTAssertFalse(opensReferencePicker(previous: "", value: "see #"))
        XCTAssertFalse(opensReferencePicker(previous: "see #", value: "see #T"))
    }

    // MARK: A text to a customer never reads "#"

    func testAHashInATextToACustomerIsAHashAndOpensNothing() {
        // The composer asks this one function; a text is not a note.
        XCTAssertFalse(
            composerOpensReferencePicker(
                isNote: false, enabled: true, previous: "see ", value: "see #"
            )
        )
        XCTAssertFalse(
            composerOpensReferencePicker(
                isNote: false, enabled: true, previous: "", value: "#"
            )
        )
        // A note with the search wired opens it; a note without it does not.
        XCTAssertTrue(
            composerOpensReferencePicker(
                isNote: true, enabled: true, previous: "see ", value: "see #"
            )
        )
        XCTAssertFalse(
            composerOpensReferencePicker(
                isNote: true, enabled: false, previous: "see ", value: "see #"
            )
        )
    }

    @MainActor
    func testTypingATaskNumberIntoATextLeavesItAsTyped() {
        let suite = "task-references-tests"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let state = ComposerState(draftKey: "refs-test", drafts: ComposerDrafts(defaults: defaults))
        XCTAssertEqual(state.mode, .text)
        state.onTextChange("#")
        XCTAssertEqual(state.text, "#")
        state.onTextChange("#T-142")
        XCTAssertEqual(state.text, "#T-142")
        // And nothing the picker would do is asked of a text.
        XCTAssertFalse(
            composerOpensReferencePicker(
                isNote: state.mode == .note, enabled: true, previous: "", value: "#"
            )
        )
    }

    /// The composer opens the picker in one place, and only through the rule.
    /// Read as text, like `CancelOneActionTests`, because the view itself cannot
    /// be driven from a unit test.
    func testTheComposerOpensThePickerOnlyThroughTheRule() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Loonext/Features/Compose/Composer.swift")
        let source = try String(contentsOf: url, encoding: .utf8)
        XCTAssertEqual(source.components(separatedBy: "referencePickerOpen = true").count - 1, 1)
        let guarded = source.components(separatedBy: "composerOpensReferencePicker(")
        XCTAssertEqual(guarded.count, 2, "the composer asks the rule exactly once")
        XCTAssertTrue(
            guarded[1].contains("isNote: isNote"),
            "the rule is given the real mode, not a constant"
        )
    }

    // MARK: Chips

    private func answer() -> ResolvedReferences {
        ResolvedReferences(
            tasks: [ResolvedTaskRef(number: 142, id: "task-id", title: "Replace filter", done: false)],
            contacts: [ResolvedContactRef(prefix: "1a2b3c4d", id: "contact-id", name: "Jane Smith")],
            conversations: [
                ResolvedConversationRef(prefix: "abcdef01", id: "conv-id", contact_name: "Jane Smith"),
            ]
        )
    }

    func testResolvedTokensBecomeChipsAndUnknownOnesStayPlain() {
        let text = "#T-142 #contact-1a2b3c4d #conv-abcdef01 #T-999"
        let tokens = parseReferenceTokens(text)
        var cache = ReferenceCache()
        XCTAssertEqual(cache.missing(tokens).count, 4)
        cache.record(asking: tokens, answer: answer())
        XCTAssertEqual(cache.chip(for: tokens[0])?.label, "T-142 Replace filter")
        XCTAssertEqual(cache.chip(for: tokens[0])?.done, false)
        XCTAssertEqual(cache.chip(for: tokens[0])?.targetId, "task-id")
        XCTAssertEqual(cache.chip(for: tokens[1])?.label, "Jane Smith")
        XCTAssertEqual(cache.chip(for: tokens[2])?.label, "Jane Smith")
        XCTAssertNil(cache.chip(for: tokens[3]), "an unanswered token stays plain text")
    }

    func testAnAnsweredTokenIsNotAskedAgainUntilItsAnswerIsStale() {
        let tokens = parseReferenceTokens("#T-142")
        var cache = ReferenceCache()
        let start = Date(timeIntervalSince1970: 1_000_000)
        cache.record(asking: tokens, answer: answer(), now: start)
        XCTAssertTrue(cache.missing(tokens, now: start.addingTimeInterval(30)).isEmpty)
        XCTAssertEqual(
            cache.missing(tokens, now: start.addingTimeInterval(ReferenceCache.timeToLive + 1)).count,
            1
        )
    }

    func testAReferenceThatStopsResolvingStopsDrawingAsAChip() {
        let tokens = parseReferenceTokens("#T-142")
        var cache = ReferenceCache()
        cache.record(asking: tokens, answer: answer())
        XCTAssertNotNil(cache.chip(for: tokens[0]))
        // Deleted, or a number this member is now denied.
        cache.record(asking: tokens, answer: ResolvedReferences())
        XCTAssertNil(cache.chip(for: tokens[0]))
    }

    func testTheResolveQueryCarriesEachKindOnce() {
        let tokens = parseReferenceTokens("#T-142 #T-142 #T-7 #contact-1a2b3c4d")
        let query = referenceResolveQuery(tokens)
        XCTAssertEqual(query["tasks"] ?? nil, "142,7")
        XCTAssertEqual(query["contacts"] ?? nil, "1a2b3c4d")
        XCTAssertNil(query["conversations"] ?? nil)
    }

    func testTheChipTextCarriesOpenOrDone() {
        let open = ReferenceChipInfo(kind: .task, targetId: "a", label: "T-1 X", done: false)
        let done = ReferenceChipInfo(kind: .task, targetId: "a", label: "T-1 X", done: true)
        XCTAssertNotEqual(referenceChipText(open), referenceChipText(done))
        XCTAssertTrue(referenceChipText(open).hasSuffix("T-1 X"))
        XCTAssertEqual(
            referenceChipText(ReferenceChipInfo(kind: .contact, targetId: "c", label: "Jane", done: false)),
            "Jane"
        )
    }

    func testTheLinkURLRoundTrips() {
        let url = ReferenceLink.url(kind: .conversation, id: "11111111-2222-3333-4444-555555555555")
        let target = url.flatMap { ReferenceLink.target(of: $0) }
        XCTAssertEqual(target?.kind, .conversation)
        XCTAssertEqual(target?.id, "11111111-2222-3333-4444-555555555555")
        XCTAssertNil(ReferenceLink.target(of: URL(string: "https://example.com/task/1")!))
    }

    // MARK: Picker rows, links, errors, activity

    func testPickRowsLeaveOutATaskWithoutANumber() {
        let numbered = TaskItem(
            id: "t1", company_id: "c", message_id: nil, conversation_id: nil,
            title: "Order the part", description: "", assigned_user_id: nil, due_at: nil,
            created_by_user_id: "u", created_at: "2026-11-10T12:00:00Z",
            updated_at: "2026-11-10T12:00:00Z", done: false, status: "open",
            contact: nil, attachment_count: nil, number: 139
        )
        let plain = TaskItem(
            id: "t2", company_id: "c", message_id: nil, conversation_id: nil,
            title: "Old row", description: "", assigned_user_id: nil, due_at: nil,
            created_by_user_id: "u", created_at: "2026-11-10T12:00:00Z",
            updated_at: "2026-11-10T12:00:00Z", done: false, status: "open",
            contact: nil, attachment_count: nil
        )
        let picks = referencePicks(tasks: [numbered, plain], search: nil)
        XCTAssertEqual(picks.count, 1)
        XCTAssertEqual(picks[0].insertText, "#T-139")
        XCTAssertEqual(picks[0].title, "T-139 Order the part")
        XCTAssertEqual(picks[0].targetId, "t1")
    }

    func testRefusedLinksAreSaidPlainly() {
        let conflict = ApiError(code: ApiErrorCode.conflict, message: "x", httpStatus: 409)
        let loop = ApiError(code: ApiErrorCode.validationFailed, message: "x", httpStatus: 422)
        let other = ApiError(code: ApiErrorCode.internalError, message: "x", httpStatus: 500)
        XCTAssertEqual(taskLinkErrorKey(conflict), "taskRefs.errHasParent")
        XCTAssertEqual(taskLinkErrorKey(loop), "taskRefs.errRejected")
        XCTAssertNil(taskLinkErrorKey(other))
        for key in ["taskRefs.errHasParent", "taskRefs.errRejected"] {
            XCTAssertNotEqual(AppStrings.translate("en", key), key)
            XCTAssertNotEqual(AppStrings.translate("fr-CA", key), key)
        }
    }

    func testLinkResponsesDecode() throws {
        let json = """
        {"data":[{"relation":"blocked_by","task_id":"t2","number":139,"title":"Order the part","done":false},
                 {"relation":"sub_task","task_id":"t3","number":140,"title":"Call supplier","done":true}]}
        """
        let page = try JSONDecoder().decode(Page<TaskLink>.self, from: Data(json.utf8))
        XCTAssertEqual(page.data.map(\.relation), ["blocked_by", "sub_task"])
        XCTAssertEqual(page.data[1].done, true)
        let linked = """
        {"data":[{"id":"t1","number":142,"title":"Replace filter","done":false,
                  "due_at":null,"how":["anchored","mentioned"]}]}
        """
        let tasks = try JSONDecoder().decode(Page<LinkedTask>.self, from: Data(linked.utf8))
        XCTAssertEqual(tasks.data[0].how, ["anchored", "mentioned"])
    }

    func testActivitySentencesNameTheOtherSide() throws {
        let json = """
        {"kind":"reference","id":"r1","created_at":"2026-11-10T12:00:00Z",
         "direction":"in","source_kind":"note","conversation_id":"c1",
         "contact":{"id":"k1","name":"Jane Smith"},"task":null,
         "author":{"user_id":"u1","display_name":"Rehman"}}
        """
        let item = try JSONDecoder().decode(TaskFeedItem.self, from: Data(json.utf8))
        let note = taskReferenceSentence(item, by: "Rehman", locale: "en")
        XCTAssertTrue(note.contains("Jane Smith"))
        XCTAssertTrue(note.contains("Rehman"))

        let fromTask = try JSONDecoder().decode(
            TaskFeedItem.self,
            from: Data(
                """
                {"kind":"reference","id":"r2","created_at":"2026-11-10T12:00:00Z",
                 "direction":"in","source_kind":"task_comment",
                 "task":{"id":"t9","number":139,"title":"Order the part"}}
                """.utf8
            )
        )
        XCTAssertTrue(taskReferenceSentence(fromTask, by: "Rehman", locale: "en").contains("T-139 Order the part"))

        let out = try JSONDecoder().decode(
            TaskFeedItem.self,
            from: Data(
                """
                {"kind":"reference","id":"r3","created_at":"2026-11-10T12:00:00Z",
                 "direction":"out","source_kind":"task_description","target_kind":"contact",
                 "contact":{"id":"k1","name":"Jane Smith"}}
                """.utf8
            )
        )
        XCTAssertEqual(
            taskReferenceSentence(out, by: "Rehman", locale: "en"),
            "Linked to contact Jane Smith"
        )
    }

    func testLinkEventsNameTheTask() throws {
        let added = try JSONDecoder().decode(
            TaskFeedItem.self,
            from: Data(
                """
                {"kind":"event","id":"e1","created_at":"2026-11-10T12:00:00Z","event":"link_added",
                 "to":{"relation":"blocked_by","task_id":"t2","number":139,"title":"Order the part"}}
                """.utf8
            )
        )
        let sentence = taskLinkSentence(added, by: "Rehman", locale: "en")
        XCTAssertTrue(sentence.contains("T-139 Order the part"))
        XCTAssertTrue(sentence.contains("blocked by"))

        let removed = try JSONDecoder().decode(
            TaskFeedItem.self,
            from: Data(
                """
                {"kind":"event","id":"e2","created_at":"2026-11-10T12:00:00Z","event":"link_removed",
                 "from":{"relation":"sub_task","task_id":"t3","number":140,"title":"Call supplier"}}
                """.utf8
            )
        )
        XCTAssertTrue(taskLinkSentence(removed, by: "Rehman", locale: "en").contains("T-140 Call supplier"))
    }
}
