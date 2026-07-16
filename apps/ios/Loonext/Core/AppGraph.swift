import Foundation
import Observation

/// Small app-level preferences (UserDefaults): the active workspace (the web
/// keeps this in a cookie) and the theme choice. `@Observable` so the theme
/// picker and the App scene react live.
@MainActor
@Observable
final class AppPrefs {
    enum Theme {
        static let system = "system"
        static let light = "light"
        static let dark = "dark"
    }

    private enum Keys {
        static let activeCompany = "active_company_id"
        static let theme = "theme" // system | light | dark
    }

    @ObservationIgnored private let defaults: UserDefaults

    private(set) var activeCompanyId: String?

    var theme: String {
        didSet { defaults.set(theme, forKey: Keys.theme) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        activeCompanyId = defaults.string(forKey: Keys.activeCompany)
        theme = defaults.string(forKey: Keys.theme) ?? Theme.system
    }

    func setActiveCompany(_ companyId: String?) {
        activeCompanyId = companyId
        if let companyId {
            defaults.set(companyId, forKey: Keys.activeCompany)
        } else {
            defaults.removeObject(forKey: Keys.activeCompany)
        }
    }
}

/// Sign-in/out orchestration over `SupabaseAuth` + `SessionStore`: the auth
/// screens call this, never the raw pieces.
@MainActor
final class AuthManager {
    private let auth: SupabaseAuth
    private let sessionStore: SessionStore
    private let prefs: AppPrefs

    init(auth: SupabaseAuth, sessionStore: SessionStore, prefs: AppPrefs) {
        self.auth = auth
        self.sessionStore = sessionStore
        self.prefs = prefs
    }

    func signIn(email: String, password: String, captchaToken: String? = nil) async throws {
        let session = try await auth.signInWithPassword(
            email: email,
            password: password,
            captchaToken: captchaToken
        ).session
        sessionStore.save(session)
    }

    /// Returns true when a session exists now; false = confirmation email sent.
    func signUp(
        email: String,
        password: String,
        displayName: String,
        captchaToken: String? = nil
    ) async throws -> Bool {
        switch try await auth.signUp(
            email: email,
            password: password,
            displayName: displayName,
            captchaToken: captchaToken
        ) {
        case .signedIn(let authSession):
            sessionStore.save(authSession.session)
            return true
        case .confirmationEmailSent:
            return false
        }
    }

    func sendPasswordReset(email: String, captchaToken: String? = nil) async throws {
        try await auth.sendPasswordReset(email: email, captchaToken: captchaToken)
    }

    func signOut() async {
        if let session = sessionStore.current() {
            await auth.signOut(accessToken: session.accessToken)
        }
        sessionStore.clear()
        prefs.setActiveCompany(nil)
    }
}

/// Hand-rolled object graph — the app is one process with one composition
/// root; a DI framework would be ceremony without payoff at this size.
@MainActor
final class AppGraph {
    let sessionStore: SessionStore
    let prefs: AppPrefs
    let supabaseAuth: SupabaseAuth
    let api: ApiClient
    let authManager: AuthManager
    let realtime: RealtimeClient

    let meApi: MeApi
    let forYouApi: ForYouApi
    let inboxApi: InboxApi
    let tasksApi: TasksApi
    let contactsApi: ContactsApi
    let notificationsApi: NotificationsApi
    let searchApi: SearchApi

    init() {
        let sessionStore = SessionStore()
        let prefs = AppPrefs()
        let supabaseAuth = SupabaseAuth()
        let api = ApiClient(sessionStore: sessionStore, auth: supabaseAuth)
        let realtime = RealtimeClient()

        self.sessionStore = sessionStore
        self.prefs = prefs
        self.supabaseAuth = supabaseAuth
        self.api = api
        self.realtime = realtime
        self.authManager = AuthManager(auth: supabaseAuth, sessionStore: sessionStore, prefs: prefs)

        self.meApi = MeApi(api: api)
        self.forYouApi = ForYouApi(api: api)
        self.inboxApi = InboxApi(api: api)
        self.tasksApi = TasksApi(api: api)
        self.contactsApi = ContactsApi(api: api)
        self.notificationsApi = NotificationsApi(api: api)
        self.searchApi = SearchApi(api: api)

        // Realtime channels authorize with the Supabase JWT — keep it fresh.
        Task {
            await api.setTokenRefreshedHandler { token in
                Task { await realtime.setAuth(token) }
            }
        }
    }
}
