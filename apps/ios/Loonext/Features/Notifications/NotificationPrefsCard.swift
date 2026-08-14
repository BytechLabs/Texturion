import SwiftUI
import UIKit
import UserNotifications

/// Embeddable notification settings card (#163's settings screen hosts it):
/// per-user Email + Push toggles (GET/PUT /v1/notification-prefs, optimistic
/// with rollback) and this device's push permission — not-determined ('Turn
/// on' fires the system prompt), denied (deep link into system settings),
/// authorized, plus the honest 'push unavailable in this build' state when
/// Firebase isn't configured. Granting permission (or landing here already
/// granted with push on) re-upserts the device token — the #143 self-healing
/// mirror.
///
/// `extraRows` lands with the Email/Push switches rather than after the
/// device-permission block, because it is for settings that answer the same
/// question those two do — when does this thing make a noise. #463's crew-wide
/// lead-chase switch is the caller. Nothing renders while prefs are loading or
/// failed: a switch floating under a spinner belongs to no card.
/// #538 (audit): the channel awaiting confirmation, wrapped so it can drive an
/// alert and still be readable inside the confirm action.
private struct SilencedChannel: Identifiable {
    let id: String
}

@MainActor
struct NotificationPrefsCard<ExtraRows: View>: View {
    let graph: AppGraph
    let companyId: String
    @ViewBuilder var extraRows: () -> ExtraRows

    @State private var state: LoadState<NotificationPrefs> = .loading
    @State private var saveError: String?
    @State private var retryKey = 0
    /// #538 (audit): am I the one holding the phone right now?
    ///
    /// A crew nominates somebody on call, and unclaimed leads page that person. If
    /// they switch push off — reasonable on an ordinary evening — the pages still
    /// fire and reach nothing, and nobody else is told.
    ///
    /// Best-effort: a failed on-call read leaves this false, so the switch behaves
    /// exactly as it did before. A settings screen that will not load because a
    /// secondary read failed is a worse bug than the one this warning prevents.
    @State private var onCall = false
    @State private var silencing: SilencedChannel?

    @Environment(\.appLocale) private var appLocale

    private var feedApi: NotificationsFeedApi {
        NotificationsFeedApi(api: graph.api)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(AppStrings.translate(appLocale, "inbox.notificationsHeading"))
                .font(.golos(15, weight: .semibold))
                .foregroundStyle(BrandColor.ink)

            switch state {
            case .loading:
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .padding(.vertical, 24)

            case .failed(let message):
                VStack(alignment: .leading, spacing: 4) {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button(AppStrings.translate(appLocale, "common.retry")) {
                        Haptics.tap()
                        state = .loading
                        retryKey += 1
                    }
                    .font(.subheadline)
                }
                .padding(.top, 8)

            case .ready(let prefs):
                PrefToggleRow(
                    title: AppStrings.translate(appLocale, "inbox.notifEmailTitle"),
                    supporting: AppStrings.translate(
                        appLocale, "inbox.notifEmailSupporting"
                    ),
                    isOn: prefs.email_enabled
                ) { checked in
                    // #538 (audit): warn, do not refuse. Somebody who wants a quiet
                    // phone is entitled to one, and refusing produces people who
                    // turn the phone off entirely — worse, because then we cannot
                    // tell.
                    if onCall, !checked {
                        silencing = SilencedChannel(id: "email")
                        return
                    }
                    // #244: `prefs` copied and MUTATED rather than rebuilt from
                    // two fields. Constructing a fresh NotificationPrefs here
                    // would silently clear this member's quiet-hours window
                    // every time they touched the email switch — the new fields
                    // default to nil, so the compiler would never mention it.
                    var next = prefs
                    next.email_enabled = checked
                    save(next, previous: prefs)
                }
                PrefToggleRow(
                    title: AppStrings.translate(appLocale, "inbox.notifPushTitle"),
                    supporting: AppStrings.translate(
                        appLocale, "inbox.notifPushSupporting"
                    ),
                    isOn: prefs.push_enabled
                ) { checked in
                    if onCall, !checked {
                        silencing = SilencedChannel(id: "push")
                        return
                    }
                    var next = prefs
                    next.push_enabled = checked
                    save(next, previous: prefs)
                }
                // #244: with the other per-member switches, because it IS one.
                // The difference from turning Push off is that this one ends by
                // itself at 7am, and a page still comes through — which is the
                // sentence that decides whether anybody switches it on.
                PrefToggleRow(
                    title: AppStrings.translate(appLocale, OnCall.quietHeadingKey),
                    supporting: AppStrings.translate(
                        appLocale, OnCall.quietReassuranceKey
                    ),
                    isOn: prefs.quiet_from != nil && prefs.quiet_to != nil
                ) { checked in
                    var next = prefs
                    if checked {
                        next.quiet_from = OnCall.quietDefaultFrom
                        next.quiet_to = OnCall.quietDefaultTo
                        // This device's zone, captured now. Guessing the
                        // workspace's would silence the wrong hours for
                        // anybody who does not live there.
                        next.quiet_timezone = TimeZone.current.identifier
                    } else {
                        next.quiet_from = nil
                        next.quiet_to = nil
                        next.quiet_timezone = nil
                    }
                    save(next, previous: prefs)
                }
                Text(quietSummary(prefs))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                if let saveError {
                    Text(saveError)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }

                // #297: above the quiet-hours row and below the on/off
                // switches, because it is the middle question — how loud each
                // kind is, before when the phone is silent regardless.
                DeliveryModesCard(prefs: prefs) { next in
                    save(next, previous: prefs)
                }

                extraRows()

                Divider()
                    .padding(.top, 12)
                DevicePushSection(
                    graph: graph,
                    companyId: companyId,
                    pushEnabled: prefs.push_enabled
                )
            }
        }
        .task(id: "\(companyId)#\(retryKey)") { await load() }
        .task(id: companyId) { await loadOnCall() }
        // #538 (audit): the one high-stakes switch on this screen that said
        // nothing. Every other irreversible-ish action in settings already named
        // its consequence; going quiet while on call did not, and it is the one
        // where silence IS the failure.
        .alert(
            AppStrings.translate(appLocale, "inbox.notifOnCallTitle"),
            isPresented: silencingBinding
        ) {
            Button(
                AppStrings.translate(appLocale, OnCallSilence.cancelKey),
                role: .cancel
            ) { silencing = nil }
            Button(
                AppStrings.translate(appLocale, OnCallSilence.confirmKey),
                role: .destructive
            ) {
                // #556: reject(). Silencing your own on-call channel is the one
                // press here somebody can regret, and Android gives the same
                // weight to the same class of decision.
                Haptics.reject()
                let channel = silencing?.id
                silencing = nil
                guard case .ready(let prefs) = state, let channel else { return }
                var next = prefs
                if channel == "push" { next.push_enabled = false } else { next.email_enabled = false }
                save(next, previous: prefs)
            }
        } message: {
            Text(
                OnCallSilence.warning(
                    onCall: true,
                    turningOff: true,
                    channel: silencing?.id ?? "push",
                    locale: appLocale
                ) ?? ""
            )
        }
    }

    /// `.alert(isPresented:)` wants a Bool, and the channel has to survive the
    /// dismissal long enough for the confirm action to read it — so the optional is
    /// the source of truth and this is the view of it the modifier needs.
    private var silencingBinding: Binding<Bool> {
        Binding(
            get: { silencing != nil },
            set: { if !$0 { silencing = nil } }
        )
    }

    /// Best-effort: a failure leaves `onCall` false and the switches unchanged.
    ///
    /// The signed-in id comes from `/v1/me` because the session store is private to
    /// the auth orchestrator and this card is handed only the graph. One extra read
    /// on a settings screen, once, rather than widening that boundary for a warning.
    private func loadOnCall() async {
        do {
            // The endpoint directly rather than through SettingsRepository, which
            // also wants a session store — pulling that into a notifications card
            // to read one list would be the wrong dependency for one GET.
            let response: OnCallShiftsResponse = try await graph.api.get(
                "/v1/on-call",
                companyId: companyId
            )
            let shifts = response.data
            let mine = try await graph.meApi.me().user_id
            onCall = OnCallSilence.isOnCallNow(
                shifts.map {
                    OnCallSilence.Shift(
                        userId: $0.user_id,
                        startsAt: $0.starts_at,
                        endsAt: $0.ends_at
                    )
                },
                userId: mine
            )
        } catch {
            onCall = false
        }
    }

    private func load() async {
        if case .ready = state {} else { state = .loading }
        do {
            state = .ready(try await feedApi.prefs(companyId: companyId))
        } catch {
            if Task.isCancelled { return }
            state = .failed(error.userMessage)
        }
    }

    private func quietSummary(_ prefs: NotificationPrefs) -> String {
        guard let from = prefs.quiet_from, let to = prefs.quiet_to else {
            return AppStrings.translate(appLocale, OnCall.quietOffKey)
        }
        return OnCall.quietHoursLine(from: from, to: to, locale: appLocale)
            + " · "
            + AppStrings.translate(appLocale, OnCall.quietScopeKey)
    }

    private func save(_ next: NotificationPrefs, previous: NotificationPrefs) {
        state = .ready(next)
        saveError = nil
        Task {
            do {
                state = .ready(try await feedApi.updatePrefs(companyId: companyId, prefs: next))
            } catch {
                state = .ready(previous)
                // #552/D80: the SERVER'S sentence, not ours. This card hardcoded
                // "That didn't save. Try again." — and the reason it would not save
                // was a 422 naming the exact field, which is the one thing that
                // would have told the founder what was wrong. D80:
                // "a client that overwrites a server's error copy is making a bet
                // that the server will never have anything more specific to say."
                // That bet was already lost here.
                saveError = error.userMessage
            }
        }
    }
}

extension NotificationPrefsCard where ExtraRows == EmptyView {
    /// The plain embeddable form — no caller-supplied rows.
    init(graph: AppGraph, companyId: String) {
        self.init(graph: graph, companyId: companyId) { EmptyView() }
    }
}

private struct PrefToggleRow: View {
    let title: String
    let supporting: String
    let isOn: Bool
    /// Non-Sendable closure formed in the card's MainActor body — it inherits
    /// that isolation, so `Binding(set:)` can take it without a type bridge.
    let onChange: (Bool) -> Void

    var body: some View {
        // #556: a switch moving is a tap. Wired on the ROW rather than at each
        // of the three call sites — they all pass through here, and three
        // copies is three chances for one to be forgotten when a fourth
        // preference arrives.
        Toggle(isOn: Binding(get: { isOn }, set: { next in
            Haptics.tap()
            onChange(next)
        })) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Text(supporting)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
            }
        }
        .tint(BrandColor.olive)
        .padding(.vertical, 10)
    }
}

/// Per-device push permission state (UNUserNotificationCenter model).
private enum DevicePushState: Equatable {
    case checking
    /// No Firebase config in this build — honest copy, feed still works.
    case unavailable
    /// authorized / provisional / ephemeral.
    case on
    /// notDetermined — a real system prompt is still available.
    case off
    /// denied — recovery lives in system settings.
    case blocked
}

@MainActor
private struct DevicePushSection: View {
    let graph: AppGraph
    let companyId: String
    let pushEnabled: Bool

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(\.appLocale) private var appLocale
    @State private var pushState: DevicePushState = .checking
    @State private var requesting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(AppStrings.translate(appLocale, "inbox.notifDeviceHeading"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.top, 12)

            switch pushState {
            case .checking:
                ProgressView()
                    .controlSize(.small)

            case .unavailable:
                Text(AppStrings.translate(appLocale, "inbox.notifPushUnavailable"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

            case .on:
                statusRow(
                    text: AppStrings.translate(appLocale, "inbox.notifDeviceOnBody"),
                    action: AppStrings.translate(appLocale, "inbox.notifSystemSettings"),
                    solid: false,
                    onAction: openSystemSettings
                )

            case .off:
                statusRow(
                    text: AppStrings.translate(appLocale, "inbox.notifDeviceOffBody"),
                    action: AppStrings.translate(
                        appLocale,
                        requesting ? "inbox.notifTurningOn" : "inbox.notifTurnOn"
                    ),
                    solid: true,
                    onAction: turnOn
                )

            case .blocked:
                statusRow(
                    text: AppStrings.translate(appLocale, "inbox.notifDeviceBlockedBody"),
                    action: AppStrings.translate(appLocale, "inbox.notifOpenSettings"),
                    solid: false,
                    onAction: openSystemSettings
                )
            }
        }
        .task(id: companyId) { await refreshState() }
        // Re-read permission state whenever we come back from the system
        // prompt or the Settings app.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await refreshState() }
            }
        }
        // #143 self-heal: any time this device is allowed to push and the user
        // wants push, re-upsert the token (server may have pruned a dead row).
        .task(id: selfHealKey) {
            if pushState == .on && pushEnabled {
                await PushCoordinator.shared.ensureRegistrar(api: graph.api).register()
            }
        }
    }

    private var selfHealKey: String {
        "\(String(describing: pushState))|\(pushEnabled)|\(companyId)"
    }

    private func refreshState() async {
        guard PushAvailability.isFirebaseConfigured else {
            pushState = .unavailable
            return
        }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            pushState = .on
        case .denied:
            pushState = .blocked
        case .notDetermined:
            pushState = .off
        @unknown default:
            // A status added after this build — settings-link recovery is the
            // honest arm (never a dead 'Turn on').
            pushState = .blocked
        }
    }

    private func turnOn() {
        guard !requesting else { return }
        requesting = true
        Task {
            defer { requesting = false }
            let granted = (try? await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if granted {
                await PushCoordinator.shared.ensureRegistrar(api: graph.api).register()
            }
            await refreshState()
        }
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
            openURL(url)
        }
    }

    @ViewBuilder
    private func statusRow(
        text: String,
        action: String,
        solid: Bool,
        onAction: @escaping @MainActor () -> Void
    ) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if solid {
                Button(action, action: onAction)
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(requesting)
            } else {
                Button(action, action: onAction)
                    .font(.subheadline)
            }
        }
        .padding(.vertical, 4)
    }
}
