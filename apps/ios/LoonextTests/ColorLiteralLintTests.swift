import XCTest

/// #320 — a literal colour in a view is how a theme bug gets authored.
///
/// The web app's twin (`token-discipline.test.ts`) was written after measuring
/// that its hex literals sat in *the same files that had the theme bugs*.
/// Android has `ColorLiteralLintTest`. This is the iOS side.
///
/// iOS is CLEAN today: the sweep that motivated this found five hits outside
/// `Theme/`, and every one is legitimate — three `Color.black` shadows, Apple's
/// own sign-in button style, and the tag colour the SERVER sends. The point is
/// not to fix something; it is that "clean" was true by luck rather than by
/// rule, because nothing had ever looked. `BrandColor` resolves per trait
/// collection, so a view that reads it gets both themes for free; a literal
/// gets whichever mode its author had open.
final class ColorLiteralLintTests: XCTestCase {

    /// Files that may hold a literal, each with the reason it is not a theming
    /// decision. "Add it to the list" is how a lint stops linting, so an entry
    /// has to be a claim of that kind and not a convenience.
    private let allowed: [String: String] = [
        "Features/Inbox/InboxTab.swift":
            "the tag colour arrives from the server as a hex string a person picked "
            + "in the product; `Color(hex: parsed)` renders what they chose, and "
            + "there is no token for a value we do not own.",
    ]

    /// What counts as painting a literal. Deliberately narrow. `Color.black`
    /// inside a `.shadow(…)` is absent on purpose: a shadow is a dark
    /// translucent smudge in BOTH themes — that is what a shadow is — so it is
    /// not a mode-dependent decision the way a fill is, and none of the theme
    /// bugs #320 lists was a shadow. The same narrowing the web and Android
    /// guards make. A lint with false positives is a lint people switch off.
    private let patterns = [
        "Color\\(hex:",
        "Color\\(red:",
        "UIColor\\(red:",
        "Color\\(\\.sRGB",
        "\\.foregroundStyle\\(\\.white\\)",
        "\\.foregroundStyle\\(\\.black\\)",
        "\\.fill\\(\\.white\\)",
        "\\.fill\\(\\.black\\)",
    ]

    private func paintsALiteral(_ line: String) -> Bool {
        patterns.contains { line.range(of: $0, options: .regularExpression) != nil }
    }

    private func sourceRoot() throws -> URL {
        // The test bundle lives in DerivedData, so walk up to the repo copy of
        // the sources rather than guessing a working directory.
        var dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
        dir.appendPathComponent("Loonext")
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue
        else {
            throw XCTSkip("iOS sources not present at \(dir.path)")
        }
        return dir
    }

    private func swiftFiles(_ root: URL) -> [URL] {
        guard let walker = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: nil
        ) else { return [] }
        return walker.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
    }

    func testNoViewOutsideTheThemeHardcodesAColour() throws {
        let root = try sourceRoot()
        var offenders: [String] = []

        for file in swiftFiles(root) {
            let relative = file.path
                .replacingOccurrences(of: root.path + "/", with: "")
                .replacingOccurrences(of: "\\", with: "/")
            // `Theme/` IS the place colours are written down.
            if relative.hasPrefix("Theme/") { continue }
            if allowed[relative] != nil { continue }
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }

            let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            for (index, line) in lines.enumerated() where paintsALiteral(String(line)) {
                offenders.append("\(relative):\(index + 1)")
            }
        }

        XCTAssertEqual(
            offenders, [String](),
            "\n\nColour literal(s) outside Theme/:\n  \(offenders.joined(separator: "\n  "))\n\n"
                + "A literal gets whichever theme its author had open. Read BrandColor "
                + "and both modes follow for free, because it resolves per trait "
                + "collection. If this view genuinely draws a colour we do not own (a "
                + "platform API's own enum, a value the server sends), add it to "
                + "`allowed` with that reason. Convenience is not a reason."
        )
    }

    func testEveryExceptionCarriesAReasonAndIsStillNeeded() throws {
        let root = try sourceRoot()
        for (relative, reason) in allowed {
            XCTAssertGreaterThan(reason.count, 40, "\(relative) needs a real reason")
            let path = root.appendingPathComponent(relative)
            guard let text = try? String(contentsOf: path, encoding: .utf8) else {
                XCTFail("\(relative) is in `allowed` but gone from the tree")
                continue
            }
            // An entry for a file that no longer paints a literal is an
            // invitation to put one back without anybody noticing.
            let stillPaints = text
                .split(separator: "\n", omittingEmptySubsequences: false)
                .contains { paintsALiteral(String($0)) }
            XCTAssertTrue(
                stillPaints,
                "\(relative) has no literal left — remove it from `allowed`"
            )
        }
    }

    /// #320 — the iOS twin of `PortalScope` on web and the `LoonextTheme` lint
    /// on Android.
    ///
    /// `BrandColor` resolves per `UITraitCollection`, so a view that PINS the
    /// colour scheme freezes every token under it into one theme regardless of
    /// what the person chose. It is the same class of fault as a portal
    /// escaping its token scope: every colour correct, the wrong resolution
    /// context, and nothing in the build with an opinion about it.
    ///
    /// Two placements are legitimate and no others:
    ///   - `LoonextApp.swift`, which pins the scheme the USER selected — that
    ///     is the setting doing its job;
    ///   - `#Preview` blocks, which pin light AND dark deliberately so a
    ///     regression shows on the canvas.
    func testNoViewPinsTheColourSchemeForTheUser() throws {
        let root = try sourceRoot()
        var offenders: [String] = []

        for file in swiftFiles(root) {
            let relative = file.path
                .replacingOccurrences(of: root.path + "/", with: "")
                .replacingOccurrences(of: "\\", with: "/")
            // The app root is where the user's choice is applied.
            if relative == "LoonextApp.swift" { continue }
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }

            let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            var inPreview = false
            var depth = 0
            for (index, raw) in lines.enumerated() {
                let line = String(raw)
                if line.contains("#Preview") { inPreview = true; depth = 0 }
                if inPreview {
                    depth += line.filter { $0 == "{" }.count
                    depth -= line.filter { $0 == "}" }.count
                    if depth <= 0 && !line.contains("#Preview") { inPreview = false }
                }
                if line.contains(".preferredColorScheme(") && !inPreview {
                    offenders.append("\(relative):\(index + 1)")
                }
            }
        }

        XCTAssertEqual(
            offenders, [String](),
            "\n\nView(s) pinning the colour scheme:\n  \(offenders.joined(separator: "\n  "))\n\n"
                + "BrandColor resolves per trait collection, so pinning the scheme "
                + "freezes every token under this view into one theme whatever the "
                + "person chose. Only LoonextApp (applying their setting) and #Preview "
                + "blocks (pinning both, on purpose) may do this."
        )
    }

    func testTheLintIsActuallyReadingTheTree() throws {
        // A walk that matches nothing passes forever.
        let count = swiftFiles(try sourceRoot()).count
        XCTAssertGreaterThan(count, 30, "expected a real iOS source tree, saw \(count) files")
    }
}
