package com.loonext.android.features.compose

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.OPT_OUT_SOURCE_STOP
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
    /**
     * [carrierBlocked] tells the two opt-outs apart, because only one of them
     * has anything the reader can do about it: a STOP the customer sent is a
     * carrier block only they can lift, while an opt-out someone recorded by
     * hand comes off in a tap on the contact.
     */
    data class OptedOut(val carrierBlocked: Boolean) : ComposerBanner
    data class Subscription(val status: String) : ComposerBanner
    data object RegistrationPending : ComposerBanner

    /**
     * A US destination in a workspace that does not do US texting at all: a
     * Canadian company that never added it. Split out of RegistrationPending
     * because no registration exists to approve, so the wait copy promised an
     * outcome that could not arrive however long the reader waited.
     */
    data object UsTextingOff : ComposerBanner
    data object UsageCap : ComposerBanner
}

fun selectComposerBanner(
    contactOptedOut: Boolean,
    contactOptOutSource: String?,
    subscriptionStatus: String,
    destinationCountry: String?,
    usApproved: Boolean,
    usTextingOff: Boolean,
    usage: Usage?,
): ComposerBanner? {
    if (contactOptedOut) {
        return ComposerBanner.OptedOut(contactOptOutSource == OPT_OUT_SOURCE_STOP)
    }
    if (subscriptionStatus != SubscriptionStatus.ACTIVE) {
        return ComposerBanner.Subscription(subscriptionStatus)
    }
    if (destinationCountry == "US" && !usApproved) {
        return if (usTextingOff) ComposerBanner.UsTextingOff else ComposerBanner.RegistrationPending
    }
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

/**
 * The workspace does not do US texting at all, so [usSendApproved] is false for
 * a reason no amount of waiting fixes. Only Canadian companies can be in this
 * state: US texting is inherent to a US company.
 */
fun usTextingOff(company: CompanyView): Boolean =
    company.country == "CA" && !company.us_texting_enabled

/** Honest, calm one-liner copy per banner (Loonext voice — no hype). */
fun bannerCopy(banner: ComposerBanner): Pair<String, String> = when (banner) {
    // Say what can actually be done about it, rather than covering both cases
    // at once and leaving the reader to guess which one they are in.
    is ComposerBanner.OptedOut ->
        if (banner.carrierBlocked) {
            "This customer opted out" to
                "They texted STOP, so their carrier is blocking your texts. Only they can undo it, by texting START to your number. Internal notes still work."
        } else {
            "This customer opted out" to
                "Someone marked them opted out. You can undo that on their contact. Internal notes still work."
        }

    is ComposerBanner.Subscription ->
        "Texting is paused" to
            "Your subscription isn't active, so outbound texts are blocked. An owner can fix this in billing. Internal notes still work."

    ComposerBanner.RegistrationPending ->
        "US texting isn't approved yet" to
            "Carriers are still reviewing your registration. Texts to US numbers will send once it's approved. Internal notes still work."

    ComposerBanner.UsTextingOff ->
        "US texting isn't on for this workspace" to
            "This is a US number, and texting US numbers is an add-on your workspace hasn't turned on. An owner can add it in settings. Calls to this customer still work, and internal notes still work."

    ComposerBanner.UsageCap ->
        "You've hit this month's cap" to
            "Outbound texts pause until the cap is raised or the month rolls over. Internal notes still work."
}

/**
 * Whether this banner should offer the call as a way forward.
 *
 * Carrier registration gates TEXTING only, so a call to the same customer
 * connects today, on every plan. An opted-out contact is deliberately excluded:
 * a STOP revokes consent for the business to reach out, not only to text, so
 * the phone must never be offered as a way around it.
 */
fun offersCallInstead(banner: ComposerBanner): Boolean =
    banner is ComposerBanner.RegistrationPending || banner is ComposerBanner.UsTextingOff

/** The card that stands in for the text composer (notes remain below it). */
@Composable
fun ComposerBannerCard(
    banner: ComposerBanner,
    modifier: Modifier = Modifier,
    /** Place a call to this customer. Null withholds the offer entirely. */
    onCallInstead: (() -> Unit)? = null,
) {
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
        if (onCallInstead != null && offersCallInstead(banner)) {
            Text(
                "Call them instead",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .clickable(onClick = onCallInstead),
            )
        }
    }
}
