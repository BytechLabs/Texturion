import SwiftUI

/// #725: a setting that ends or redirects calls says how many it touched, and
/// links to exactly those calls. Silent at zero, and silent for a role that
/// cannot manage settings (the server refuses them the counts anyway).
///
/// One read serves every card on the screen: the counts sit in
/// `CallEffectsCache`, so five notes cost one request.
@MainActor
struct CallEffectNote: View {
    let scope: SettingsScope
    let reason: String

    @State private var effects: CallEffects?

    @Environment(\.appLocale) private var appLocale

    private var allowed: Bool {
        MemberRole.has(scope.role, Capability.settingsManage)
    }

    private var count: Int {
        allowed ? callEffectCount(effects, reason) : 0
    }

    private var sentence: String {
        AppStrings.translate(
            appLocale,
            count == 1 ? "settingsMore.callEffectOne" : "settingsMore.callEffectOther",
            ["count": String(count), "days": String(effects?.days ?? 30)]
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if count > 0 {
                Text(sentence)
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
                Button {
                    Haptics.tap()
                    AppRouter.shared.callsReason = reason
                    AppRouter.shared.openCalls = true
                } label: {
                    Text(AppStrings.translate(appLocale, "settingsMore.callEffectView"))
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                        .frame(minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: scope.companyId) { await load() }
    }

    private func load() async {
        guard allowed else { return }
        if let cached = CallEffectsCache.entries[scope.companyId] {
            effects = cached
            return
        }
        let service = CallsService(api: scope.graph.api)
        guard let fetched = try? await service.effects(companyId: scope.companyId) else { return }
        CallEffectsCache.entries[scope.companyId] = fetched
        effects = fetched
    }
}

/// The last counts read per workspace, so the notes on one screen share a read.
/// Cleared when the app restarts, which is as fresh as a 30-day count needs.
@MainActor
enum CallEffectsCache {
    static var entries: [String: CallEffects] = [:]
}
