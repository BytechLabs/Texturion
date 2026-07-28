import SwiftUI

/// #382 — the route to a human, from inside the app.
///
/// Settings had eleven sections here and none of them was this. A tradesperson
/// whose texts stopped arriving had to leave the app, find the marketing site
/// on a phone, and fill in the form built for strangers — standing in
/// somebody's basement. They will not. They churn, and it gets recorded as
/// churn rather than as the delivery bug it was.
///
/// This is where it matters most: the customer is on a phone, and neither
/// native client had anything at all.
///
/// Deliberately a mailto rather than chat or a ticket queue. A solo founder
/// cannot staff a desk, and a widget would imply one.
///
/// MIRROR of `packages/shared/src/support.ts` — Swift cannot import it, so the
/// body is hand-ported and the two must keep saying the same thing.
let supportEmail = "support@loonext.com"

/// The customer's own words go at the TOP — nobody should scroll past our
/// diagnostics to write the sentence they opened the app to write.
func supportBody(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?
) -> String {
    var lines = [
        "",
        "",
        "---",
        "The details below help us look this up. Please leave them in.",
        "Workspace: \(companyName ?? "(unnamed)") (\(companyId))",
    ]
    if let plan, !plan.isEmpty { lines.append("Plan: \(plan)") }
    let version = (appVersion?.isEmpty == false) ? " \(appVersion!)" : ""
    lines.append("App: ios\(version)")
    return lines.joined(separator: "\n")
}

func supportMailto(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
    subject: String = "Help with my Loonext workspace"
) -> URL? {
    let body = supportBody(
        companyId: companyId,
        companyName: companyName,
        plan: plan,
        appVersion: appVersion
    )
    var components = URLComponents()
    components.scheme = "mailto"
    components.path = supportEmail
    components.queryItems = [
        URLQueryItem(name: "subject", value: subject),
        URLQueryItem(name: "body", value: body),
    ]
    return components.url
}

/// Help (#382): one button that opens Mail with the workspace details already
/// in it, and the same details in plain text for a device with no mail account
/// configured — a shared work iPad often has none.
struct HelpSectionView: View {
    let scope: SettingsScope
    let company: CompanyView

    @Environment(\.openURL) private var openURL

    private var appVersion: String? {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    }

    private var body_: String {
        supportBody(
            companyId: scope.companyId,
            companyName: company.name,
            plan: company.plan,
            appVersion: appVersion
        )
    }

    var body: some View {
        SettingsCard(
            title: "Email us",
            description: "Opens Mail with your workspace details already filled in, "
                + "so we can look it up without asking you first."
        ) {
            Button("Email \(supportEmail)") {
                if let url = supportMailto(
                    companyId: scope.companyId,
                    companyName: company.name,
                    plan: company.plan,
                    appVersion: appVersion
                ) {
                    openURL(url)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandColor.olive)

            Spacer().frame(height: 10)
            ReadOnlyLine(
                "Say what you expected and what happened instead. If it's about a "
                    + "specific text or call, the customer's number and roughly when "
                    + "it happened is usually all we need."
            )
        }

        SettingsCard(
            title: "If that button doesn't open anything",
            description: "Write to \(supportEmail) from any email app and paste this in."
        ) {
            ReadOnlyLine(body_.trimmingCharacters(in: .whitespacesAndNewlines))
        }

        SettingsCard(
            title: "What to expect",
            description: "An honest answer rather than a promise we'd have to break."
        ) {
            ReadOnlyLine(
                "We're a small team, so this is email rather than a chat window. We "
                    + "read everything that comes in. If your texts have stopped "
                    + "arriving, say so in the subject line and we'll start there."
            )
        }
    }
}
