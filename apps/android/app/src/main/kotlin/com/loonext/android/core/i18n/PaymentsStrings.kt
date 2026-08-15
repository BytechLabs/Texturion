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

        /*
         * ── When the amount is refused ────────────────────────────────────────
         *
         * The bound is interpolated rather than typed, in BOTH languages: a
         * Canadian workspace settles in CAD and a US one in USD, and a literal
         * "$1" in a sentence about what somebody may charge is the #522 defect
         * on the one sentence that must not carry it.
         *
         * `amountNotWhole` is unreachable from this client and is written anyway
         * — the API answers 422 with it, and a copy table with a hole in it is a
         * hole somebody fills with a paraphrase.
         */
        "payments.amountTooSmall" to "The smallest payment we can take is {amount}.",
        "payments.amountTooLarge" to
            "The largest payment we can take by text is {amount}.",
        "payments.amountNotWhole" to "Enter an amount in dollars and cents.",

        /*
         * ── Stripe's outstanding requirements, in plain words ─────────────────
         *
         * Stripe names these `individual.verification.document` and
         * `external_account`. Showing a plumber one of those is showing them a
         * stack trace, so each identifier this build knows has a sentence — and
         * an identifier it does not know still shows, tidied, rather than being
         * dropped: an outstanding requirement nobody can see is the state where
         * an owner concludes the product is broken.
         *
         * Stripe is a product name and is never translated.
         */
        "payments.payoutNotConnectedTitle" to "Not set up yet",
        "payments.payoutNotConnectedDetail" to "Connect a Stripe account and you can ask a customer for a deposit or a final payment straight from the thread. Money goes to your bank account — we never hold it, and we take nothing on top.",
        "payments.payoutIncompleteTitle" to "Nearly there",
        "payments.payoutIncompleteDetail" to "Stripe still needs a few details about your business before it can take a payment. Picking up where you left off takes a couple of minutes.",
        "payments.payoutPendingTitle" to "Stripe is checking your details",
        "payments.payoutPendingDetail" to "You have given Stripe everything it asked for. Verification is usually minutes, occasionally a day or two. We will switch payment requests on the moment it clears — nothing for you to do.",
        "payments.payoutRestrictedTitle" to "Payments are paused",
        "payments.payoutRestrictedDetail" to "Stripe has paused payments on your account and needs something from you before it can take another one. Your Stripe dashboard says what.",
        "payments.payoutReadyTitle" to "Ready to take payments",
        "payments.payoutReadyDetail" to "Ask for a deposit or a final payment from any thread. It arrives as an ordinary text with a link, and the money goes to your bank account.",
        "payments.payoutActionSetUp" to "Set up payments",
        "payments.payoutActionFinish" to "Finish setting up",
        "payments.payoutActionOpenStripe" to "Open Stripe",

        "payments.reqBankAccount" to "Your bank account details",
        "payments.reqWebsite" to "Your website or a description of what you do",
        "payments.reqWorkKind" to "What kind of work you do",
        "payments.reqOwnerId" to "Photo ID for the business owner",
        "payments.reqOwnerIdSecond" to "A second document for the business owner",
        "payments.reqOwnerSin" to "The owner's SIN or SSN",
        "payments.reqOwnerAddress" to "The owner's address",
        "payments.reqOwnerDob" to "The owner's date of birth",
        /**
         * THE REGISTRATION number, not the phone number.
         *
         * `company.tax_id` — the NEQ, the CRA business number, the EIN. Web's
         * `businessNumberLabel` reads identically in English and means the
         * TEXTING number, so its French ("numéro d'affaires") is the one piece
         * of web copy on this screen that must NOT be copied over.
         */
        "payments.reqBusinessNumber" to "Your business number",
        "payments.reqBusinessDocument" to "A document proving the business exists",
        "payments.reqTos" to "Accepting Stripe's terms",
        "payments.reqSignatoryId" to "Photo ID for whoever signs for the business",
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

        // ── When the amount is refused ────────────────────────────────────────
        "payments.amountTooSmall" to
            "Le plus petit paiement que nous pouvons prendre est de {amount}.",
        "payments.amountTooLarge" to
            "Le plus gros paiement que nous pouvons prendre par texto est de {amount}.",
        "payments.amountNotWhole" to "Entrez un montant en dollars et en cents.",

        // ── Stripe's outstanding requirements, in plain words ─────────────────
        "payments.payoutNotConnectedTitle" to "Pas encore configuré",
        "payments.payoutNotConnectedDetail" to "Connectez un compte Stripe et vous pourrez demander un acompte ou un paiement final directement depuis la conversation. L'argent va dans votre compte bancaire — nous ne le détenons jamais et nous ne prenons rien au passage.",
        "payments.payoutIncompleteTitle" to "Presque terminé",
        "payments.payoutIncompleteDetail" to "Stripe a encore besoin de quelques renseignements sur votre entreprise avant de pouvoir encaisser un paiement. Reprendre où vous en étiez prend quelques minutes.",
        "payments.payoutPendingTitle" to "Stripe vérifie vos renseignements",
        "payments.payoutPendingDetail" to "Vous avez donné à Stripe tout ce qu'il a demandé. La vérification prend habituellement quelques minutes, parfois un jour ou deux. Nous activerons les demandes de paiement dès que ce sera fait — rien à faire de votre côté.",
        "payments.payoutRestrictedTitle" to "Les paiements sont suspendus",
        "payments.payoutRestrictedDetail" to "Stripe a suspendu les paiements sur votre compte et a besoin de quelque chose de votre part avant d'en encaisser un autre. Votre tableau de bord Stripe précise quoi.",
        "payments.payoutReadyTitle" to "Prêt à encaisser des paiements",
        "payments.payoutReadyDetail" to "Demandez un acompte ou un paiement final depuis n'importe quelle conversation. Cela arrive comme un texto ordinaire avec un lien, et l'argent va dans votre compte bancaire.",
        "payments.payoutActionSetUp" to "Configurer les paiements",
        "payments.payoutActionFinish" to "Terminer la configuration",
        "payments.payoutActionOpenStripe" to "Ouvrir Stripe",

        "payments.reqBankAccount" to "Les coordonnées de votre compte bancaire",
        "payments.reqWebsite" to
            "Votre site web ou une description de ce que vous faites",
        "payments.reqWorkKind" to "Le type de travail que vous faites",
        "payments.reqOwnerId" to
            "Une pièce d'identité avec photo du propriétaire de l'entreprise",
        "payments.reqOwnerIdSecond" to
            "Un deuxième document pour le propriétaire de l'entreprise",
        // NAS is the Canadian number and SSN the American one; a workspace has
        // one or the other, and neither acronym is translated.
        "payments.reqOwnerSin" to "Le NAS ou le SSN du propriétaire",
        "payments.reqOwnerAddress" to "L'adresse du propriétaire",
        "payments.reqOwnerDob" to "La date de naissance du propriétaire",
        // "numéro d'entreprise", never "numéro d'affaires" — see the English.
        "payments.reqBusinessNumber" to "Votre numéro d'entreprise",
        "payments.reqBusinessDocument" to
            "Un document prouvant l'existence de l'entreprise",
        "payments.reqTos" to "L'acceptation des conditions de Stripe",
        "payments.reqSignatoryId" to
            "Une pièce d'identité avec photo de la personne qui signe pour l'entreprise",
    )
}
