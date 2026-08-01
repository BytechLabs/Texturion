import Foundation

/// #459 — searching the phone's own address book, shown beside the crew's.
///
/// WHY THE TWO LISTS STAY SEPARATE. The Contacts tab is the crew's SHARED book:
/// the people this workspace texts, with history, tasks and opt-out state
/// attached. A phone's personal address book is a different thing — a dentist, a
/// brother-in-law, four hundred numbers nobody else on the crew has ever seen.
/// Merging them would bury the shared book under somebody's personal one, and
/// the shared book is what the product is for.
///
/// WHY THE FILTER IS LOCAL. These rows never leave the phone. Reading the
/// address book is a permission granted for matching names, not a licence to
/// upload it, so there is no server to ask.
///
/// Hand-port of `packages/shared/src/device-contacts.ts`, with the same cases
/// asserted in `DeviceContactSearchTests`. Word starts are found by hand rather
/// than with a regex boundary, which does not compile in a Swift regex literal
/// and is a backspace character in the Kotlin twin.

/// How many device rows a list shows before it says there are more.
let maxDeviceContactRows = 50

/// Fewest characters before a device search runs. Below this, show the head.
let minDeviceQuery = 1

/// How many device rows show before "Show all from this phone".
let devicePreviewRows = 5

/// One row as the LIST holds it: a name, and the number to reach it on.
struct DeviceContactListRow: Identifiable, Equatable {
    /// Stable per device book — the CNContact identifier.
    let id: String
    let name: String
    /// E.164 when the number is NANP, otherwise whatever the device stored.
    let number: String
}

/// The rows to show for a query, and whether the cap hid any.
struct DeviceContactPage: Equatable {
    let rows: [DeviceContactListRow]
    let truncated: Bool
}

/// True when a device row answers what somebody typed.
///
/// Names match at WORD STARTS, the same rule the dialer uses: "sm" finds "Dana
/// Smith" and not "Kasm Roofing". Numbers match as a substring of the digits,
/// because somebody searching by number is usually typing the tail of one they
/// half-remember.
func deviceContactMatches(_ row: DeviceContactListRow, query: String) -> Bool {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if trimmed.count < minDeviceQuery { return true }

    let digits = String(trimmed.filter(\.isNumber))
    // A query that is ONLY digits is a number search. Checking the name too
    // would match "A1 Plumbing" for "1", which is noise dressed as a result.
    if !digits.isEmpty && digits == trimmed {
        return nationalDigits(row.number).contains(digits)
    }

    let name = Array(row.name.lowercased())
    let needle = Array(trimmed)
    guard !needle.isEmpty, name.count >= needle.count else { return false }

    func matches(at start: Int) -> Bool {
        for offset in 0..<needle.count where name[start + offset] != needle[offset] {
            return false
        }
        return true
    }

    if matches(at: 0) { return true }
    // Any later word: a surname finds a person at least as often as a first
    // name does, and "Roofing" has to find "Alaska Roofing".
    //
    // The guard is load-bearing, not defensive: when the name is EXACTLY as
    // long as the query, `1...0` is not an empty range in Swift, it is a
    // runtime trap. Searching "dana" for a contact named "Dana" would crash
    // the Contacts tab.
    if name.count > needle.count {
        for index in 1...(name.count - needle.count) {
            let previous = name[index - 1]
            let isWordStart = !previous.isLetter && !previous.isNumber
            if isWordStart && matches(at: index) { return true }
        }
    }
    return false
}

/// The device rows to show for a query, capped.
///
/// Reports whether anything was hidden rather than silently cutting the list. A
/// list that stops at fifty without saying so reads as "these are all of them",
/// and somebody who cannot find their plumber concludes we never read their
/// contacts at all.
func filterDeviceContacts(
    _ rows: [DeviceContactListRow],
    query: String,
    limit: Int = maxDeviceContactRows
) -> DeviceContactPage {
    let matched = rows.filter { deviceContactMatches($0, query: query) }
    return DeviceContactPage(
        rows: Array(matched.prefix(limit)),
        truncated: matched.count > limit
    )
}
