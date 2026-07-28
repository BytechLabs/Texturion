package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
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
 * The customer's own words go at the TOP — nobody should scroll past our
 * diagnostics to write the sentence they opened the app to write.
 */
fun supportBody(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
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
    return lines.joinToString("\n")
}

fun supportMailto(
    companyId: String,
    companyName: String?,
    plan: String?,
    appVersion: String?,
    subject: String = "Help with my Loonext workspace",
): String {
    fun enc(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    val body = supportBody(companyId, companyName, plan, appVersion)
    return "mailto:$SUPPORT_EMAIL?subject=${enc(subject)}&body=${enc(body)}"
}

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

    SettingsCard(
        title = "What to expect",
        description = "An honest answer rather than a promise we'd have to break.",
    ) {
        ReadOnlyLine(
            "We're a small team, so this is email rather than a chat window. We " +
                "read everything that comes in. If your texts have stopped " +
                "arriving, say so in the subject line and we'll start there.",
        )
    }
}
