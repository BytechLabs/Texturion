import Foundation

/// #228 — text-to-pay (#224), the first iOS surface in the catalogue.
///
/// Kept as the WORKED EXAMPLE for the extraction: a plain key, an interpolated
/// one (`{amount}`), and a sentence long enough to wrap, in both languages. Its
/// English is character-for-character the web and Android catalogues', which is
/// the point — a crew that switches devices should not meet a different product.
enum PaymentsStrings {
    static let section = AppStrings.Section(
        name: "PaymentsStrings",
        en: [
            "payments.settingsTitle": "Getting paid",
            "payments.askAction": "Ask for payment",
            "payments.amountLabel": "Amount",
            "payments.descriptionLabel": "What for",
            "payments.theyWillReceive": "They will receive:",
            "payments.askFor": "Ask for {amount}",
            "payments.asked": "Asked for {amount}.",
            "payments.sendFailed": "That didn't send.",
            "payments.stripeNeeds": "Stripe still needs:",
            "payments.refundedBack": "{amount} went back to them.",
            "payments.disputedNote":
                "Their bank has pulled this back. Stripe has emailed you what it needs.",
            "payments.cancelLabel": "Cancel the {amount} request for {description}",
        ],
        frCA: [
            "payments.settingsTitle": "Encaisser les paiements",
            "payments.askAction": "Demander un paiement",
            "payments.amountLabel": "Montant",
            "payments.descriptionLabel": "Pour quoi",
            "payments.theyWillReceive": "Le client recevra :",
            "payments.askFor": "Demander {amount}",
            "payments.asked": "Demande de {amount} envoyée.",
            "payments.sendFailed": "L'envoi a échoué.",
            "payments.stripeNeeds": "Stripe a encore besoin de :",
            "payments.refundedBack": "{amount} leur a été remboursé.",
            "payments.disputedNote":
                "Leur banque a repris ce paiement. Stripe vous a écrit pour la suite.",
            "payments.cancelLabel": "Annuler la demande de {amount} pour {description}",
        ]
    )
}
