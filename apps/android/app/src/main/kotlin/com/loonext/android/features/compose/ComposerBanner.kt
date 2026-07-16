package com.loonext.android.features.compose

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.model.Usage

/**
 * Banner states that REPLACE the text composer — a pure precedence selector
 * (port of apps/web thread/composer-banner.ts) so the rule is unit-testable.
 * Order, most permanent first:
 *
 *   1. OptedOut            — per-contact, never unblocked by paying
 *   2. Subscription        — past_due / canceled blocks every send
 *   3. RegistrationPending — US destination before campaign approval
 *   4. UsageCap            — recoverable by the owner
 *
 * null = composer enabled. The API enforces each gate independently; this
 * selector only decides what the user sees. Notes stay available under every
 * banner.
 */
sealed interface ComposerBanner {
    data object OptedOut : ComposerBanner
    data class Subscription(val status: String) : ComposerBanner
    data object RegistrationPending : ComposerBanner
    data object UsageCap : ComposerBanner
}

fun selectComposerBanner(
    contactOptedOut: Boolean,
    subscriptionStatus: String,
    destinationCountry: String?,
    usApproved: Boolean,
    usage: Usage?,
): ComposerBanner? {
    if (contactOptedOut) return ComposerBanner.OptedOut
    if (subscriptionStatus != SubscriptionStatus.ACTIVE) {
        return ComposerBanner.Subscription(subscriptionStatus)
    }
    if (destinationCountry == "US" && !usApproved) return ComposerBanner.RegistrationPending
    val cap = usage?.cap_segments
    if (usage != null && cap != null && usage.used_segments >= cap) {
        return ComposerBanner.UsageCap
    }
    return null
}

/**
 * The US-send gate exactly as the API computes it: campaign approved, not
 * deactivated, and the company does US texting at all.
 */
fun usSendApproved(company: CompanyView): Boolean {
    val campaign = company.registration.campaign
    return (company.country == "US" || company.us_texting_enabled) &&
        campaign != null &&
        campaign.status == "approved" &&
        campaign.deactivated_at == null
}

/** Honest, calm one-liner copy per banner (Loonext voice — no hype). */
fun bannerCopy(banner: ComposerBanner): Pair<String, String> = when (banner) {
    ComposerBanner.OptedOut ->
        "This customer opted out" to
            "They texted STOP or were opted out manually. You can't text them unless they opt back in. Internal notes still work."

    is ComposerBanner.Subscription ->
        "Texting is paused" to
            "Your subscription isn't active, so outbound texts are blocked. An owner can fix this in billing. Internal notes still work."

    ComposerBanner.RegistrationPending ->
        "US texting isn't approved yet" to
            "Carriers are still reviewing your registration. Texts to US numbers will send once it's approved. Internal notes still work."

    ComposerBanner.UsageCap ->
        "You've hit this month's cap" to
            "Outbound texts pause until the cap is raised or the month rolls over. Internal notes still work."
}

/** The card that stands in for the text composer (notes remain below it). */
@Composable
fun ComposerBannerCard(banner: ComposerBanner, modifier: Modifier = Modifier) {
    val (title, body) = bannerCopy(banner)
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .border(
                1.dp,
                MaterialTheme.colorScheme.outlineVariant,
                RoundedCornerShape(12.dp),
            )
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        Text(
            body,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}
