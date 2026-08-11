package com.loonext.android.features.foryou

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ReferralMoment
import com.loonext.android.core.model.ReferralsView
import com.loonext.android.core.referral.ReferralShare
import com.loonext.android.features.settings.ReferralShareBlock
import com.loonext.android.ui.common.PaperCard

/**
 * #288 — the ask, at the moment it has been earned.
 *
 * ## What was wrong with where the ask lived
 *
 * Nowhere, on this client. And on web it sat in Settings > Billing with no moment
 * attached, which in practice means an owner met it once — poking around billing
 * on the day they signed up — and never again. #288 names both halves as the
 * mistake: "obvious placement at a moment of demonstrated satisfaction rather than
 * buried in settings", and "asking at signup is asking someone to vouch for
 * something they have not used, which costs credibility and converts badly".
 *
 * ## What makes this a moment
 *
 * The server will not say yes until the product has demonstrably worked: D12
 * activation, a month of it working, and twenty customers replied to in the last
 * thirty days. `referralAskDecision` in packages/shared holds those rules, so this
 * card and the two other clients cannot disagree about when an owner is asked for
 * a favour — and none of them re-derives it.
 *
 * Applying: Meaningful Highlights & Context, and Reciprocity — the headline is
 * "You replied to 37 customers this month", a fact about their business handed over
 * before anything is requested. That ordering is the difference between a prompt
 * that reads as earned and one that reads as a pop-up, and #288's own devil's
 * advocate is about exactly that failure.
 *
 * Applying: Ethical Friction, inverted — "Not now" is a plain button of the same
 * weight as the ask, not an X in a corner. A card asking for a favour has no
 * business making no hard to find, and the server holds that answer for a quarter.
 */
@Composable
fun ReferralAskCard(
    moment: ReferralMoment?,
    referrals: ReferralsView?,
    opened: Boolean,
    onOpen: () -> Unit,
    onDismiss: () -> Unit,
) {
    // Never a skeleton and never an error row. This is a favour being asked on
    // somebody's working screen; if we cannot tell whether it is the right moment,
    // silence is the answer.
    if (moment == null || !moment.ask) return

    PaperCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(
                ReferralShare.askHeadline(moment.customers),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                ReferralShare.ASK_BODY,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))

            if (opened) {
                if (referrals != null) {
                    ReferralShareBlock(link = referrals.link, code = referrals.code)
                } else {
                    // The one place a wait is worth showing: they pressed a button
                    // and are owed an answer about it.
                    Text(
                        t("inbox.referralGettingLink"),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onOpen) { Text(ReferralShare.ASK_ACTION) }
                    OutlinedButton(onClick = onDismiss) {
                        Text(ReferralShare.ASK_DISMISS)
                    }
                }
            }
        }
    }
}
