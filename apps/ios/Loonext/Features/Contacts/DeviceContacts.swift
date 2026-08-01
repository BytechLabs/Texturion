import Contacts
import Foundation

/// #459 — the phone's own address book.
///
/// The Android twin (#183) has read the device book since the dialer needed it;
/// iOS has read none at all, so this is the whole surface: a permission asked at
/// the point of use, a read of exactly two fields, and an in-memory list.
///
/// # What is read, and what is never read
///
/// Given name, family name, organisation and phone numbers. Nothing else — no
/// emails, no addresses, no photos, no birthdays, no notes. And nothing is
/// uploaded: these rows exist to be matched against and shown, and the search
/// over them runs locally (`DeviceContactSearch.swift`) precisely so there is
/// never a request carrying somebody's address book to our server.
///
/// # Why the permission is asked here and not at launch
///
/// A contacts prompt before the person has seen what it buys is one they
/// decline, and on iOS a declined contacts permission cannot be asked for again
/// — the app can only send them to Settings. So the ask happens when the
/// section they are looking at is the reason for it.
enum DeviceContactsAccess {
    /// What the system currently allows, without prompting.
    static var isAuthorized: Bool {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        // `.limited` (iOS 18+) means the person picked SOME contacts for us.
        // That is a yes: we show what we are given and never ask how many.
        if #available(iOS 18.0, *) {
            return status == .authorized || status == .limited
        }
        return status == .authorized
    }

    /// True when asking is still possible. After a denial iOS never prompts
    /// again, so a button that claims it will is a button that lies.
    static var canAsk: Bool {
        CNContactStore.authorizationStatus(for: .contacts) == .notDetermined
    }

    /// Ask, and report what the person chose.
    static func request() async -> Bool {
        let store = CNContactStore()
        return await withCheckedContinuation { continuation in
            store.requestAccess(for: .contacts) { granted, _ in
                continuation.resume(returning: granted)
            }
        }
    }

    /// Every device contact that has at least one phone number, as list rows.
    ///
    /// One row per CONTACT, on its first number — the same rule the Android
    /// twin follows. Showing the same person three times because their phone
    /// stored a mobile, a work and a home number is a directory nobody can
    /// scan.
    ///
    /// Returns an empty list rather than throwing. A contacts read that fails
    /// is a section that stays empty, not a Contacts tab that will not load.
    static func load() async -> [DeviceContactListRow] {
        guard isAuthorized else { return [] }
        return await Task.detached(priority: .userInitiated) { () -> [DeviceContactListRow] in
            let keys: [CNKeyDescriptor] = [
                CNContactGivenNameKey as CNKeyDescriptor,
                CNContactFamilyNameKey as CNKeyDescriptor,
                CNContactOrganizationNameKey as CNKeyDescriptor,
                CNContactPhoneNumbersKey as CNKeyDescriptor
            ]
            let request = CNContactFetchRequest(keysToFetch: keys)
            request.sortOrder = .givenName
            var rows: [DeviceContactListRow] = []
            let store = CNContactStore()
            do {
                try store.enumerateContacts(with: request) { contact, _ in
                    guard let raw = contact.phoneNumbers.first?.value.stringValue else { return }
                    let digits = raw.filter(\.isNumber)
                    // Nothing to call or text.
                    guard !digits.isEmpty else { return }
                    rows.append(
                        DeviceContactListRow(
                            id: contact.identifier,
                            name: displayName(for: contact, fallbackNumber: raw),
                            number: Nanp.normalize(raw) ?? raw
                        )
                    )
                }
            } catch {
                return []
            }
            return rows
        }.value
    }

    /// A person's name, an organisation when they have no personal name, and
    /// the formatted number when they have neither. A row labelled with an
    /// empty string is a row nobody can identify.
    private static func displayName(for contact: CNContact, fallbackNumber: String) -> String {
        let personal = [contact.givenName, contact.familyName]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if !personal.isEmpty { return personal }
        if !contact.organizationName.isEmpty { return contact.organizationName }
        return Nanp.formatAsYouType(fallbackNumber)
    }
}
