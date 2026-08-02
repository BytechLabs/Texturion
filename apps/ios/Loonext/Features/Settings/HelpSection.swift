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

/// #253 — the response time, stated rather than implied.
///
/// "A support channel a solo founder cannot service is worse than none — an
/// unanswered form is a promise broken in writing." Two business days is what
/// survives a bad week; the good weeks beat it, and beating a stated
/// commitment costs nothing. MIRROR of SUPPORT_RESPONSE_TIME in packages/shared.
let supportResponseTime = "within two business days, usually sooner"

/// #321 acceptance 4 — the loop, stated out loud.
///
/// The mechanism is a reply on the same email thread, made reliable rather than
/// heroic: `supportSubjectFor` gives every reporter of one failure the identical
/// subject, so one inbox search finds all of them, and docs/RELEASING.md makes
/// the reply a step of every release. MIRROR of SUPPORT_FIX_PROMISE in
/// packages/shared.
let supportFixPromise =
    "If you tell us something's broken, we write back when it's fixed, not just "
        + "when we've read it."

/// Mirror of SUPPORT_ERROR_LINES: a truncated mailto body carries NO diagnostics.
private let supportErrorLines = 6

/// #253 — the human sentence for a failure banner, or nil for one we do not
/// know. Nil rather than a guess: an invented sentence in a support email is
/// worse than none, because the reader trusts it and it came from nowhere.
///
/// MIRROR of `supportSituation` in packages/shared/src/support.ts, keyed on the
/// same strings, so one carrier suspension reported from three platforms lands
/// in the inbox under one name.
func supportSituation(_ kind: String) -> String? {
    switch kind {
    case "registration_pending": "US registration is pending approval"
    case "registration_suspended": "the carrier suspended our US registration"
    case "us_texting_off": "US texting is off for this workspace"
    case "usage_cap": "sending is paused at the spending cap"
    case "subscription": "the subscription is not active"
    case "opted_out": "this customer is opted out"
    case "opt_out_hint": "an opt-out was detected in the thread"
    case "number_access": "I do not have texting access to this number"
    case "read_only": "I have view-only access"
    default: nil
    }
}

/// The subject a report from a failure banner carries.
func supportSubjectFor(_ kind: String) -> String {
    guard let situation = supportSituation(kind) else {
        return "Help with my Loonext workspace"
    }
    return "Problem: \(situation)"
}

/// #253 — the questions that generate the most confusion, answered inside.
///
/// All of them already have honest answers: in a banner somebody has to hit, or
/// on a legal page somebody has to leave the app to find. Neither is reachable
/// by a person who has the question and is not currently staring at the
/// failure. MIRROR of SUPPORT_TOPICS in packages/shared.
struct SupportTopic: Identifiable {
    let question: String
    let answer: String

    var id: String { question }
}

let supportTopics: [SupportTopic] = [
    SupportTopic(
        question: "Why won't my text to a US number send?",
        answer: "US carriers require every business number to be registered before it can "
            + "text US phones. Approval usually takes 3 to 7 business days, and there is "
            + "nothing to do while it runs. Calls to US numbers work the whole time, and "
            + "Canadian texts are unaffected."
    ),
    SupportTopic(
        question: "What does \u{201C}registration pending\u{201D} actually mean?",
        answer: "We have submitted your business to the carriers and they have not answered "
            + "yet. It is a queue, not a review of anything you did. You will get an email "
            + "the moment it clears."
    ),
    SupportTopic(
        question: "Why did my number stop sending after it was working?",
        answer: "Two things do that. A carrier can suspend an approved registration, which "
            + "we are told about and act on without you doing anything. Or your workspace "
            + "has hit the spending cap the owner set, which is protection rather than a "
            + "quota and an owner can raise it in Settings."
    ),
    SupportTopic(
        question: "A customer says they never got my text. What now?",
        answer: "Check whether they ever texted STOP: a carrier opt-out blocks us and only "
            + "the customer can lift it, by texting START. If that is not it, email us the "
            + "customer's number and roughly when you sent it, and we can trace the message "
            + "with the carrier."
    ),
    SupportTopic(
        question: "How long does moving my existing number take?",
        answer: "Porting takes 7 to 10 business days once the carrier accepts the request, "
            + "and your old number keeps working the entire time. Nothing goes dark at any "
            + "point."
    ),
]

/// The customer's own words go at the TOP — nobody should scroll past our
/// diagnostics to write the sentence they opened the app to write.
func supportBody(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
    /// #253: what the person was looking at. A sentence, not a code.
    situation: String? = nil,
    /// #253: recent client failures, newest first, already scrubbed.
    recentErrors: [String] = []
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
    // The situation goes ABOVE the errors: it is the one line that says what
    // the person was trying to do, and it is true even when nothing errored.
    if let situation, !situation.isEmpty { lines.append("Screen: \(situation)") }
    let errors = recentErrors.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    if !errors.isEmpty {
        lines.append("Recent errors on this device (newest first):")
        for line in errors.prefix(supportErrorLines) { lines.append("  \(line)") }
    }
    return lines.joined(separator: "\n")
}

func supportMailto(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
    subject: String = "Help with my Loonext workspace",
    situation: String? = nil,
    recentErrors: [String] = []
) -> URL? {
    let body = supportBody(
        companyId: companyId,
        companyName: companyName,
        plan: plan,
        appVersion: appVersion,
        situation: situation,
        recentErrors: recentErrors
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

/// #253 — the feedback channel that is NOT a bug report.
///
/// Somebody with an idea does not write to an address labelled support: they
/// read that, correctly, as being for things that are broken, and their idea is
/// not a complaint. Same inbox, its own subject — a second address would be a
/// second thing nobody watches.
func feedbackMailto(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?
) -> URL? {
    supportMailto(
        companyId: companyId,
        companyName: companyName,
        plan: plan,
        appVersion: appVersion,
        subject: "Idea for Loonext"
    )
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

        // #253 — the feedback channel that is NOT a bug report. Feature
        // requests from a working contractor are the highest-signal product
        // input available to us, and there was no way for one to arrive.
        SettingsCard(
            title: "Got an idea?",
            description: "Something we don't do yet, or do in a way that doesn't fit "
                + "how you work."
        ) {
            Button("Send an idea") {
                if let url = feedbackMailto(
                    companyId: scope.companyId,
                    companyName: company.name,
                    plan: company.plan,
                    appVersion: appVersion
                ) {
                    openURL(url)
                }
            }
            .buttonStyle(.bordered)
            .tint(BrandColor.olive)

            Spacer().frame(height: 10)
            ReadOnlyLine(
                "This goes to the same place, under its own subject so it doesn't get "
                    + "triaged as a fault. Half of what's in the product came from "
                    + "someone describing their day."
            )
        }

        // #253 — the answers already exist, in banners you have to hit and
        // legal pages you have to leave the app to find. The gap was the index.
        SettingsCard(
            title: "Common questions",
            description: "The things that confuse people most, answered straight."
        ) {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(supportTopics) { topic in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(topic.question)
                            .font(.golos(13.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                        ReadOnlyLine(topic.answer)
                    }
                }
            }
        }

        SettingsCard(
            title: "What to expect",
            description: "An honest answer rather than a promise we'd have to break."
        ) {
            ReadOnlyLine(
                // #253 acceptance 4: a stated commitment, from ONE mirrored
                // constant. Two business days is what survives a bad week.
                "We reply \(supportResponseTime). We're a small team, so this is email "
                    + "rather than a chat window, and we read everything that comes in. "
                    + "If your texts have stopped arriving, say so in the subject line "
                    + "and we'll start there."
            )
            Spacer().frame(height: 8)
            // #321: the loop, stated. The reason to bother writing in is
            // knowing you will hear back — which makes the release step in
            // docs/RELEASING.md load-bearing, not optional.
            Text(supportFixPromise)
                .font(.golos(12.5, weight: .medium))
                .foregroundStyle(BrandColor.ink)
        }
    }
}
