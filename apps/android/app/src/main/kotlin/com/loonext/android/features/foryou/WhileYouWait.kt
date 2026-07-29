package com.loonext.android.features.foryou

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.isWaitingOnRegistration
import com.loonext.android.core.model.registrationProgress

/**
 * #310 — the waiting room, made into somewhere.
 *
 * A tradesperson signs up at 9pm on a Sunday because they are fed up with
 * missing jobs, and we say "come back in a few days" while 10DLC registration
 * clears. The reason people leave is not the wait — it is that "pending" with
 * no visible movement is indistinguishable from broken.
 *
 * Three things, and the order is the point: show the wait working, lead with
 * what already works (calls, from day one — a workspace that spends the wait
 * TAKING CALLS has already adopted the product), then sequence the setup that
 * does not depend on approval.
 *
 * Ported 1:1 in behaviour from web's `while-you-wait.tsx` and iOS's
 * `WhileYouWait.swift`; the copy itself comes from the shared derivation, so
 * two devices cannot describe the same wait differently.
 */
@Composable
fun WhileYouWait(
    company: CompanyView?,
    onOpenContacts: () -> Unit,
    onOpenTeam: () -> Unit,
    onOpenHours: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val brand = company?.registration?.brand?.status
    val campaign = company?.registration?.campaign?.status

    // Only while the wait is genuinely on the carriers. A workspace we are
    // waiting ON gets nothing here — pointing it at setup work would point
    // away from the thing actually blocking it.
    if (company == null || !isWaitingOnRegistration(brand, campaign)) return

    val progress = registrationProgress(brand, campaign)

    Card(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(progress.title, style = MaterialTheme.typography.titleSmall)
            Text(
                progress.next,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // The bar marks steps BEHIND you, not time remaining — a countdown
            // we cannot honour is worse than none. Never 0: a bar at zero for
            // four days is the spinner this replaces.
            LinearProgressIndicator(
                progress = { progress.percent / 100f },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            progress.expected?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // What already works. FIRST, not as a footnote.
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    Icons.Outlined.Call,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Column {
                    Text("Calls already work", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Your number rings, takes voicemail, and texts back anyone you " +
                            "miss. None of that waits on the carriers.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Three, not the whole settings surface.
            SetupStep("Bring your customers in", onOpenContacts)
            SetupStep("Invite your crew", onOpenTeam)
            SetupStep("Set your hours and greeting", onOpenHours)
        }
    }
}

/**
 * One thing worth doing now.
 *
 * Deliberately NOT a checkbox. Completion would need a definition of "enough
 * contacts" we do not have, and a checklist that stays unticked while somebody
 * has plainly done the work is its own small insult. These are doors.
 */
@Composable
private fun SetupStep(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Icon(
                Icons.AutoMirrored.Outlined.ArrowForward,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}
