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
import com.loonext.android.core.model.isCarrierEnforcedOptOut
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

    /**
     * #423: the carrier suspended a registration that WAS approved.
     *
     * Its own case for the same reason UsTextingOff is: the
     * RegistrationPending copy promises approval is coming, and for a
     * suspended workspace that is false — they were approved, nothing is under
     * review, and waiting achieves nothing.
     */
    data object RegistrationSuspended : ComposerBanner
    data object UsageCap : ComposerBanner

    /**
     * #396: an inbound message on this thread READ as a plain-English opt-out.
     *
     * The only banner here that does not describe a block — every other one
     * says why a message cannot go. This one says a message SHOULD not, and
     * leaves the decision with the person: an opt-out cannot be lifted by us
     * (#331), so acting on a guess would silence a real lead for good.
     */
    data object OptOutHint : ComposerBanner

    /**
     * #363: this member may read the thread and write internal notes, but may
     * not text the customer on this number (number_access.level = 'note').
     *
     * The one send-blocking condition that had no banner. Every other blocked
     * send says why on screen; this one just quietly had no text composer,
     * which reads as the product being broken rather than as a permission —
     * and the worse version is a tech who believes they replied and did not.
     */
    data object NumberAccess : ComposerBanner
}

fun selectComposerBanner(
    contactOptedOut: Boolean,
    contactOptOutSource: String?,
    subscriptionStatus: String,
    destinationCountry: String?,
    usApproved: Boolean,
    usTextingOff: Boolean,
    usage: Usage?,
    optOutHint: Boolean = false,
    usSuspended: Boolean = false,
    /** #106/#363: this caller's level on THIS conversation's number. */
    viewerLevel: String = "text",
): ComposerBanner? {
    // #363 FIRST, and the reason is worth stating: every other banner
    // describes a fact about the CONVERSATION or the workspace, and this one
    // describes a fact about the READER. A note-only member told "your
    // subscription is past due" learns something true, irrelevant and
    // unfixable by them — they could not text on this number either way, and
    // they cannot pay the bill. "Ask an owner" is the only line they can act
    // on, and it stays true in every other conversation on this number.
    if (viewerLevel == "note") return ComposerBanner.NumberAccess
    if (contactOptedOut) {
        return ComposerBanner.OptedOut(isCarrierEnforcedOptOut(contactOptOutSource))
    }
    if (subscriptionStatus != SubscriptionStatus.ACTIVE) {
        return ComposerBanner.Subscription(subscriptionStatus)
    }
    if (destinationCountry == "US" && !usApproved) {
        // Most-specific-to-this-reader first: a workspace that never turned US
        // texting on has no live registration to discuss; then the #423
        // suspension, which is a state they WERE out of; then the ordinary
        // pre-approval wait.
        return when {
            usTextingOff -> ComposerBanner.UsTextingOff
            usSuspended -> ComposerBanner.RegistrationSuspended
            else -> ComposerBanner.RegistrationPending
        }
    }
    val cap = usage?.cap_segments
    if (usage != null && cap != null && usage.used_segments >= cap) {
        return ComposerBanner.UsageCap
    }
    // #396 LAST, deliberately: every banner above says a message CANNOT go, and
    // where nothing can be sent no obligation can be breached. This one matters
    // exactly when the composer is otherwise open — the moment somebody is
    // about to reply to a person who asked them not to.
    if (optOutHint) return ComposerBanner.OptOutHint
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
 * #423: the carrier suspended a registration that had been approved. Read off
 * the same campaign row [usSendApproved] reads, so the two can never disagree
 * about which state the workspace is in.
 */
fun usSuspended(company: CompanyView): Boolean =
    company.registration.campaign?.status == "suspended"

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

    // #363: what is true, and what to do. No call offer either — whether a
    // note-only member may call is a separate access question, and a banner
    // that pointed at a second thing they also cannot do would be a second
    // dead end. `offersCallInstead` is an allow-list, so this gets it right by
    // not being on the list.
    ComposerBanner.NumberAccess ->
        "You can't text from this number" to
            "You can read this conversation and add internal notes, but texting this customer needs access an owner or admin grants. Ask them if you need it."

    is ComposerBanner.Subscription ->
        "Texting is paused" to
            "Your subscription isn't active, so outbound texts are blocked. An owner can fix this in billing. Internal notes still work."

    ComposerBanner.RegistrationPending ->
        "US texting isn't approved yet" to
            "Carriers are still reviewing your registration. Texts to US numbers will send once it's approved. Internal notes still work."

    ComposerBanner.UsTextingOff ->
        "US texting isn't on for this workspace" to
            "This is a US number, and texting US numbers is an add-on your workspace hasn't turned on. An owner can add it in settings. Calls to this customer still work, and internal notes still work."

    // #423. Deliberately NOT the pending copy: promising approval to a
    // workspace that WAS approved is a wait that never ends, and it sends them
    // hunting for a form to fill in. Say what happened, who is acting on it,
    // and what still works — the same three things the email says, so the two
    // never contradict each other.
    ComposerBanner.RegistrationSuspended ->
        "US texting is paused" to
            "The carrier paused your US registration, so texts to US numbers won't send. We've been told and we're on it, and you'll get an email when it's back. Canadian texts, calls and internal notes all still work."

    ComposerBanner.UsageCap ->
        "You've hit this month's cap" to
            "Outbound texts pause until the cap is raised or the month rolls over. Internal notes still work."

    // #396: says what was seen and who decides. It does NOT opt anyone out —
    // only the customer can, and only they can lift it, so a wrong guess would
    // silence a real lead for good.
    ComposerBanner.OptOutHint ->
        "They asked not to be contacted" to
            "Someone on this thread asked to be left alone. That request is binding however it's worded, so don't reply unless you're sure it wasn't one. To stop texts for good, they need to text STOP."
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
    banner is ComposerBanner.RegistrationPending ||
        banner is ComposerBanner.UsTextingOff ||
        // #423: registration gates TEXTING only, so the call still connects —
        // and during a suspension it is the only thing the reader can do now.
        banner is ComposerBanner.RegistrationSuspended

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
