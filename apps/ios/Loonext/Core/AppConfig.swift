import Foundation

/// Public client-side values — the same values the web bundle ships.
enum AppConfig {
    static let apiURL = URL(string: "https://api.loonext.com")!
    /// The web app, for the screens the phones open in the browser.
    static let appOrigin = URL(string: "https://app.loonext.com")!
    static let supabaseURL = URL(string: "https://qoruyuxcgkdqpcgclgzs.supabase.co")!
    static let supabasePublishableKey = "sb_publishable_iHmvcjwNRbHKk70eqIZS6w_c2ZLdbrL"
}
