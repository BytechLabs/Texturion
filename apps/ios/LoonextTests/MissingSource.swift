import Foundation
import XCTest

/// A source scan could not read the file it is meant to check.
///
/// # Why this is a failure and not an `XCTSkip`
///
/// Six scans in this target used to `throw XCTSkip` when the source was not
/// where they looked, and a skipped test reports GREEN. That is backwards. The
/// conditions that produce a missing file — a renamed source, a moved
/// directory, a bundle run from somewhere the checkout is not — are exactly the
/// conditions under which the scan has verified nothing at all, and they are
/// the ones it must be loudest about. Every assertion downstream then "passes"
/// by never running.
///
/// These scans are not decoration. They hold the properties no unit test can
/// see: that a price is read rather than typed, that a colour goes through the
/// brand kit, that the card calls the decision function instead of restating
/// its copy. A silent scan is a guard that has been retired without anybody
/// deciding to retire it.
///
/// Android's `readMainSource` calls `fail()` for the same reason, and this is
/// the iOS half of that rule.
enum MissingSource: Error {
    case at(String)
}

/// Report the missing source, then hand back the error to throw.
///
/// Two steps rather than one so the caller stops immediately: a scan that
/// carried on would assert against an empty string, and an empty string
/// contains no offences.
func missingSource(
    _ path: String,
    file: StaticString = #filePath,
    line: UInt = #line
) -> MissingSource {
    XCTFail(
        "iOS source not found at \(path) — a scan that cannot read its subject "
            + "has not passed. Re-point it at the file that replaced this one.",
        file: file,
        line: line
    )
    return .at(path)
}
