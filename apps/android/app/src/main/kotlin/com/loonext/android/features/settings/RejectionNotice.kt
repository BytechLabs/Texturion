package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.RejectionDomain
import com.loonext.android.core.model.explainRejection
import com.loonext.android.core.model.needsHumanHelp
import com.loonext.android.core.model.resubmissionWait

/**
 * #352 — what a rejected customer reads, and the one thing they do next.
 *
 * Mirror of `apps/web/src/components/settings/rejection-notice.tsx`. `docs/
 * DESIGN.md` G7 has always required *"rejection reason in plain language +
 * 'Fix and resubmit' form"*; the form shipped and the plain language did not, so
 * a customer saw the carrier's own token — `BRAND_LEGAL_NAME_MISMATCH` —
 * followed by a sixteen-field form.
 *
 * Each part answers a specific failure, and they are the same failures on every
 * platform:
 *
 * - **Two sentences, G10's shape** (*"what happened + what to do"*). The old
 *   copy had only the first half, in the carrier's vocabulary.
 * - **A jump to the field**, which matters MORE here than on the web: the fix
 *   form is collapsed behind an "Edit your details" button, so a rejection on a
 *   phone was two taps and a scroll away from the thing that was wrong.
 * - **The carrier's own words stay on screen**, demoted, never hidden. When the
 *   catalogue does not recognise a reason that text is all the customer has.
 * - **The wait is stated**, because a second wait of unknown length is where
 *   people give up.
 * - **The second rejection offers a person.** By then they cannot tell what is
 *   wrong from what we have shown them, and a third solo attempt buys another
 *   multi-day carrier review to learn the same thing.
 */
@Composable
fun RejectionNotice(
    domain: RejectionDomain,
    reason: String?,
    submissionCount: Int?,
    onGoToField: (String) -> Unit,
) {
    val guidance = explainRejection(domain, reason)
    val stuck = needsHumanHelp(submissionCount)
    val subject = if (domain == RejectionDomain.PORT) "transfer" else "registration"
    val uriHandler = LocalUriHandler.current

    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(
                guidance?.what
                    ?: "The carrier turned down this $subject and did not say why in a way we can translate.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                guidance?.fix
                    ?: "Check the details below against your official registration paperwork, and reply to us if nothing looks wrong.",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp),
            )
            if (!reason.isNullOrBlank()) {
                // Carrier-authored, unbounded, and frequently one long token.
                // Kept visible so a support conversation can quote the same
                // string the customer is looking at.
                Text(
                    "The carrier said: $reason",
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Text(
                resubmissionWait(domain),
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(top = 6.dp),
            )
            val field = guidance?.field
            if (field != null || stuck) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(top = 2.dp),
                ) {
                    if (field != null) {
                        TextButton(onClick = { onGoToField(field) }) { Text("Take me to it") }
                    }
                    if (stuck) {
                        // Offered ALONGSIDE the form, not instead of it —
                        // somebody who now knows what to change should not wait
                        // for a reply before changing it.
                        TextButton(
                            onClick = {
                                uriHandler.openUri(
                                    "mailto:support@loonext.com?subject=" +
                                        "My%20$subject%20keeps%20getting%20rejected",
                                )
                            },
                        ) { Text("Get help from us") }
                    }
                }
            }
        }
    }
}
