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
///
/// #228: resolved against the ENGLISH table, exactly as Android's
/// `SUPPORT_RESPONSE_TIME` getter is, and its French entry is deliberately the
/// English words — web injects this same untranslated constant into its French
/// `helpReplyPromise` too. Fixing that is a copy decision for all three clients
/// at once; doing it on iOS alone would be the drift this pass exists to end.
let supportResponseTime = AppStrings.translate(nil, "settings.helpResponseTime")

/// #321 acceptance 4 — the loop, stated out loud.
///
/// The mechanism is a reply on the same email thread, made reliable rather than
/// heroic: `supportSubjectFor` gives every reporter of one failure the identical
/// subject, so one inbox search finds all of them, and docs/RELEASING.md makes
/// the reply a step of every release. MIRROR of SUPPORT_FIX_PROMISE in
/// packages/shared.
let supportFixPromise = AppStrings.translate(nil, "settings.helpFixPromise")

/// Mirror of SUPPORT_ERROR_LINES: a truncated mailto body carries NO diagnostics.
private let supportErrorLines = 6

/// #253 — the human sentence for a failure banner, or nil for one we do not
/// know. Nil rather than a guess: an invented sentence in a support email is
/// worse than none, because the reader trusts it and it came from nowhere.
///
/// MIRROR of `supportSituation` in packages/shared/src/support.ts, keyed on the
/// same strings, so one carrier suspension reported from three platforms lands
/// in the inbox under one name.
///
/// ## THE KEY, not the sentence
///
/// Because the two readers of it want different languages and both are right.
/// `supportBody` renders it for the PERSON, in whatever they read; the SUBJECT
/// renders the same key against the English table on purpose
/// (`supportSubjectFor`). A subject line is the inbox's index, and one carrier
/// suspension reported from Montreal and from Calgary has to arrive under one
/// heading, or the pattern that matters most — five reports of one failure in a
/// morning — is the one that stops being visible.
func supportSituationKey(_ kind: String) -> String? {
    switch kind {
    case "registration_pending": "settings.supportSituationRegistrationPending"
    case "registration_suspended": "settings.supportSituationRegistrationSuspended"
    case "us_texting_off": "settings.supportSituationUsTextingOff"
    case "usage_cap": "settings.supportSituationUsageCap"
    case "subscription": "settings.supportSituationSubscription"
    case "opted_out": "settings.supportSituationOptedOut"
    case "opt_out_hint": "settings.supportSituationOptOutHint"
    case "number_access": "settings.supportSituationNumberAccess"
    case "read_only": "settings.supportSituationReadOnly"
    default: nil
    }
}

func supportSituation(_ kind: String, _ locale: String? = nil) -> String? {
    supportSituationKey(kind).map { AppStrings.translate(locale, $0) }
}

/// The subject a report from a failure banner carries.
func supportSubjectFor(_ kind: String) -> String {
    // `translate(nil, …)` asks for the ENGLISH table by the same rule a missing
    // locale always has. Deliberate, and the one place in this file that is:
    // see `supportSituationKey` for why the index is one language.
    guard let situation = supportSituationKey(kind).map({ AppStrings.translate(nil, $0) })
    else {
        return AppStrings.translate(nil, "settings.supportSubjectDefault")
    }
    return AppStrings.translate(
        nil, "settings.supportSubjectProblem", ["situation": situation]
    )
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

private let supportTopicKeys: [(question: String, answer: String)] = [
    ("settings.helpFaqUsSendQ", "settings.helpFaqUsSendA"),
    ("settings.helpFaqPendingQ", "settings.helpFaqPendingA"),
    ("settings.helpFaqStoppedQ", "settings.helpFaqStoppedA"),
    ("settings.helpFaqNotGotQ", "settings.helpFaqNotGotA"),
    ("settings.helpFaqPortQ", "settings.helpFaqPortA"),
]

/// The questions and their answers, in one language.
///
/// A differently-named function rather than an overload of `supportTopics`: a
/// top-level `let` and a top-level `func` sharing a base name is an invalid
/// redeclaration in Swift, and this file is only ever compiled in CI.
func localisedSupportTopics(_ locale: String?) -> [SupportTopic] {
    supportTopicKeys.map { pair in
        SupportTopic(
            question: AppStrings.translate(locale, pair.question),
            answer: AppStrings.translate(locale, pair.answer)
        )
    }
}

/// The English, for the guards that compare this app against the shared module.
let supportTopics: [SupportTopic] = localisedSupportTopics(nil)

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
    recentErrors: [String] = [],
    /// The reader's language. This block is printed on the help screen for a
    /// device with no mail app, so it is read HERE before it is read by us. The
    /// values inside it — a workspace id, a plan slug, a version, an error line
    /// — are the diagnostic and have no language at all.
    locale: String? = nil
) -> String {
    func say(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(locale, key, vars)
    }
    var lines = [
        "",
        "",
        "---",
        say("settings.supportBodyLeadIn"),
        say(
            "settings.supportBodyWorkspace",
            [
                "name": companyName ?? say("settings.supportBodyUnnamed"),
                "id": companyId,
            ]
        ),
    ]
    if let plan, !plan.isEmpty {
        lines.append(say("settings.supportBodyPlan", ["plan": plan]))
    }
    if let appVersion, !appVersion.isEmpty {
        lines.append(say("settings.supportBodyApp", ["version": appVersion]))
    } else {
        lines.append(say("settings.supportBodyAppNoVersion"))
    }
    // The situation goes ABOVE the errors: it is the one line that says what
    // the person was trying to do, and it is true even when nothing errored.
    if let situation, !situation.isEmpty {
        lines.append(say("settings.supportBodyScreen", ["situation": situation]))
    }
    let errors = recentErrors.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    if !errors.isEmpty {
        lines.append(say("settings.supportBodyErrors"))
        for line in errors.prefix(supportErrorLines) { lines.append("  \(line)") }
    }
    return lines.joined(separator: "\n")
}

func supportMailto(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
    subject: String = AppStrings.translate(nil, "settings.supportSubjectDefault"),
    situation: String? = nil,
    recentErrors: [String] = [],
    locale: String? = nil
) -> URL? {
    let body = supportBody(
        companyId: companyId,
        companyName: companyName,
        plan: plan,
        appVersion: appVersion,
        situation: situation,
        recentErrors: recentErrors,
        locale: locale
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
    appVersion: String?,
    /// #555: the parameter this function did not have. `supportMailto` and
    /// `supportBody` both accepted recent client failures and defaulted them to an
    /// empty array, and every call site here took the default — so the log that
    /// records a failure was never attached to anything. Web has always sent it.
    /// Recording a diagnosis nobody can collect is the same as not recording it.
    recentErrors: [String] = [],
    locale: String? = nil
) -> URL? {
    supportMailto(
        companyId: companyId,
        companyName: companyName,
        plan: plan,
        appVersion: appVersion,
        // English, for the reason `supportSubjectFor` gives: a subject line is
        // the inbox's index, not a sentence for the reader.
        subject: AppStrings.translate(nil, "settings.supportSubjectIdea"),
        recentErrors: recentErrors,
        locale: locale
    )
}

/// Help (#382): one button that opens Mail with the workspace details already
/// in it, and the same details in plain text for a device with no mail account
/// configured — a shared work iPad often has none.
struct HelpSectionView: View {
    let scope: SettingsScope
    let company: CompanyView

    @Environment(\.openURL) private var openURL
    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var appVersion: String? {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    }

    /// #555: whatever has failed on this device recently rides along. The
    /// customer should not have to know what we need in order to be helped, and
    /// they cannot read a log.
    private var recentErrors: [String] { DiagnosticsLog.recentLines() }

    private var body_: String {
        supportBody(
            companyId: scope.companyId,
            companyName: company.name,
            plan: company.plan,
            appVersion: appVersion,
            recentErrors: recentErrors,
            locale: appLocale
        )
    }

    var body: some View {
        SettingsCard(
            title: t("settings.helpEmailTitle"),
            description: t("settings.helpEmailIntro")
        ) {
            Button(AppStrings.translate(
                appLocale, "settings.helpEmailAction", ["email": supportEmail]
            )) {
                if let url = supportMailto(
                    companyId: scope.companyId,
                    companyName: company.name,
                    plan: company.plan,
                    appVersion: appVersion,
                    recentErrors: recentErrors,
                    locale: appLocale
                ) {
                    openURL(url)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandColor.olive)

            Spacer().frame(height: 10)
            ReadOnlyLine(t("settings.helpWhatToSay"))
        }

        SettingsCard(
            title: t("settings.helpNoMailAppTitle"),
            description: AppStrings.translate(
                appLocale, "settings.helpNoMailAppIntro", ["email": supportEmail]
            )
        ) {
            ReadOnlyLine(body_.trimmingCharacters(in: .whitespacesAndNewlines))
        }

        // #253 — the feedback channel that is NOT a bug report. Feature
        // requests from a working contractor are the highest-signal product
        // input available to us, and there was no way for one to arrive.
        SettingsCard(
            title: t("settings.helpIdeaTitle"),
            description: t("settings.helpIdeaIntro")
        ) {
            Button(t("settings.helpIdeaAction")) {
                if let url = feedbackMailto(
                    companyId: scope.companyId,
                    companyName: company.name,
                    plan: company.plan,
                    appVersion: appVersion,
                    recentErrors: recentErrors,
                    locale: appLocale
                ) {
                    openURL(url)
                }
            }
            .buttonStyle(.bordered)
            .tint(BrandColor.olive)

            Spacer().frame(height: 10)
            ReadOnlyLine(t("settings.helpIdeaNote"))
        }

        // #253 — the answers already exist, in banners you have to hit and
        // legal pages you have to leave the app to find. The gap was the index.
        SettingsCard(
            title: t("settings.helpFaqTitle"),
            description: t("settings.helpFaqIntro")
        ) {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(localisedSupportTopics(appLocale)) { topic in
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
            title: t("settings.helpExpectTitle"),
            description: t("settings.helpExpectIntro")
        ) {
            ReadOnlyLine(
                // #253 acceptance 4: a stated commitment, from ONE mirrored
                // constant. Two business days is what survives a bad week. The
                // sentence around it is web's own `appShell.helpReplyPromise`,
                // in both languages, and the window rides in as `{time}`
                // exactly as it does there.
                AppStrings.translate(
                    appLocale,
                    "settings.helpReplyPromise",
                    ["time": t("settings.helpResponseTime")]
                )
            )
            Spacer().frame(height: 8)
            // #321: the loop, stated. The reason to bother writing in is
            // knowing you will hear back — which makes the release step in
            // docs/RELEASING.md load-bearing, not optional.
            Text(t("settings.helpFixPromise"))
                .font(.golos(12.5, weight: .medium))
                .foregroundStyle(BrandColor.ink)
        }
    }
}
