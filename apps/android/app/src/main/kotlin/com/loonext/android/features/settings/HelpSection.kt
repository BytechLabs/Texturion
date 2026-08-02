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
const val SUPPORT_RESPONSE_TIME = "within two business days, usually sooner"

/**
 * #321 acceptance 4 — the loop, stated out loud.
 *
 * The mechanism is a reply on the same email thread, made reliable rather than
 * heroic: `supportSubjectFor` gives every reporter of one failure the identical
 * subject, so one inbox search finds all of them, and docs/RELEASING.md makes
 * the reply a step of every release. MIRROR of SUPPORT_FIX_PROMISE in
 * packages/shared.
 */
const val SUPPORT_FIX_PROMISE =
    "If you tell us something's broken, we write back when it's fixed, not just " +
        "when we've read it."

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
 */
fun supportSituation(kind: String): String? = when (kind) {
    "registration_pending" -> "US registration is pending approval"
    "registration_suspended" -> "the carrier suspended our US registration"
    "us_texting_off" -> "US texting is off for this workspace"
    "usage_cap" -> "sending is paused at the spending cap"
    "subscription" -> "the subscription is not active"
    "opted_out" -> "this customer is opted out"
    "opt_out_hint" -> "an opt-out was detected in the thread"
    "number_access" -> "I do not have texting access to this number"
    "read_only" -> "I have view-only access"
    else -> null
}

/** The subject a report from a failure banner carries. */
fun supportSubjectFor(kind: String): String {
    val situation = supportSituation(kind)
    return if (situation == null) "Help with my Loonext workspace"
    else "Problem: $situation"
}

/**
 * #253 — the questions that generate the most confusion, answered inside.
 *
 * All of them already have honest answers: in a banner somebody has to hit, or
 * on a legal page somebody has to leave the app to find. Neither is reachable
 * by a person who has the question and is not currently staring at the failure.
 * MIRROR of SUPPORT_TOPICS in packages/shared.
 */
val SUPPORT_TOPICS: List<Pair<String, String>> = listOf(
    "Why won't my text to a US number send?" to
        "US carriers require every business number to be registered before it can text US " +
        "phones. Approval usually takes 3 to 7 business days, and there is nothing to do " +
        "while it runs. Calls to US numbers work the whole time, and Canadian texts are " +
        "unaffected.",
    "What does \u201Cregistration pending\u201D actually mean?" to
        "We have submitted your business to the carriers and they have not answered yet. It " +
        "is a queue, not a review of anything you did. You will get an email the moment it " +
        "clears.",
    "Why did my number stop sending after it was working?" to
        "Two things do that. A carrier can suspend an approved registration, which we are " +
        "told about and act on without you doing anything. Or your workspace has hit the " +
        "spending cap the owner set, which is protection rather than a quota and an owner " +
        "can raise it in Settings.",
    "A customer says they never got my text. What now?" to
        "Check whether they ever texted STOP: a carrier opt-out blocks us and only the " +
        "customer can lift it, by texting START. If that is not it, email us the customer's " +
        "number and roughly when you sent it, and we can trace the message with the carrier.",
    "How long does moving my existing number take?" to
        "Porting takes 7 to 10 business days once the carrier accepts the request, and your " +
        "old number keeps working the entire time. Nothing goes dark at any point.",
)

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
): String {
    val lines = mutableListOf(
        "",
        "",
        "---",
        "The details below help us look this up. Please leave them in.",
        "Workspace: ${companyName ?: "(unnamed)"} ($companyId)",
    )
    if (!plan.isNullOrBlank()) lines.add("Plan: $plan")
    lines.add("App: android${if (!appVersion.isNullOrBlank()) " $appVersion" else ""}")
    // The situation goes ABOVE the errors: it is the one line that says what
    // the person was trying to do, and it is true even when nothing errored.
    if (!situation.isNullOrBlank()) lines.add("Screen: $situation")
    val errors = recentErrors.filter { it.isNotBlank() }
    if (errors.isNotEmpty()) {
        lines.add("Recent errors on this device (newest first):")
        errors.take(SUPPORT_ERROR_LINES).forEach { lines.add("  $it") }
    }
    return lines.joinToString("\n")
}

fun supportMailto(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
    subject: String = "Help with my Loonext workspace",
    situation: String? = null,
    recentErrors: List<String> = emptyList(),
): String {
    fun enc(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    val body = supportBody(companyId, companyName, plan, appVersion, situation, recentErrors)
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
): String = supportMailto(
    companyId = companyId,
    companyName = companyName,
    plan = plan,
    appVersion = appVersion,
    subject = "Idea for Loonext",
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

    val body = supportBody(scope.companyId, companyName, plan, appVersion)

    SettingsCard(
        title = "Email us",
        description = "Opens your mail app with your workspace details already filled in, " +
            "so we can look it up without asking you first.",
    ) {
        Button(
            onClick = {
                openExternal(
                    context,
                    supportMailto(scope.companyId, companyName, plan, appVersion),
                )
            },
        ) { Text("Email $SUPPORT_EMAIL") }
        Spacer(Modifier.height(10.dp))
        ReadOnlyLine(
            "Say what you expected and what happened instead. If it's about a " +
                "specific text or call, the customer's number and roughly when " +
                "it happened is usually all we need.",
        )
    }

    SettingsCard(
        title = "If that button doesn't open anything",
        description = "Write to $SUPPORT_EMAIL from any email app and paste this in.",
    ) {
        ReadOnlyLine(body.trim())
    }

    // #253 — the feedback channel that is NOT a bug report. Feature requests
    // from a working contractor are the highest-signal product input available
    // to us, and there was no way for one to arrive.
    SettingsCard(
        title = "Got an idea?",
        description = "Something we don't do yet, or do in a way that doesn't fit " +
            "how you work.",
    ) {
        Button(
            onClick = {
                openExternal(
                    context,
                    feedbackMailto(scope.companyId, companyName, plan, appVersion),
                )
            },
        ) { Text("Send an idea") }
        Spacer(Modifier.height(10.dp))
        ReadOnlyLine(
            "This goes to the same place, under its own subject so it doesn't get " +
                "triaged as a fault. Half of what's in the product came from " +
                "someone describing their day.",
        )
    }

    // #253 — the answers already exist, in banners you have to hit and legal
    // pages you have to leave the app to find. The gap was the index.
    SettingsCard(
        title = "Common questions",
        description = "The things that confuse people most, answered straight.",
    ) {
        SUPPORT_TOPICS.forEachIndexed { index, (question, answer) ->
            if (index > 0) Spacer(Modifier.height(12.dp))
            Text(question, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(2.dp))
            ReadOnlyLine(answer)
        }
    }

    SettingsCard(
        title = "What to expect",
        description = "An honest answer rather than a promise we'd have to break.",
    ) {
        ReadOnlyLine(
            // #253 acceptance 4: a stated commitment, from ONE mirrored
            // constant. Two business days is what survives a bad week.
            "We reply $SUPPORT_RESPONSE_TIME. We're a small team, so this is email " +
                "rather than a chat window, and we read everything that comes in. " +
                "If your texts have stopped arriving, say so in the subject line " +
                "and we'll start there.",
        )
        Spacer(Modifier.height(8.dp))
        // #321: the loop, stated. The reason to bother writing in is knowing
        // you will hear back — which makes the release step in
        // docs/RELEASING.md load-bearing, not optional.
        Text(SUPPORT_FIX_PROMISE, style = MaterialTheme.typography.bodyMedium)
    }
}
