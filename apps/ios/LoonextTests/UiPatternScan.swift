import XCTest

/// One way a screen can draw a pattern by hand, as a regular expression over a source
/// file with its comments stripped.
struct PatternRule {
    let name: String
    let pattern: String
}

/// A file that may keep drawing the pattern itself, and why. An exception that no
/// longer matches anything fails, so the list cannot outlive the code it excuses.
struct PatternException {
    let file: String
    let rule: String
    let reason: String
}

/// What one #733 guard knows: the pattern it protects, the shared view that draws it,
/// the rules that spot a hand-rolled copy, and the named exceptions.
///
/// `usePattern` and `minUsers` are the other half: the shared view must be drawn by at
/// least `minUsers` files, so a scan that reads nothing cannot pass.
struct PatternGuardSpec {
    let pattern: String
    let component: String
    let sharedFiles: Set<String>
    let rules: [PatternRule]
    let exceptions: [PatternException]
    let usePattern: String
    let minUsers: Int
}

/// The source scan every #733 pattern guard shares (empty state, load error, list
/// skeleton, confirm dialog, search field, segmented control, count pill).
///
/// Four properties, the same four the web guards state:
///
/// P-0  the scan read source files and the shared view is in use.
/// P-1  no file outside the shared view draws the pattern itself, unless named.
/// P-2  the exceptions are closed: an entry whose file no longer draws it fails.
/// P-3  every exception gives a reason.
enum UiPatternScan {
    struct Hit {
        let file: String
        let rule: String
    }

    struct Result {
        let fileCount: Int
        let hits: [Hit]
        let users: Int
    }

    /// Walk up from this file to the app's `Loonext` folder, the way the other source
    /// scans in this target do.
    static func sourceRoot() throws -> URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir.appendingPathComponent("Loonext")
            if FileManager.default.fileExists(
                atPath: candidate.appendingPathComponent("Support").path
            ) {
                return candidate
            }
            dir = dir.deletingLastPathComponent()
        }
        throw missingSource("Loonext/Support, walking up from \(#filePath)")
    }

    static func stripComments(_ text: String) -> String {
        var out = text.replacingOccurrences(of: "\r\n", with: "\n")
        for pattern in [#"/\*[\s\S]*?\*/"#, #"(^|\s)//[^\n]*"#] {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(out.startIndex..., in: out)
            out = regex.stringByReplacingMatches(in: out, range: range, withTemplate: "$1")
        }
        return out
    }

    private static func matches(_ pattern: String, in text: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            XCTFail("bad pattern: \(pattern)")
            return false
        }
        return regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    static func scan(_ spec: PatternGuardSpec) throws -> Result {
        let base = try sourceRoot()
        let walker = try XCTUnwrap(
            FileManager.default.enumerator(at: base, includingPropertiesForKeys: nil)
        )
        var count = 0
        var users = 0
        var hits: [Hit] = []
        for case let url as URL in walker where url.pathExtension == "swift" {
            let relative = String(url.path.dropFirst(base.path.count + 1))
            if spec.sharedFiles.contains(relative) { continue }
            let text = stripComments(try String(contentsOf: url, encoding: .utf8))
            count += 1
            if matches(spec.usePattern, in: text) { users += 1 }
            for rule in spec.rules where matches(rule.pattern, in: text) {
                hits.append(Hit(file: relative, rule: rule.name))
            }
        }
        return Result(fileCount: count, hits: hits, users: users)
    }

    // MARK: - The four properties

    static func assertScanIsAlive(
        _ spec: PatternGuardSpec,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let result = try scan(spec)
        XCTAssertGreaterThan(result.fileCount, 0, "the scan read no source files", file: file, line: line)
        XCTAssertGreaterThanOrEqual(
            result.users,
            spec.minUsers,
            "\(spec.component) is drawn by \(result.users) files out of \(result.fileCount); "
                + "expected at least \(spec.minUsers). A scan that finds the shared view "
                + "nowhere is not reading the app.",
            file: file,
            line: line
        )
        for shared in spec.sharedFiles {
            let url = try sourceRoot().appendingPathComponent(shared)
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: url.path),
                "the shared file \(shared) is gone; re-point the guard at its replacement",
                file: file,
                line: line
            )
        }
    }

    static func assertNoHandRolledCopies(
        _ spec: PatternGuardSpec,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let result = try scan(spec)
        let unlisted = result.hits
            .filter { hit in
                !spec.exceptions.contains { $0.file == hit.file && $0.rule == hit.rule }
            }
            .map { "\($0.file)  [\($0.rule)]" }
        XCTAssertEqual(
            unlisted,
            [],
            "Scanned \(result.fileCount) files. These draw the \(spec.pattern) pattern "
                + "themselves. Use \(spec.component), or name the exception, with its "
                + "reason, in this guard:\n" + unlisted.joined(separator: "\n"),
            file: file,
            line: line
        )
    }

    static func assertExceptionsAreCurrent(
        _ spec: PatternGuardSpec,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let result = try scan(spec)
        let stale = spec.exceptions
            .filter { entry in
                !result.hits.contains { $0.file == entry.file && $0.rule == entry.rule }
            }
            .map { "\($0.file)  [\($0.rule)]" }
        XCTAssertEqual(
            stale,
            [],
            "These exceptions no longer match any code. Delete them.",
            file: file,
            line: line
        )
    }

    static func assertEveryExceptionGivesAReason(
        _ spec: PatternGuardSpec,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let thin = spec.exceptions
            .filter { $0.reason.trimmingCharacters(in: .whitespaces).count < 15 }
            .map(\.file)
        XCTAssertEqual(thin, [], "an exception needs a reason of its own", file: file, line: line)
    }
}
