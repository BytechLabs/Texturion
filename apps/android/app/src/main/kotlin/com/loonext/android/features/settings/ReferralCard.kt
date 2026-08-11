package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ReferralsView
import com.loonext.android.core.referral.ReferralShare

/**
 * #288/#399 — the referral link on the phone, which had none.
 *
 * ## Why this did not exist and had to
 *
 * The mechanism, the accounting and the payout all shipped with #399, and the
 * only client that could reach any of it was the web app. #288 asks for "one tap,
 * a pre-written message they can edit, sent from the phone they are already
 * holding" — and the phone was the one place a contractor could not do it. A crew
 * lead thinking of somebody to tell is standing at a supply counter, not sitting
 * at a laptop.
 *
 * ## Where it sits
 *
 * Inside Settings, next to billing, behind the same `billing.manage` capability
 * the endpoint enforces — the reward is a month off the invoice, so it belongs to
 * whoever the invoice belongs to. The MOMENT-based ask lives on the home screen
 * instead; this is the copy of it somebody comes looking for.
 *
 * Applying: Zen of Clarity — the draft, one primary action, one fallback, and the
 * four states as a plain list rather than a table. Chunking — what the reward is,
 * how to send it, and what it has done, in that order.
 *
 * PARITY. Same copy and same states as web's `referral-card.tsx` and iOS's
 * `ReferralCard.swift`, asserted against the shared TypeScript by
 * `ReferralShareTest`.
 */
@Composable
fun ReferralCard(view: ReferralsView) {
    SettingsCard(title = ReferralShare.TITLE) {
        Text(
            "${ReferralShare.REWARD_LINE}.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))

        ReferralShareBlock(link = view.link, code = view.code)

        Spacer(Modifier.height(12.dp))
        if (view.referrals.isEmpty()) {
            // Said rather than hidden: a card that disappears when there is
            // nothing to show is a card nobody learns exists.
            Text(
                t("settingsMore.noReferralsYet"),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            for (row in view.referrals) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        ReferralShare.stageLabel(row.stage),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        row.created_at.take(10),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(4.dp))
            }
        }

        if (view.rewarded_this_year > 0) {
            Spacer(Modifier.height(8.dp))
            // Two whole sentences rather than a stem plus "month"/"months":
            // French agrees its adjective as well as its noun, so the singular
            // and the plural differ by more than one letter at the end.
            Text(
                if (view.rewarded_this_year == 1) {
                    t("settingsMore.freeMonthEarned")
                } else {
                    t(
                        "settingsMore.freeMonthsEarned",
                        "count" to "${view.rewarded_this_year}",
                    )
                },
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}
