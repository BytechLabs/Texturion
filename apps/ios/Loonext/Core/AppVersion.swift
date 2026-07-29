import Foundation

/// #339 — comparing app versions. Hand-ported from
/// `packages/shared/src/app-version.ts`; `AppVersionTests.swift` asserts the
/// same table of cases the TypeScript test does.
///
/// TWO RULES, both there to fail safe:
///
///   1. UNPARSEABLE IS NEVER NEWER. A version we cannot read is "unknown", and
///      unknown always means "do not act". A lenient parser would let a build
///      claim compliance it does not have.
///   2. A MISSING POLICY DEMANDS NOTHING. The cost of a missed prompt is one
///      person on last week's build; the cost of a false block is a plumber
///      standing in a customer's basement with no phone.
///
/// This build's version, from the bundle. `nil` would mean a misconfigured
/// build — and a build that cannot state its version is never judged behind,
/// because that mistake is ours and blocking would make it the customer's.
enum AppVersion {
    static var current: String? {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    }
}

/// Up to four dot-separated numeric segments. Mirrors the SQL CHECK exactly.
///
/// Written as an explicit scan rather than a regex: NSRegularExpression here
/// would need escaping that differs from the Kotlin and TS ports, and this
/// function is the one place all three have to agree.
private func versionSegments(_ version: String?) -> [Int]? {
    guard let version, !version.isEmpty else { return nil }
    let parts = version.split(separator: ".", omittingEmptySubsequences: false)
    guard (1...4).contains(parts.count) else { return nil }

    var out: [Int] = []
    for part in parts {
        guard (1...4).contains(part.count),
              part.allSatisfy({ $0.isASCII && $0.isNumber }),
              let value = Int(part)
        else { return nil }
        out.append(value)
    }
    return out
}

/// A version as four comparable integers, or nil when it is not a version.
///
/// Padded to four so "2" and "2.0.0.0" are one build, and compared
/// segment-wise so 1.10.0 outranks 1.9.0 — which a string compare gets
/// backwards.
func versionKey(_ version: String?) -> [Int]? {
    guard let segments = versionSegments(version) else { return nil }
    return (0..<4).map { index in index < segments.count ? segments[index] : 0 }
}

/// Is `version` strictly older than `floor`?
///
/// False whenever either side is unreadable. That is the safety property: a
/// parse failure can never lock somebody out.
func isOlderThan(_ version: String?, _ floor: String?) -> Bool {
    guard let a = versionKey(version), let b = versionKey(floor) else { return false }
    for index in 0..<4 where a[index] != b[index] {
        return a[index] < b[index]
    }
    return false
}

/// The policy as the public GET /app-release returns it.
struct AppReleasePolicy: Codable, Sendable {
    var platform: String = "ios"
    var recommended_version: String?
    var minimum_version: String?
    var message: String?
    var update_url: String?
}

/// What this build should do about itself.
///
/// `none`  — nothing to say, and the overwhelmingly common answer.
/// `soft`  — an update exists and is worth having. Dismissible, never blocking.
/// `block` — below the floor. D71 reserves this for security or genuine
///           incompatibility, because being locked out is worse than most bugs.
enum UpdateRequirement: Sendable {
    case none
    case soft
    case block
}

/// Decide once, the same way web and Android decide.
///
/// Every uncertainty — no policy, no version, an unreadable version on either
/// side — resolves to `.none`, the answer that leaves the person working.
func updateRequirement(_ current: String?, _ policy: AppReleasePolicy?) -> UpdateRequirement {
    guard let policy else { return .none }
    guard versionKey(current) != nil else { return .none }

    if isOlderThan(current, policy.minimum_version) { return .block }
    if isOlderThan(current, policy.recommended_version) { return .soft }
    return .none
}
