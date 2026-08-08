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

/// Every device row that answers what somebody typed. All of them.
///
/// The cap that used to be here is gone (#547). It produced a defect the founder
/// found in a minute of use: the collapsed group showed five rows under a "Show
/// all from this phone" button, pressing it showed FIFTY, and under those fifty
/// sat the sentence "Showing the first 50. Search to find someone else." A
/// control labelled "Show all" that does not show all is worse than no control.
///
/// It was never protecting anything. These rows never leave the phone and are
/// already in memory, and the group renders inside a lazy list, so the four
/// hundredth row costs nothing until somebody scrolls to it.
///
/// The PREVIEW is still capped, by the caller, while the group is collapsed — a
/// personal address book above the crew's shared one would bury the thing the
/// product is for. That is a layout decision and it lives in the layout.
func filterDeviceContacts(
    _ rows: [DeviceContactListRow],
    query: String
) -> [DeviceContactListRow] {
    rows.filter { deviceContactMatches($0, query: query) }
}
