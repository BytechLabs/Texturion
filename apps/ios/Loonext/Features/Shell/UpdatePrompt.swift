import SwiftUI

/// #339 — the two things we can say about an old build, and they are not the
/// same kind of thing.
///
/// SOFT: a calm card at the bottom, dismissible for the session. An update
/// exists and is worth having; ignoring it costs nothing, so it does not get a
/// sheet and does not steal focus.
///
/// BLOCK: a full screen nobody can get past. D71 reserves it for security or
/// genuine incompatibility — for a plumber standing in a customer's basement,
/// being locked out is worse than almost any bug it would prevent. It always
/// names WHY and always offers the way out.
///
/// Ported 1:1 in behaviour from web's `update-prompt.tsx` and Android's
/// `UpdatePrompt.kt`, because a person with two devices must not be told two
/// different things about the same release.
struct UpdatePrompt: View {
    let state: UpdateState

    /// Dismissal is per RECOMMENDED VERSION: a tap made last week must not
    /// swallow the next release's notice.
    @State private var dismissedVersion: String?

    var body: some View {
        switch state.requirement {
        case .block:
            UpdateBlock(policy: state.policy)
        case .soft:
            if dismissedVersion != state.policy?.recommended_version {
                UpdateCard(
                    policy: state.policy,
                    onDismiss: { dismissedVersion = state.policy?.recommended_version }
                )
            }
        case .none:
            EmptyView()
        }
    }
}

private struct UpdateCard: View {
    let policy: AppReleasePolicy?
    let onDismiss: () -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack {
            Spacer()
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "arrow.down.circle")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text("A newer version of Loonext is ready")
                        .font(.subheadline.weight(.semibold))
                    // The server's reason when it gave one. Never invented
                    // here: a demand we cannot explain is one nobody should
                    // trust.
                    Text(policy?.message ?? "Update to pick up the latest fixes.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Update") { openUpdate() }
                        .buttonStyle(.borderedProminent)
                        .padding(.top, 8)
                }
                Spacer(minLength: 0)
                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Dismiss update notice")
            }
            .padding(16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            .padding(16)
        }
    }

    private func openUpdate() {
        if let raw = policy?.update_url, let url = URL(string: raw) {
            openURL(url)
        }
    }
}

/// The floor. No dismiss control, on purpose — a block somebody can tap past
/// is not a block. The version is shown because support's first question is
/// "what are you running", and the person is by construction unable to reach
/// the settings screen that would tell them.
private struct UpdateBlock: View {
    let policy: AppReleasePolicy?

    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            VStack(spacing: 0) {
                Image(systemName: "arrow.down.circle")
                    .font(.scaled(40))
                Text("Loonext needs an update")
                    .font(.title3.weight(.semibold))
                    .padding(.top, 24)
                Text(
                    policy?.message
                        ?? "This version can no longer connect safely. Update to continue."
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 12)

                Button("Update Loonext") {
                    if let raw = policy?.update_url, let url = URL(string: raw) {
                        openURL(url)
                    }
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, 24)

                Text(versionLine)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 16)
            }
            .padding(24)
        }
    }

    private var versionLine: String {
        var line = "You are on \(AppVersion.current ?? "an unknown version")"
        if let minimum = policy?.minimum_version {
            line += " · \(minimum) or newer is required"
        }
        return line
    }
}
