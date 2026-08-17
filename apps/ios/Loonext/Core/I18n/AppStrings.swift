import SwiftUI

/// #228 Phase 1 — the words this app says, in both languages.
///
/// ## Why a Swift catalogue rather than a String Catalog / `Localizable.strings`
///
/// The platform answer is the obvious one and it is the wrong one HERE, for a
/// reason about this product rather than about iOS.
///
/// **The app's language is a PERSON's setting, not the device's.** #228 fixes
/// the order as user > device > company > English, so a Montreal owner can run
/// the business in French and employ a tech whose phone is in English, and
/// neither has to argue with the other's setting. `NSLocalizedString` resolves
/// against the DEVICE's language list. Overriding it means either writing
/// `AppleLanguages` into `UserDefaults`, which needs a relaunch to take effect,
/// or hand-loading a per-language `Bundle` and threading it through every call
/// site — which is this file, with more moving parts and a bundle to ship.
///
/// A dictionary keyed by locale switches on the next render, and it is the same
/// shape Android and web already use. That last part is not tidiness: three
/// clients that disagree about how a string is REACHED are three clients whose
/// translations drift, which is the subject of #338 and #376.
///
/// ## The completeness guarantee
///
/// Swift cannot do what web does — type the French as the English's exact
/// shape — so `AppStringsTests` asserts the two key sets are equal, per
/// section, in BOTH directions. A key in English and not in French shows a
/// French reader an English sentence; a key in French and not in English is a
/// translation of something that no longer exists, which is how a catalogue
/// rots into something nobody trusts.
///
/// ## Deliberately plain Swift
///
/// A `struct` holding two dictionaries, and an array of them. No protocol with
/// static requirements, no existential metatypes, no key paths across them —
/// all of which are expressible and none of which can be compiled on the
/// machine this was written on. `Gate / iOS` in CI is the only Swift compiler
/// this repo has, so the shape here is the boring one on purpose.
enum AppStrings {
    /// One surface's words.
    struct Section {
        /// For the test that reports WHICH section disagrees with itself.
        let name: String
        let en: [String: String]
        let frCA: [String: String]
    }

    /// Every registered section.
    ///
    /// Sections exist so the extraction can run in parallel without every
    /// change colliding in one file, and so a translator working through a
    /// screen sees its strings adjacent. A section missing from this list is
    /// unreachable, which the tests check.
    static let sections: [Section] = [
        ApiKeysStrings.section,
        CalendarFeedStrings.section,
        CommonStrings.section,
        ContactsTasksStrings.section,
        DomainStrings.section,
        InboxStrings.section,
        PaymentsStrings.section,
        SettingsStrings.section,
        SettingsMoreStrings.section,
        ShellStrings.section,
        ThreadStrings.section,
        WebhooksStrings.section,
    ]

    static let en: [String: String] = merged { $0.en }
    static let frCA: [String: String] = merged { $0.frCA }

    private static func merged(_ pick: (Section) -> [String: String]) -> [String: String] {
        var out: [String: String] = [:]
        for section in sections {
            for (key, value) in pick(section) { out[key] = value }
        }
        return out
    }

    /// The words for one locale.
    ///
    /// Anything unrecognised falls back to English rather than trapping. This
    /// is read on every screen, and a locale some later release adds must
    /// degrade to a readable app rather than a crash.
    static func table(_ locale: String?) -> [String: String] {
        locale == MessageLocale.frCA ? frCA : en
    }

    /// Look one up, and substitute `{name}`.
    ///
    /// A MISSING key falls back to English and then to the key itself. The key
    /// rather than an empty string, deliberately: a reader meeting an English
    /// sentence has lost a translation, and a reader meeting a blank has lost
    /// the product.
    static func translate(
        _ locale: String?,
        _ key: String,
        _ vars: [String: String] = [:]
    ) -> String {
        let raw = table(locale)[key] ?? en[key] ?? key
        if vars.isEmpty { return raw }
        var out = raw
        for (name, value) in vars {
            out = out.replacingOccurrences(of: "{" + name + "}", with: value)
        }
        return out
    }
}

/// The reader's language, put into the environment once at the app root.
///
/// Defaults to English OUTSIDE any provider rather than trapping, for the same
/// reason the other two clients do: a missing provider should give somebody an
/// English screen — which is what everybody had before this existed — rather
/// than a blank one or a crash.
private struct AppLocaleEnvironmentKey: EnvironmentKey {
    static let defaultValue: String = MessageLocale.en
}

extension EnvironmentValues {
    var appLocale: String {
        get { self[AppLocaleEnvironmentKey.self] }
        set { self[AppLocaleEnvironmentKey.self] = newValue }
    }
}
