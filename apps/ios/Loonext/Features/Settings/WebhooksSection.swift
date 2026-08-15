import SwiftUI

/// #243 — Connections. Parity with the web's /settings/webhooks and Android's
/// `WebhooksSection.kt`.
///
/// # Who this is written for
///
/// Two people open this screen: the owner who was told "connect it to the
/// scheduling app", and the developer they hired. Everything here is written
/// for the first, because the second can read anything and the first is the one
/// who gives up.
///
/// # The decisions, and what they cost if reversed
///
/// - **The add form opens with every event already ticked.** An empty form is a
///   decision the person is not equipped to make yet — they do not know which
///   of eight events their tool needs, and eight empty boxes at the exact
///   moment somebody is trying to get started is where they stop. Subscribing
///   to nothing is a mistake rather than a preference, and the API refuses it.
///   *Applying: Smart Defaults.*
/// - **The signing key is a card that stays on screen, not a toast.** It is
///   shown once in the product's whole life, and on a phone a toast is gone in
///   four seconds — often while the person is still switching to the app they
///   meant to paste it into. *Applying: Zen of Clarity, on the one thing that
///   must not be missable.*
/// - **A stopped endpoint says what was LOST.** "Everything since then has been
///   missed" is the consequence; "disabled" is a state. And "paused by you" is
///   never confused with "we stopped sending" — one is their decision and the
///   other is ours. *Applying: Loss Aversion.*
/// - **Remove and rotate both confirm.** Both break something that is currently
///   working, and on a phone both sit under a thumb. *Applying: Ethical
///   Friction.*
///
/// `WebhooksCatalogueTests`' web-side twin keeps all 78 sentences byte-identical
/// across the three clients.
@MainActor
struct WebhooksSectionView: View {
    let scope: SettingsScope

    @State private var loaded = false
    @State private var failed: String?
    @State private var endpoints: [WebhookEndpoint] = []
    @State private var cap = 0
    @State private var adding = false
    /// The one-time key, whether it came from a create or a rotation.
    @State private var minted: String?

    @Environment(\.appLocale) private var appLocale

    private var atCap: Bool { cap > 0 && endpoints.count >= cap }

    private func words(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(words("webhooks.intro"))
                .font(.footnote)
                .foregroundStyle(.secondary)

            if let minted {
                SigningKeyCard(secret: minted) { self.minted = nil }
            }

            if let failed {
                SettingsCard(title: words("webhooks.loadFailed")) {
                    Text(failed)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button(words("webhooks.testAction")) { Task { await load() } }
                        .font(.footnote)
                }
            } else if !loaded {
                Text(words("webhooks.savingAction"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if endpoints.isEmpty && !adding {
                SettingsCard(title: words("webhooks.empty")) {
                    Text(words("webhooks.emptyBody"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button(words("webhooks.addAction")) { adding = true }
                        .font(.footnote)
                }
            } else {
                ForEach(endpoints) { endpoint in
                    WebhookEndpointCard(
                        scope: scope,
                        endpoint: endpoint,
                        onChanged: { Task { await load() } },
                        onRotated: { minted = $0 }
                    )
                }

                if adding {
                    AddWebhookCard(
                        scope: scope,
                        onCancel: { adding = false },
                        onCreated: { secret in
                            adding = false
                            minted = secret
                            Task { await load() }
                        }
                    )
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Button(words("webhooks.addAction")) { adding = true }
                            .font(.footnote)
                            .disabled(atCap)
                        if atCap {
                            Text(
                                AppStrings.translate(
                                    appLocale,
                                    "webhooks.capReached",
                                    ["count": "\(cap)"]
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Text(words("webhooks.developerNote"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let list = try await scope.repo.webhookEndpoints(scope.companyId)
            endpoints = list.endpoints
            cap = list.cap
            failed = nil
        } catch {
            failed = webhookErrorText(error, appLocale)
        }
        loaded = true
    }
}

/// Which of the five things is true about an endpoint right now.
enum WebhookHealth {
    case healthy, never, failing, paused, stopped

    /// Derived in ONE place rather than at each render site, because "paused by
    /// you" and "we stopped sending" are the two a customer must never see
    /// confused — one is their decision and the other is ours, and a screen
    /// that blames somebody for our decision is worse than one that says
    /// nothing.
    static func of(_ endpoint: WebhookEndpoint) -> WebhookHealth {
        if !endpoint.active {
            return endpoint.disabled_reason != nil ? .stopped : .paused
        }
        if endpoint.consecutive_failures > 0 { return .failing }
        return endpoint.last_success_at != nil ? .healthy : .never
    }

    var key: String {
        switch self {
        case .healthy: "webhooks.statusHealthy"
        case .never: "webhooks.statusNeverUsed"
        case .failing: "webhooks.statusFailing"
        case .paused: "webhooks.statusPaused"
        case .stopped: "webhooks.statusStopped"
        }
    }

    var tint: Color {
        switch self {
        case .healthy: BrandColor.olive
        case .failing: BrandColor.overdueAmber
        case .stopped: BrandColor.destructive
        // Not `.secondary`: that is a hierarchical shape style, not a Color,
        // and it cannot share a switch that returns one.
        case .never, .paused: BrandColor.muted500
        }
    }
}

/// The eight subscribable events, in the order the API promises them.
let webhookEventTypes = [
    "message.received",
    "message.sent",
    "message.failed",
    "call.completed",
    "voicemail.received",
    "task.created",
    "task.completed",
    "contact.created",
]

/// The catalogue key for an event's human sentence. Mirrors the shared rule.
func webhookEventLabelKey(_ type: String) -> String {
    var camel = ""
    var upperNext = false
    for character in type {
        if character == "." {
            upperNext = true
        } else if upperNext {
            camel.append(Character(character.uppercased()))
            upperNext = false
        } else {
            camel.append(character)
        }
    }
    return "webhooks.event.\(camel)"
}

/// An API refusal, said in the reader's language when we recognise it.
///
/// The route puts a catalogue key in the message for every address rule. A key
/// we do not have falls through to the ordinary error text rather than being
/// rendered raw — a screen showing `webhooks.urlError.notHttps` to a customer
/// is worse than one showing a generic failure.
func webhookErrorText(_ error: Error, _ locale: String?) -> String {
    let message = error.userMessage
    guard message.hasPrefix("webhooks.") else { return message }
    // `translate` answers with the KEY when it does not know it, which is
    // exactly the signal needed here: a key we never shipped falls back to the
    // ordinary error text rather than putting `webhooks.urlError.notHttps` on
    // a customer's screen.
    let translated = AppStrings.translate(locale, message)
    return translated == message ? message : translated
}

/// The one-time signing key. Deliberately a card, not a toast.
@MainActor
private struct SigningKeyCard: View {
    let secret: String
    let onDone: () -> Void

    @State private var copied = false
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        SettingsCard(title: AppStrings.translate(appLocale, "webhooks.secretTitle")) {
            Text(AppStrings.translate(appLocale, "webhooks.secretBody"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(secret)
                .font(.caption.monospaced())
                .textSelection(.enabled)
            HStack(spacing: 12) {
                Button(
                    AppStrings.translate(
                        appLocale,
                        copied ? "webhooks.secretCopied" : "webhooks.secretCopy"
                    )
                ) {
                    UIPasteboard.general.string = secret
                    copied = true
                }
                .font(.footnote)
                Button(AppStrings.translate(appLocale, "webhooks.secretDone"), action: onDone)
                    .font(.footnote)
            }
        }
    }
}

@MainActor
private struct AddWebhookCard: View {
    let scope: SettingsScope
    let onCancel: () -> Void
    let onCreated: (String) -> Void

    @State private var url = ""
    @State private var label = ""
    /// Smart Defaults: everything ticked. See the file header.
    @State private var events = Set(webhookEventTypes)
    @State private var saving = false

    @Environment(\.appLocale) private var appLocale

    private func words(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        SettingsCard(title: words("webhooks.addTitle")) {
            VStack(alignment: .leading, spacing: 4) {
                Text(words("webhooks.urlLabel")).font(.caption.weight(.medium))
                TextField("https://", text: $url)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Text(words("webhooks.urlHint"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(words("webhooks.nameLabel")).font(.caption.weight(.medium))
                TextField(words("webhooks.namePlaceholder"), text: $label)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(words("webhooks.eventsLabel")).font(.caption.weight(.medium))
                Text(words("webhooks.eventsHint"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                ForEach(webhookEventTypes, id: \.self) { type in
                    Toggle(
                        words(webhookEventLabelKey(type)),
                        isOn: Binding(
                            get: { events.contains(type) },
                            set: { on in
                                if on { events.insert(type) } else { events.remove(type) }
                            }
                        )
                    )
                    .font(.footnote)
                }
            }

            HStack(spacing: 12) {
                Button(
                    words(saving ? "webhooks.savingAction" : "webhooks.saveAction")
                ) { Task { await save() } }
                    .font(.footnote)
                    .disabled(saving || url.trimmingCharacters(in: .whitespaces).isEmpty)
                Button(words("webhooks.cancelAction"), action: onCancel)
                    .font(.footnote)
            }
        }
    }

    private func save() async {
        guard !events.isEmpty else {
            scope.showMessage(words("webhooks.needOneEvent"))
            return
        }
        saving = true
        defer { saving = false }
        let trimmedLabel = label.trimmingCharacters(in: .whitespaces)
        do {
            let minted = try await scope.repo.createWebhookEndpoint(
                scope.companyId,
                body: CreateWebhookEndpointBody(
                    url: url.trimmingCharacters(in: .whitespaces),
                    // Ordered by the promise, not by tap order, so two
                    // workspaces that picked the same events store the same
                    // list.
                    events: webhookEventTypes.filter { events.contains($0) },
                    description: trimmedLabel.isEmpty ? nil : trimmedLabel
                )
            )
            onCreated(minted.secret_once)
        } catch {
            scope.showMessage(webhookErrorText(error, appLocale))
        }
    }
}

@MainActor
private struct WebhookEndpointCard: View {
    let scope: SettingsScope
    let endpoint: WebhookEndpoint
    let onChanged: () -> Void
    let onRotated: (String) -> Void

    @State private var confirmDelete = false
    @State private var confirmRotate = false
    @State private var showDeliveries = false
    @State private var deliveries: [WebhookDelivery] = []
    @State private var testing = false

    @Environment(\.appLocale) private var appLocale

    private func words(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var health: WebhookHealth { WebhookHealth.of(endpoint) }

    var body: some View {
        SettingsCard(title: endpoint.description ?? endpoint.url) {
            if endpoint.description != nil {
                Text(endpoint.url)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                Circle().fill(health.tint).frame(width: 8, height: 8)
                Text(words(health.key)).font(.caption)
                Text(
                    AppStrings.translate(
                        appLocale,
                        "webhooks.eventsCount",
                        ["count": "\(endpoint.events.count)"]
                    )
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            // What it COST, not what state it is in.
            switch health {
            case .stopped:
                Text(words("webhooks.stoppedBody"))
                    .font(.footnote)
                    .foregroundStyle(BrandColor.destructive)
            case .failing:
                Text(
                    AppStrings.translate(
                        appLocale,
                        "webhooks.failingBody",
                        ["count": "\(endpoint.consecutive_failures)"]
                    )
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            default:
                EmptyView()
            }

            HStack(spacing: 12) {
                Button(
                    words(testing ? "webhooks.testSending" : "webhooks.testAction")
                ) { Task { await runTest() } }
                    .font(.footnote)
                    .disabled(testing)
                Button(
                    words(endpoint.active ? "webhooks.pauseAction" : "webhooks.resumeAction")
                ) { Task { await setActive(!endpoint.active) } }
                    .font(.footnote)
            }

            HStack(spacing: 12) {
                Button(words("webhooks.deliveriesAction")) {
                    showDeliveries.toggle()
                    if showDeliveries { Task { await loadDeliveries() } }
                }
                .font(.footnote)
                Button(words("webhooks.rotateAction")) { confirmRotate = true }
                    .font(.footnote)
                Button(words("webhooks.deleteAction"), role: .destructive) {
                    confirmDelete = true
                }
                .font(.footnote)
            }

            if showDeliveries {
                if deliveries.isEmpty {
                    Text(words("webhooks.deliveriesEmpty"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(deliveries) { delivery in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(delivery.event_type).font(.caption.monospaced())
                            Text(words(deliveryStatusKey(delivery.status)))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        // Ethical Friction: both of these break something that is working.
        .alert(words("webhooks.deleteTitle"), isPresented: $confirmDelete) {
            Button(words("webhooks.keepIt"), role: .cancel) {}
            Button(words("webhooks.deleteConfirm"), role: .destructive) {
                Task { await remove() }
            }
        } message: {
            Text(
                AppStrings.translate(
                    appLocale,
                    "webhooks.deleteBody",
                    ["url": endpoint.url]
                )
            )
        }
        .alert(words("webhooks.rotateTitle"), isPresented: $confirmRotate) {
            Button(words("webhooks.cancelAction"), role: .cancel) {}
            Button(words("webhooks.rotateConfirm")) { Task { await rotate() } }
        } message: {
            Text(words("webhooks.rotateBody"))
        }
    }

    private func runTest() async {
        testing = true
        defer { testing = false }
        do {
            let result = try await scope.repo.testWebhookEndpoint(
                scope.companyId,
                id: endpoint.id
            )
            if result.ok {
                scope.showMessage(words("webhooks.testOk"))
            } else if result.reason == "timeout" {
                scope.showMessage(words("webhooks.testTimeout"))
            } else if result.reason == "unreachable" || result.status == nil {
                scope.showMessage(words("webhooks.testUnreachable"))
            } else {
                scope.showMessage(
                    AppStrings.translate(
                        appLocale,
                        "webhooks.testRefused",
                        ["status": "\(result.status ?? 0)"]
                    )
                )
            }
        } catch {
            scope.showMessage(webhookErrorText(error, appLocale))
        }
    }

    private func setActive(_ active: Bool) async {
        do {
            _ = try await scope.repo.updateWebhookEndpoint(
                scope.companyId,
                id: endpoint.id,
                body: UpdateWebhookEndpointBody(active: active)
            )
            onChanged()
        } catch {
            scope.showMessage(webhookErrorText(error, appLocale))
        }
    }

    private func remove() async {
        do {
            try await scope.repo.deleteWebhookEndpoint(scope.companyId, id: endpoint.id)
            onChanged()
        } catch {
            scope.showMessage(webhookErrorText(error, appLocale))
        }
    }

    private func rotate() async {
        do {
            let minted = try await scope.repo.rotateWebhookSecret(
                scope.companyId,
                id: endpoint.id
            )
            onRotated(minted.secret_once)
        } catch {
            scope.showMessage(webhookErrorText(error, appLocale))
        }
    }

    private func loadDeliveries() async {
        do {
            deliveries = try await scope.repo
                .webhookDeliveries(scope.companyId, id: endpoint.id)
                .deliveries
        } catch {
            scope.showMessage(webhookErrorText(error, appLocale))
        }
    }

    private func deliveryStatusKey(_ status: String) -> String {
        switch status {
        case "succeeded": "webhooks.deliverySucceeded"
        case "failed": "webhooks.deliveryFailed"
        case "delivering": "webhooks.deliveryDelivering"
        default: "webhooks.deliveryPending"
        }
    }
}
