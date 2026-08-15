import SwiftUI

/// #243 — API keys. Parity with the web's /settings/api-keys and Android's
/// `ApiKeysSection.kt`.
///
/// # Why the defaults here invert the ones next door
///
/// Connections opens its form with every event ticked, because subscribing to
/// nothing is a mistake and eight empty boxes is where somebody gives up.
///
/// This form opens with only the READ scopes ticked, and that is the same
/// principle reaching the opposite answer: a Smart Default is only smart when
/// being wrong about it is cheap. Being wrong about which events you receive
/// costs a redundant webhook. Being wrong about what a key can do costs
/// whatever the key can do. It is still a default rather than an empty form —
/// reading is what a first integration does.
///
/// # The rest
///
/// - **"Last used" is the headline, not the creation date.** The question this
///   screen exists to answer is "can I safely switch this off", and that is
///   the only fact that answers it. It is repeated inside the confirmation
///   when the answer is "yes, recently". *Applying: Loss Aversion.*
/// - **Revoked keys stay in the list.** "What did we turn off, and when" is an
///   incident question a hiding list cannot answer.
/// - **The token is a card that stays on screen, not a toast.** It exists once
///   in the product's whole life, and on a phone a toast is gone in four
///   seconds — usually while the person is switching to the app they meant to
///   paste it into.
/// - **Revoking confirms.** It breaks a live integration and cannot be undone.
///   *Applying: Ethical Friction.*
@MainActor
struct ApiKeysSectionView: View {
    let scope: SettingsScope

    @State private var loaded = false
    @State private var failed: String?
    @State private var apiKeys: [ApiKey] = []
    @State private var cap = 0
    @State private var live = 0
    @State private var creating = false
    @State private var minted: String?

    @Environment(\.appLocale) private var appLocale

    private var atCap: Bool { cap > 0 && live >= cap }

    private func words(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(words("apiKeys.intro"))
                .font(.footnote)
                .foregroundStyle(.secondary)

            if let minted {
                ApiTokenCard(token: minted) { self.minted = nil }
            }

            if let failed {
                SettingsCard(title: words("apiKeys.loadFailed")) {
                    Text(failed).font(.footnote).foregroundStyle(.secondary)
                    Button(words("apiKeys.createAction")) { Task { await load() } }
                        .font(.footnote)
                }
            } else if !loaded {
                Text(words("apiKeys.savingAction"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if apiKeys.isEmpty && !creating {
                SettingsCard(title: words("apiKeys.empty")) {
                    Text(words("apiKeys.emptyBody"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button(words("apiKeys.createAction")) { creating = true }
                        .font(.footnote)
                }
            } else {
                ForEach(apiKeys) { key in
                    ApiKeyCard(scope: scope, apiKey: key, onChanged: { Task { await load() } })
                }

                if creating {
                    CreateApiKeyCard(
                        scope: scope,
                        onCancel: { creating = false },
                        onCreated: { token in
                            creating = false
                            minted = token
                            Task { await load() }
                        }
                    )
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Button(words("apiKeys.createAction")) { creating = true }
                            .font(.footnote)
                            .disabled(atCap)
                        if atCap {
                            Text(
                                AppStrings.translate(
                                    appLocale,
                                    "apiKeys.capReached",
                                    ["count": "\(cap)"]
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Text(words("apiKeys.developerNote"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let list = try await scope.repo.apiKeys(scope.companyId)
            apiKeys = list.keys
            cap = list.cap
            live = list.live
            failed = nil
        } catch {
            failed = error.userMessage
        }
        loaded = true
    }
}

/// The seven scopes, in the order the API promises them.
let apiKeyScopeOrder = [
    "conversations:read",
    "messages:read",
    "messages:send",
    "contacts:read",
    "contacts:write",
    "tasks:read",
    "tasks:write",
]

/// The safe half, and what a first integration actually needs.
let apiKeyDefaultScopes = Set(apiKeyScopeOrder.filter { $0.hasSuffix(":read") })

/// The catalogue key for a scope's human sentence. Mirrors the shared rule.
func apiKeyScopeLabelKeyLocal(_ scope: String) -> String {
    var camel = ""
    var upperNext = false
    for character in scope {
        if character == ":" {
            upperNext = true
        } else if upperNext {
            camel.append(Character(character.uppercased()))
            upperNext = false
        } else {
            camel.append(character)
        }
    }
    return "apiKeys.scope.\(camel)"
}

@MainActor
private struct ApiTokenCard: View {
    let token: String
    let onDone: () -> Void

    @State private var copied = false
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        SettingsCard(title: AppStrings.translate(appLocale, "apiKeys.tokenTitle")) {
            Text(AppStrings.translate(appLocale, "apiKeys.tokenBody"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(token)
                .font(.caption.monospaced())
                .textSelection(.enabled)
            HStack(spacing: 12) {
                Button(
                    AppStrings.translate(
                        appLocale,
                        copied ? "apiKeys.tokenCopied" : "apiKeys.tokenCopy"
                    )
                ) {
                    UIPasteboard.general.string = token
                    copied = true
                }
                .font(.footnote)
                Button(AppStrings.translate(appLocale, "apiKeys.tokenDone"), action: onDone)
                    .font(.footnote)
            }
        }
    }
}

@MainActor
private struct CreateApiKeyCard: View {
    let scope: SettingsScope
    let onCancel: () -> Void
    let onCreated: (String) -> Void

    @State private var name = ""
    /// Smart Defaults, inverted. See the file header.
    @State private var scopes = apiKeyDefaultScopes
    @State private var saving = false

    @Environment(\.appLocale) private var appLocale

    private func words(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        SettingsCard(title: words("apiKeys.createTitle")) {
            VStack(alignment: .leading, spacing: 4) {
                Text(words("apiKeys.nameLabel")).font(.caption.weight(.medium))
                TextField(words("apiKeys.namePlaceholder"), text: $name)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(words("apiKeys.scopesLabel")).font(.caption.weight(.medium))
                Text(words("apiKeys.scopesHint"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                ForEach(apiKeyScopeOrder, id: \.self) { scopeName in
                    Toggle(
                        words(apiKeyScopeLabelKeyLocal(scopeName)),
                        isOn: Binding(
                            get: { scopes.contains(scopeName) },
                            set: { on in
                                if on { scopes.insert(scopeName) } else { scopes.remove(scopeName) }
                            }
                        )
                    )
                    .font(.footnote)
                }
            }

            HStack(spacing: 12) {
                Button(words(saving ? "apiKeys.savingAction" : "apiKeys.saveAction")) {
                    Task { await save() }
                }
                .font(.footnote)
                .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                Button(words("apiKeys.cancelAction"), action: onCancel)
                    .font(.footnote)
            }
        }
    }

    private func save() async {
        guard !scopes.isEmpty else {
            scope.showMessage(words("apiKeys.needOneScope"))
            return
        }
        saving = true
        defer { saving = false }
        do {
            let minted = try await scope.repo.createApiKey(
                scope.companyId,
                body: CreateApiKeyBody(
                    name: name.trimmingCharacters(in: .whitespaces),
                    // Ordered by the promise, not by tap order, so two
                    // workspaces that picked the same scopes store the same
                    // list.
                    scopes: apiKeyScopeOrder.filter { scopes.contains($0) }
                )
            )
            onCreated(minted.token_once)
        } catch {
            scope.showMessage(error.userMessage)
        }
    }
}

@MainActor
private struct ApiKeyCard: View {
    let scope: SettingsScope
    let apiKey: ApiKey
    let onChanged: () -> Void

    @State private var confirming = false
    @Environment(\.appLocale) private var appLocale

    private func words(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var revoked: Bool { apiKey.revoked_at != nil }

    var body: some View {
        SettingsCard(title: apiKey.name) {
            Text("\(apiKey.token_prefix)…")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)

            Text(statusLine)
                .font(.caption)
                .foregroundStyle(.secondary)

            Divider()
            ForEach(apiKey.scopes, id: \.self) { scopeName in
                Text(words(apiKeyScopeLabelKeyLocal(scopeName)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !revoked {
                Button(words("apiKeys.revokeAction"), role: .destructive) {
                    confirming = true
                }
                .font(.footnote)
            }
        }
        // Ethical Friction: this breaks a live integration and cannot be undone.
        .alert(words("apiKeys.revokeTitle"), isPresented: $confirming) {
            Button(words("apiKeys.keepIt"), role: .cancel) {}
            Button(words("apiKeys.revokeConfirm"), role: .destructive) {
                Task { await revoke() }
            }
        } message: {
            Text(confirmBody)
        }
    }

    private var statusLine: String {
        if let revokedAt = apiKey.revoked_at {
            return AppStrings.translate(
                appLocale,
                "apiKeys.revokedOn",
                ["when": relativeTime(revokedAt)]
            )
        }
        if let usedAt = apiKey.last_used_at {
            return AppStrings.translate(
                appLocale,
                "apiKeys.lastUsed",
                ["when": relativeTime(usedAt)]
            )
        }
        return words("apiKeys.neverUsed")
    }

    private var confirmBody: String {
        var out = words("apiKeys.revokeBody")
        if let usedAt = apiKey.last_used_at {
            out += " "
            out += AppStrings.translate(
                appLocale,
                "apiKeys.revokeUsedWarning",
                ["when": relativeTime(usedAt)]
            )
        }
        return out
    }

    private func revoke() async {
        do {
            try await scope.repo.revokeApiKey(scope.companyId, id: apiKey.id)
            onChanged()
        } catch {
            scope.showMessage(error.userMessage)
        }
    }
}
