import Foundation
import Observation

/// #228 Phase 1 — WHICH language this app draws itself in, hand-ported from
/// `resolveUiLocale` / `normalizeDeviceLocale` in packages/shared/src/locale.ts
/// and kept rule-for-rule with Android's `core/i18n/UiLocale.kt`.
///
/// ## Why it is not the same question as `MessageLocale`'s
///
/// `MessageLocale.resolve` on the send path answers "what does this CUSTOMER
/// receive". This answers "what does this CREW MEMBER read", and the two
/// deliberately do not share an order, because the people are different and so
/// is the evidence:
///
///   1. THEIR OWN SETTING. Somebody who has said what they read has said it.
///   2. THE DEVICE. A phone's language is a choice its owner already made, once,
///      for everything on it. It is better evidence about what a person reads
///      than a setting their employer made — which is exactly why it outranks
///      the workspace here and does not exist at all in the send path.
///   3. THE WORKSPACE. The business's own language, as a last guess.
///   4. English.
///
/// A bilingual shop is the case this ordering exists for: the owner runs the
/// business in French and employs a tech whose phone is in English, and neither
/// of them should have to argue with the other's setting to read the app.
///
/// ## Why it is hand-ported rather than shared
///
/// There is no shared Swift, the same way `MessageLocale` in `Core.swift` has
/// none. A hand-port is where this drifts, so it is tested against the same
/// vectors the TypeScript and the Kotlin are (`UiLocaleTests`) rather than
/// trusted — this repo has already recorded a hand-ported rule that compiled,
/// ran, and matched nothing.
enum UiLocale {
    /// The language this reader gets, given everything we know.
    ///
    /// `device` arrives in whatever shape the platform hands over — `fr-CA`,
    /// `fr_CA`, `fr`, `en-US` — so it is normalised rather than matched.
    static func resolve(user: String?, device: String?, company: String?) -> String {
        if isKnown(user), let user { return user }
        if let fromDevice = normalizeDevice(device) { return fromDevice }
        if isKnown(company), let company { return company }
        return MessageLocale.en
    }

    /// A platform's locale tag, read as one of ours — or nil when it is neither.
    ///
    /// Nil rather than English on purpose: "this device says nothing we
    /// recognise" has to fall through to the workspace, and returning English
    /// here would stop that and quietly override a French business's own setting
    /// with a default.
    ///
    /// `fr` alone resolves to fr-CA because fr-CA is the only French this
    /// product has; a French speaker in France reading Quebec French is a far
    /// better outcome than one reading English.
    static func normalizeDevice(_ tag: String?) -> String? {
        guard let tag else { return nil }
        // `lowercased()` on a Swift String is the Unicode default mapping and
        // carries no locale, unlike Foundation's `lowercased(with:)`. That is
        // what the Kotlin twin spells `lowercase(Locale.ROOT)` for: on a Turkish
        // phone a locale-sensitive fold turns `I` into a dotless `ı`, so a
        // device reporting `EN-GB` would stop being recognised as English by the
        // app running on it.
        let primary = tag
            .replacingOccurrences(of: "_", with: "-")
            .prefix { $0 != "-" }
            .lowercased()
        switch primary {
        case "fr": return MessageLocale.frCA
        case "en": return MessageLocale.en
        default: return nil
        }
    }

    /// This device's own language, in the shape `normalizeDevice` expects.
    ///
    /// `preferredLanguages` rather than `Locale.current`: the first entry is the
    /// language the person actually put at the top of their phone's list, while
    /// `Locale.current` has already been resolved against the languages this
    /// BUNDLE ships — and this app ships one, so it would answer "en" for every
    /// phone on earth and the device step would never fire.
    static func deviceTag() -> String? {
        Locale.preferredLanguages.first
    }

    private static func isKnown(_ value: String?) -> Bool {
        value == MessageLocale.en || value == MessageLocale.frCA
    }
}

/// The answer to "what language is this app in right now", in one place.
///
/// ## Why a store rather than reading `Me` where it is needed
///
/// The member's own setting arrives on `/v1/me`, which lands once per bootstrap,
/// and the app lock draws BEFORE any of that — a locked screen is the first
/// thing a French reader sees, and it has no session to ask. A small observable
/// holder lets the root publish one value into the environment and lets the two
/// surfaces outside the router (`AppLockGate`, the switcher cover) read the same
/// answer instead of inventing a second one.
///
/// ## Why the member's own choice is echoed into UserDefaults
///
/// Not as a source of truth — the server owns it, and every bootstrap
/// overwrites this with whatever `/v1/me` says, nil included. It is a CACHE so
/// that a cold start paints in the reader's language on the first frame rather
/// than flashing English for the length of one round trip. A member who changes
/// the setting on their laptop and comes back here gets the corrected value the
/// moment `/v1/me` answers.
@MainActor
@Observable
final class UiLocaleStore {
    static let shared = UiLocaleStore()

    /// The member's own setting, or nil for "ask the device, then the
    /// workspace". Nil is a real value, not an absence.
    private(set) var userLocale: String?

    /// The workspace's language — the last step of the chain.
    private(set) var companyLocale: String?

    @ObservationIgnored private let defaults: UserDefaults
    /// Read once. iOS restarts an app when the phone's language changes, so
    /// re-reading it per frame would ask a question that cannot have a new
    /// answer while this process is alive.
    @ObservationIgnored private let deviceTag: String?

    private static let userLocaleKey = "ui_locale"

    init(defaults: UserDefaults = .standard, deviceTag: String? = UiLocale.deviceTag()) {
        self.defaults = defaults
        self.deviceTag = deviceTag
        userLocale = defaults.string(forKey: Self.userLocaleKey)
    }

    /// The language every screen should be drawn in.
    var resolved: String {
        UiLocale.resolve(user: userLocale, device: deviceTag, company: companyLocale)
    }

    /// What the device alone would say, for the "Same as my phone" line.
    var deviceLocale: String {
        UiLocale.normalizeDevice(deviceTag) ?? MessageLocale.en
    }

    /// Everything `/v1/me` just said. Called on every bootstrap, so a setting
    /// changed on another device corrects here without anybody signing out.
    func apply(user: String?, company: String?) {
        setUserLocale(user)
        companyLocale = company
    }

    /// The member picked a language (or picked "same as my phone", which is
    /// nil). Applied before the write so the screen turns over immediately; the
    /// caller puts it back if the write fails.
    func setUserLocale(_ locale: String?) {
        userLocale = locale
        if let locale {
            defaults.set(locale, forKey: Self.userLocaleKey)
        } else {
            defaults.removeObject(forKey: Self.userLocaleKey)
        }
    }
}
