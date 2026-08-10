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
        // #289: full-size photos wait for Wi-Fi on this phone.
        static let wifiOnlyOriginals = "wifi_only_originals"
        // #330: the app lock, device-scoped for the same reason as the line
        // above — it is about THIS phone, which is the tech's own and gets
        // handed to whoever is covering the weekend.
        static let appLockEnabled = "app_lock_enabled"
    }

    @ObservationIgnored private let defaults: UserDefaults

    private(set) var activeCompanyId: String?

    var theme: String {
        didSet { defaults.set(theme, forKey: Keys.theme) }
    }

    /**
     #289: wait for Wi-Fi before fetching a FULL-SIZE photo.

     Default off — most people will never open the setting, and putting a tap
     between every tradesperson and every photo would solve a problem most of
     them do not have. Threads and galleries load either way (#240 made them
     cheap). Device-scoped, not workspace-scoped: it is about THIS phone's data
     plan, and the same person on a laptop has a different answer.
     */
    var wifiOnlyOriginals: Bool {
        didSet { defaults.set(wifiOnlyOriginals, forKey: Keys.wifiOnlyOriginals) }
    }

    /**
     #330: ask for Face ID, Touch ID or the passcode before showing the inbox.

     Default OFF, and that is a decision rather than laziness. This product
     promises answering a customer inside the five minutes that decide the job,
     and a lock a sole operator never asked for is friction on the only thing we
     sell. A crew sharing one truck phone and a person working alone have
     opposite correct answers, so the phone asks rather than assuming.
     */
    var appLockEnabled: Bool {
        didSet { defaults.set(appLockEnabled, forKey: Keys.appLockEnabled) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        activeCompanyId = defaults.string(forKey: Keys.activeCompany)
        theme = defaults.string(forKey: Keys.theme) ?? Theme.system
        wifiOnlyOriginals = defaults.bool(forKey: Keys.wifiOnlyOriginals)
        appLockEnabled = defaults.bool(forKey: Keys.appLockEnabled)
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
    /// For the Apple first-auth display_name backfill (#166).
    private let meApi: MeApi

    init(auth: SupabaseAuth, sessionStore: SessionStore, prefs: AppPrefs, meApi: MeApi) {
        self.auth = auth
        self.sessionStore = sessionStore
        self.prefs = prefs
        self.meApi = meApi
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

    /// Native Google via the PKCE browser flow (#166). Returns false when the
    /// user closed the sheet (calm no-op); on success the saved session
    /// routes upstream (Root observes the store).
    func signInWithGoogle() async throws -> Bool {
        let flow = GoogleSignInFlow(auth: auth)
        guard let authSession = try await flow.signIn() else { return false }
        sessionStore.save(authSession.session)
        return true
    }

    /// Native Sign in with Apple (#166): exchange the identity token, then
    /// backfill an EMPTY profile display_name with the one-shot name Apple
    /// only sends on first authorization. The backfill is best-effort — a
    /// name-write failure never blocks the sign-in.
    func signInWithApple(idToken: String, rawNonce: String, fullName: String?) async throws {
        let authSession: AuthSession
        do {
            authSession = try await auth.signInWithIdToken(
                provider: "apple",
                idToken: idToken,
                nonce: rawNonce
            )
        } catch let error as ApiError where SupabaseAuth.isProviderSetupError(error) {
            // FOUNDER STEP (PRODUCTION.md §8): enable the Apple provider in
            // Supabase with bundle id com.loonext.ios as a client id.
            throw ApiError(
                code: "provider_not_configured",
                message: "Apple sign-in isn't set up for this app yet.",
                httpStatus: error.httpStatus
            )
        }
        sessionStore.save(authSession.session)
        if let fullName, !fullName.isBlank,
           let me = try? await meApi.me(), me.display_name.isBlank {
            try? await meApi.updateDisplayName(fullName)
        }
    }

    func signOut() async {
        if let session = sessionStore.current() {
            await auth.signOut(accessToken: session.accessToken)
        }
        // #330: the per-company unread bookkeeping outlives the session otherwise.
        // `NotificationsReadState.clear()` was written for exactly this — its own
        // comment calls it "sign-out parity with the Android cache clear" — and
        // nothing had ever called it.
        //
        // It matters because of who owns the phone. D12's customer is a crew texting
        // from personal handsets, and a spare phone in the truck gets handed to
        // whoever is covering the weekend. Signing out and passing it over left the
        // next person holding the previous member's unread counts for every workspace
        // they had open.
        //
        // The call now lives on `SessionEnded`, registered by the composition root,
        // because a session the SERVER ended never came through here at all.
        prefs.setActiveCompany(nil)
        sessionStore.clear()
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
    /// #339: the public update policy. Its own session-free repository on
    /// purpose — see UpdateRepository for why it must not ride ApiClient.
    let updates: UpdateRepository

    let meApi: MeApi
    let forYouApi: ForYouApi
    let inboxApi: InboxApi
    let savedViewsApi: SavedViewsApi
    let tasksApi: TasksApi
    let contactsApi: ContactsApi
    let notificationsApi: NotificationsApi
    let searchApi: SearchApi

    /// - Parameter sessionStore: #593 — injectable, defaulting to the one this graph
    ///   would have built. Production passes nothing and is unchanged; a test passes a
    ///   store backed by memory, because the simulator host has no keychain (#599) and
    ///   because the handover funnel SAVES a refreshed session through `graph.sessionStore`
    ///   — so a test whose repository used a different store would look signed out and
    ///   never reach the code under test.
    init(sessionStore: SessionStore = SessionStore()) {
        let prefs = AppPrefs()
        let supabaseAuth = SupabaseAuth()
        let api = ApiClient(sessionStore: sessionStore, auth: supabaseAuth)
        let realtime = RealtimeClient()
        let meApi = MeApi(api: api)

        self.sessionStore = sessionStore
        self.prefs = prefs
        self.supabaseAuth = supabaseAuth
        self.api = api
        self.realtime = realtime
        self.updates = UpdateRepository(baseURL: AppConfig.apiURL.absoluteString)
        self.authManager = AuthManager(
            auth: supabaseAuth,
            sessionStore: sessionStore,
            prefs: prefs,
            meApi: meApi
        )

        self.meApi = meApi
        self.forYouApi = ForYouApi(api: api)
        self.inboxApi = InboxApi(api: api)
        self.savedViewsApi = SavedViewsApi(api: api)
        self.tasksApi = TasksApi(api: api)
        self.contactsApi = ContactsApi(api: api)
        self.notificationsApi = NotificationsApi(api: api)
        self.searchApi = SearchApi(api: api)

        // #330: registered on SessionEnded rather than on the Sign out button, so a
        // session the SERVER ended clears the same things. An owner signing a departed
        // tech's phone out (#236) used to drop only the token, leaving the previous
        // member's unread counts on a phone the company cannot ask back — which is the
        // case that matters once somebody has actually left.
        SessionEnded.onEnded {
            NotificationsReadState.shared.clear()
            // And the outbox — what somebody was in the middle of saying to a
            // customer, and the photos they attached. It survived every exit until
            // now: an unsent message to a homeowner sitting on a phone the company
            // does not own, which could also flush under a session that is gone. A
            // fresh instance clears the same storage; the queue lives in
            // UserDefaults and one fixed directory, not in the object.
            Outbox().clear()
        }

        // Realtime channels authorize with the Supabase JWT — keep it fresh.
        Task {
            await api.setTokenRefreshedHandler { token in
                Task { await realtime.setAuth(token) }
            }
        }
    }
}
