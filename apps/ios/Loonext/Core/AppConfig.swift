import Foundation

/// Public client-side values — the same values the web bundle ships.
enum AppConfig {
    #if LOONEXT_QA
    static let apiURL = qaURL("LoonextQAApiURL")
    static let appOrigin = qaURL("LoonextQAWebURL")
    static let supabaseURL = qaURL("LoonextQASupabaseURL")
    static let supabasePublishableKey = qaSetting("LoonextQASupabasePublishableKey")

    private static func qaURL(_ key: String) -> URL {
        let value = qaSetting(key)
        guard let url = URL(string: value), let host = url.host?.lowercased(),
              let scheme = url.scheme, url.user == nil, url.password == nil,
              url.path.isEmpty, url.query == nil, url.fragment == nil,
              scheme == "https" || (scheme == "http" && host == "127.0.0.1"),
              host != "loonext.com", !host.hasSuffix(".loonext.com"),
              host != "qoruyuxcgkdqpcgclgzs.supabase.co"
        else { preconditionFailure("Invalid QA endpoint for \(key)") }
        return url
    }

    private static func qaSetting(_ key: String) -> String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.isEmpty, !value.hasPrefix("$(")
        else { preconditionFailure("Missing QA build setting for \(key)") }
        return value
    }
    #else
    static let apiURL = URL(string: "https://api.loonext.com")!
    /// The web app, for the screens the phones open in the browser.
    static let appOrigin = URL(string: "https://app.loonext.com")!
    static let supabaseURL = URL(string: "https://qoruyuxcgkdqpcgclgzs.supabase.co")!
    static let supabasePublishableKey = "sb_publishable_iHmvcjwNRbHKk70eqIZS6w_c2ZLdbrL"
    #endif
}
