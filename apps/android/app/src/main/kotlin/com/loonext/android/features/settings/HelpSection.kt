package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.loonext.android.core.diag.RecentErrors
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import java.net.URLEncoder

/**
 * #382 — the route to a human, from inside the app.
 *
 * Settings had eleven sections here and none of them was this. A tradesperson
 * whose texts stopped arriving had to leave the app, find the marketing site on
 * a phone, and fill in the form built for strangers — standing in somebody's
 * basement. They will not. They churn, and it gets recorded as churn rather
 * than as the delivery bug it was.
 *
 * This is where it matters most: the customer is on a phone, and neither native
 * client had anything at all.
 *
 * Deliberately a mailto rather than chat or a ticket queue. A solo founder
 * cannot staff a desk and a widget would imply one.
 *
 * MIRROR of `packages/shared/src/support.ts` — Kotlin cannot import it, so the
 * body is hand-ported and the two must be kept saying the same thing. See
 * [[shared-logic-hand-port-trap]] in spirit: the risk is real, so the format is
 * kept deliberately simple.
 */
const val SUPPORT_EMAIL = "support@loonext.com"

/**
 * #253 — the response time, stated rather than implied.
 *
 * "A support channel a solo founder cannot service is worse than none — an
 * unanswered form is a promise broken in writing." Two business days is what
 * survives a bad week; the good weeks beat it, and beating a stated commitment
 * costs nothing. MIRROR of SUPPORT_RESPONSE_TIME in packages/shared.
 */
val SUPPORT_RESPONSE_TIME: String
    get() = AppStrings.translate(null, "settings.helpResponseTime")

/**
 * #321 acceptance 4 — the loop, stated out loud.
 *
 * The mechanism is a reply on the same email thread, made reliable rather than
 * heroic: `supportSubjectFor` gives every reporter of one failure the identical
 * subject, so one inbox search finds all of them, and docs/RELEASING.md makes
 * the reply a step of every release. MIRROR of SUPPORT_FIX_PROMISE in
 * packages/shared.
 */
val SUPPORT_FIX_PROMISE: String
    get() = AppStrings.translate(null, "settings.helpFixPromise")

/** Mirror of SUPPORT_ERROR_LINES: a truncated mailto body carries NO diagnostics. */
private const val SUPPORT_ERROR_LINES = 6

/**
 * #253 — the human sentence for a failure banner, or null for one we do not
 * know. Null rather than a guess: an invented sentence in a support email is
 * worse than none, because the reader trusts it and it came from nowhere.
 *
 * MIRROR of `supportSituation` in packages/shared/src/support.ts. Keyed on the
 * same strings the shared banner kinds use, so one carrier suspension reported
 * from three platforms lands in the inbox under one name.
 *
 * ## THE KEY, not the sentence
 *
 * Because the two readers of it want different languages and both are right.
 * [supportBody] renders it for the PERSON, in whatever they read; the SUBJECT
 * renders the same key against the English table on purpose
 * ([supportSubjectFor]). A subject line is the inbox's index, and one carrier
 * suspension reported from Montreal and from Calgary has to arrive under one
 * heading, or the pattern that matters most — five reports of one failure in
 * a morning — is the one that stops being visible.
 */
internal fun supportSituationKey(kind: String): String? = when (kind) {
    "registration_pending" -> "settings.supportSituationRegistrationPending"
    "registration_suspended" -> "settings.supportSituationRegistrationSuspended"
    "us_texting_off" -> "settings.supportSituationUsTextingOff"
    "usage_cap" -> "settings.supportSituationUsageCap"
    "subscription" -> "settings.supportSituationSubscription"
    "opted_out" -> "settings.supportSituationOptedOut"
    "opt_out_hint" -> "settings.supportSituationOptOutHint"
    "number_access" -> "settings.supportSituationNumberAccess"
    "read_only" -> "settings.supportSituationReadOnly"
    else -> null
}

fun supportSituation(kind: String, locale: String? = null): String? =
    supportSituationKey(kind)?.let { AppStrings.translate(locale, it) }

/** The subject a report from a failure banner carries. */
fun supportSubjectFor(kind: String): String {
    // `translate(null, …)` asks for the ENGLISH table by the same rule a missing
    // locale always has. Deliberate, and the one place in this file that is: see
    // [supportSituationKey] for why the index is one language.
    val situation = supportSituationKey(kind)?.let { AppStrings.translate(null, it) }
    return if (situation == null) {
        AppStrings.translate(null, "settings.supportSubjectDefault")
    } else {
        AppStrings.translate(
            null,
            "settings.supportSubjectProblem",
            mapOf("situation" to situation),
        )
    }
}

/**
 * #253 — the questions that generate the most confusion, answered inside.
 *
 * All of them already have honest answers: in a banner somebody has to hit, or
 * on a legal page somebody has to leave the app to find. Neither is reachable
 * by a person who has the question and is not currently staring at the failure.
 * MIRROR of SUPPORT_TOPICS in packages/shared.
 */
private val SUPPORT_TOPIC_KEYS: List<Pair<String, String>> = listOf(
    "settings.helpFaqUsSendQ" to "settings.helpFaqUsSendA",
    "settings.helpFaqPendingQ" to "settings.helpFaqPendingA",
    "settings.helpFaqStoppedQ" to "settings.helpFaqStoppedA",
    "settings.helpFaqNotGotQ" to "settings.helpFaqNotGotA",
    "settings.helpFaqPortQ" to "settings.helpFaqPortA",
)

/** The questions and their answers, in one language. */
fun supportTopics(locale: String? = null): List<Pair<String, String>> =
    SUPPORT_TOPIC_KEYS.map { (question, answer) ->
        AppStrings.translate(locale, question) to AppStrings.translate(locale, answer)
    }

/** The English, for the guards that compare this app against the shared module. */
val SUPPORT_TOPICS: List<Pair<String, String>> get() = supportTopics()

/**
 * The customer's own words go at the TOP — nobody should scroll past our
 * diagnostics to write the sentence they opened the app to write.
 */
fun supportBody(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
    /** #253: what the person was looking at. A sentence, not a code. */
    situation: String? = null,
    /** #253: recent client failures, newest first, already scrubbed. */
    recentErrors: List<String> = emptyList(),
    /**
     * The reader's language. This block is printed on the help screen for a
     * device with no mail app, so it is read here before it is read by us.
     * The values inside it — a workspace id, a plan slug, a version, an error
     * line — are the diagnostic and have no language at all.
     */
    locale: String? = null,
): String {
    fun say(key: String, vararg vars: Pair<String, String>) =
        AppStrings.translate(locale, key, vars.toMap())

    val lines = mutableListOf(
        "",
        "",
        "---",
        say("settings.supportBodyLeadIn"),
        say(
            "settings.supportBodyWorkspace",
            "name" to (companyName ?: say("settings.supportBodyUnnamed")),
            "id" to companyId,
        ),
    )
    if (!plan.isNullOrBlank()) lines.add(say("settings.supportBodyPlan", "plan" to plan))
    lines.add(
        if (appVersion.isNullOrBlank()) {
            say("settings.supportBodyAppNoVersion")
        } else {
            say("settings.supportBodyApp", "version" to appVersion)
        },
    )
    // The situation goes ABOVE the errors: it is the one line that says what
    // the person was trying to do, and it is true even when nothing errored.
    if (!situation.isNullOrBlank()) {
        lines.add(say("settings.supportBodyScreen", "situation" to situation))
    }
    val errors = recentErrors.filter { it.isNotBlank() }
    if (errors.isNotEmpty()) {
        lines.add(say("settings.supportBodyErrors"))
        errors.take(SUPPORT_ERROR_LINES).forEach { lines.add("  $it") }
    }
    return lines.joinToString("\n")
}

fun supportMailto(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
    subject: String = AppStrings.translate(null, "settings.supportSubjectDefault"),
    situation: String? = null,
    recentErrors: List<String> = emptyList(),
    locale: String? = null,
): String {
    fun enc(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    val body = supportBody(
        companyId, companyName, plan, appVersion, situation, recentErrors, locale,
    )
    return "mailto:$SUPPORT_EMAIL?subject=${enc(subject)}&body=${enc(body)}"
}

/**
 * #253 — the feedback channel that is NOT a bug report.
 *
 * Somebody with an idea does not write to an address labelled support: they
 * read that, correctly, as being for things that are broken, and their idea is
 * not a complaint. Same inbox, its own subject — a second address would be a
 * second thing nobody watches.
 */
fun feedbackMailto(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
    /**
     * #555: the parameter this function did not have.
     *
     * `supportMailto` and `supportBody` both accepted recent client failures and
     * defaulted them to an empty list, and every call site on this screen took the
     * default — so the ring that records a failure was never attached to anything.
     * Web has always sent it. Recording a diagnosis nobody can collect is the same
     * as not recording it.
     */
    recentErrors: List<String> = emptyList(),
    locale: String? = null,
): String = supportMailto(
    recentErrors = recentErrors,
    companyId = companyId,
    companyName = companyName,
    plan = plan,
    appVersion = appVersion,
    subject = AppStrings.translate(null, "settings.supportSubjectIdea"),
    locale = locale,
)

/**
 * Help (#382): one button that opens the mail app with the workspace details
 * already in it, and the same details in plain text for a device with no mail
 * app configured — a shared work tablet often has none.
 */
@Composable
fun HelpSection(scope: SettingsScope, companyName: String?, plan: String?) {
    val context = LocalContext.current
    val appVersion = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull()

    // #555: whatever has failed on this device recently rides along. The
    // customer should not have to know what we need in order to be helped, and
    // they cannot read a log. Already scrubbed by RecentErrors.
    val recentErrors = RecentErrors.recentLines()
    val locale = LocalAppLocale.current
    val body = supportBody(
        scope.companyId, companyName, plan, appVersion,
        recentErrors = recentErrors,
        locale = locale,
    )

    SettingsCard(
        title = t("settings.helpEmailTitle"),
        description = t("settings.helpEmailIntro"),
    ) {
        Button(
            onClick = {
                openExternal(
                    context,
                    supportMailto(
                        scope.companyId, companyName, plan, appVersion,
                        recentErrors = recentErrors,
                        locale = locale,
                    ),
                )
            },
        ) { Text(t("settings.helpEmailAction", "email" to SUPPORT_EMAIL)) }
        Spacer(Modifier.height(10.dp))
        ReadOnlyLine(t("settings.helpWhatToSay"))
    }

    SettingsCard(
        title = t("settings.helpNoMailAppTitle"),
        description = t("settings.helpNoMailAppIntro", "email" to SUPPORT_EMAIL),
    ) {
        ReadOnlyLine(body.trim())
    }

    // #253 — the feedback channel that is NOT a bug report. Feature requests
    // from a working contractor are the highest-signal product input available
    // to us, and there was no way for one to arrive.
    SettingsCard(
        title = t("settings.helpIdeaTitle"),
        description = t("settings.helpIdeaIntro"),
    ) {
        Button(
            onClick = {
                openExternal(
                    context,
                    feedbackMailto(
                        scope.companyId, companyName, plan, appVersion,
                        recentErrors = recentErrors,
                        locale = locale,
                    ),
                )
            },
        ) { Text(t("settings.helpIdeaAction")) }
        Spacer(Modifier.height(10.dp))
        ReadOnlyLine(t("settings.helpIdeaNote"))
    }

    // #253 — the answers already exist, in banners you have to hit and legal
    // pages you have to leave the app to find. The gap was the index.
    SettingsCard(
        title = t("settings.helpFaqTitle"),
        description = t("settings.helpFaqIntro"),
    ) {
        supportTopics(locale).forEachIndexed { index, (question, answer) ->
            if (index > 0) Spacer(Modifier.height(12.dp))
            Text(question, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(2.dp))
            ReadOnlyLine(answer)
        }
    }

    SettingsCard(
        title = t("settings.helpExpectTitle"),
        description = t("settings.helpExpectIntro"),
    ) {
        ReadOnlyLine(
            // #253 acceptance 4: a stated commitment, from ONE mirrored
            // constant. Two business days is what survives a bad week. The
            // sentence around it is web's own `appShell.helpReplyPromise`, in
            // both languages, and the window rides in as `{time}` exactly as it
            // does there.
            t("settings.helpReplyPromise", "time" to t("settings.helpResponseTime")),
        )
        Spacer(Modifier.height(8.dp))
        // #321: the loop, stated. The reason to bother writing in is knowing
        // you will hear back — which makes the release step in
        // docs/RELEASING.md load-bearing, not optional.
        Text(t("settings.helpFixPromise"), style = MaterialTheme.typography.bodyMedium)
    }
}
