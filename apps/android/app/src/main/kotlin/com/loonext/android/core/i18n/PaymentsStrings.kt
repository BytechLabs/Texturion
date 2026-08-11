package com.loonext.android.core.i18n

/**
 * #228 — text-to-pay (#224), the first Android surface in the catalogue.
 *
 * Kept as the WORKED EXAMPLE for the extraction: it shows a plain key, an
 * interpolated one (`{amount}`), and a sentence long enough to wrap, in both
 * languages. Its English is character-for-character the web catalogue's, which
 * is the point — a crew that switches devices should not meet a different
 * product.
 */
object PaymentsStrings : AppStrings.Section {
    override val en = mapOf(
        "payments.settingsTitle" to "Getting paid",
        "payments.askAction" to "Ask for payment",
        "payments.amountLabel" to "Amount",
        "payments.descriptionLabel" to "What for",
        "payments.theyWillReceive" to "They will receive:",
        "payments.askFor" to "Ask for {amount}",
        "payments.asked" to "Asked for {amount}.",
        "payments.sendFailed" to "That didn't send.",
        "payments.stripeNeeds" to "Stripe still needs:",
        "payments.refundedBack" to "{amount} went back to them.",
        "payments.disputedNote" to
            "Their bank has pulled this back. Stripe has emailed you what it needs.",
        "payments.cancelAria" to "Cancel the {amount} request for {description}",
    )

    override val frCA = mapOf(
        "payments.settingsTitle" to "Encaisser les paiements",
        "payments.askAction" to "Demander un paiement",
        "payments.amountLabel" to "Montant",
        "payments.descriptionLabel" to "Pour quoi",
        "payments.theyWillReceive" to "Le client recevra :",
        "payments.askFor" to "Demander {amount}",
        "payments.asked" to "Demande de {amount} envoyée.",
        "payments.sendFailed" to "L'envoi a échoué.",
        "payments.stripeNeeds" to "Stripe a encore besoin de :",
        "payments.refundedBack" to "{amount} leur a été remboursé.",
        "payments.disputedNote" to
            "Leur banque a repris ce paiement. Stripe vous a écrit pour la suite.",
        "payments.cancelAria" to "Annuler la demande de {amount} pour {description}",
    )
}
