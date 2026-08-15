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

            /*
             * ── When the amount is refused ────────────────────────────────────
             *
             * The bound is interpolated rather than typed, in BOTH languages: a
             * Canadian workspace settles in CAD and a US one in USD, and a
             * literal "$1" in a sentence about what somebody may charge is the
             * #522 defect on the one sentence that must not carry it.
             *
             * `amountNotWhole` is unreachable from this client and is written
             * anyway — the API answers 422 with it, and a copy table with a hole
             * in it is a hole somebody fills with a paraphrase.
             */
            "payments.amountTooSmall": "The smallest payment we can take is {amount}.",
            "payments.amountTooLarge":
                "The largest payment we can take by text is {amount}.",
            "payments.amountNotWhole": "Enter an amount in dollars and cents.",

            /*
             * ── Stripe's outstanding requirements, in plain words ─────────────
             *
             * Stripe names these `individual.verification.document` and
             * `external_account`. Showing a plumber one of those is showing them
             * a stack trace, so each identifier this build knows has a sentence
             * — and an identifier it does not know still shows, tidied, rather
             * than being dropped: an outstanding requirement nobody can see is
             * the state where an owner concludes the product is broken.
             *
             * Stripe is a product name and is never translated.
             */
            "payments.payoutNotConnectedTitle": "Not set up yet",
            "payments.payoutNotConnectedDetail": "Connect a Stripe account and you can ask a customer for a deposit or a final payment straight from the thread. Money goes to your bank account — we never hold it, and we take nothing on top.",
            "payments.payoutIncompleteTitle": "Nearly there",
            "payments.payoutIncompleteDetail": "Stripe still needs a few details about your business before it can take a payment. Picking up where you left off takes a couple of minutes.",
            "payments.payoutPendingTitle": "Stripe is checking your details",
            "payments.payoutPendingDetail": "You have given Stripe everything it asked for. Verification is usually minutes, occasionally a day or two. We will switch payment requests on the moment it clears — nothing for you to do.",
            "payments.payoutRestrictedTitle": "Payments are paused",
            "payments.payoutRestrictedDetail": "Stripe has paused payments on your account and needs something from you before it can take another one. Your Stripe dashboard says what.",
            "payments.payoutReadyTitle": "Ready to take payments",
            "payments.payoutReadyDetail": "Ask for a deposit or a final payment from any thread. It arrives as an ordinary text with a link, and the money goes to your bank account.",
            "payments.payoutActionSetUp": "Set up payments",
            "payments.payoutActionFinish": "Finish setting up",
            "payments.payoutActionOpenStripe": "Open Stripe",

            "payments.reqBankAccount": "Your bank account details",
            "payments.reqWebsite": "Your website or a description of what you do",
            "payments.reqWorkKind": "What kind of work you do",
            "payments.reqOwnerId": "Photo ID for the business owner",
            "payments.reqOwnerIdSecond": "A second document for the business owner",
            "payments.reqOwnerSin": "The owner's SIN or SSN",
            "payments.reqOwnerAddress": "The owner's address",
            "payments.reqOwnerDob": "The owner's date of birth",
            /*
             * THE REGISTRATION number, not the phone number.
             *
             * `company.tax_id` — the NEQ, the CRA business number, the EIN.
             * Web's `businessNumberLabel` reads identically in English and means
             * the TEXTING number, so its French ("numéro d'affaires") is the one
             * piece of web copy on this screen that must NOT be copied over.
             */
            "payments.reqBusinessNumber": "Your business number",
            "payments.reqBusinessDocument": "A document proving the business exists",
            "payments.reqTos": "Accepting Stripe's terms",
            "payments.reqSignatoryId": "Photo ID for whoever signs for the business",

            /*
             * ── Where the REST of the two payment screens' words live ─────────
             *
             * `ContactsTasksStrings` carries them, under this same `payments.`
             * prefix — `payments.opening`, `payments.whereMoneyGoes`,
             * `payments.deposit`, `payments.goesOutAsText` and the rest. A
             * second copy here would be the duplicate
             * `AppStringsTests.testNoTwoSectionsClaimTheSameKey` exists to
             * catch, so `PaymentsSection.swift` and `ThreadPayments.swift` read
             * them from there and this section stays the worked example plus
             * the amount rules and Stripe's requirement list.
             */
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

            // ── When the amount is refused ────────────────────────────────────
            "payments.amountTooSmall":
                "Le plus petit paiement que nous pouvons prendre est de {amount}.",
            "payments.amountTooLarge":
                "Le plus gros paiement que nous pouvons prendre par texto est de "
                + "{amount}.",
            "payments.amountNotWhole": "Entrez un montant en dollars et en cents.",

            // ── Stripe's outstanding requirements, in plain words ─────────────
            "payments.payoutNotConnectedTitle": "Pas encore configuré",
            "payments.payoutNotConnectedDetail": "Connectez un compte Stripe et vous pourrez demander un acompte ou un paiement final directement depuis la conversation. L'argent va dans votre compte bancaire — nous ne le détenons jamais et nous ne prenons rien au passage.",
            "payments.payoutIncompleteTitle": "Presque terminé",
            "payments.payoutIncompleteDetail": "Stripe a encore besoin de quelques renseignements sur votre entreprise avant de pouvoir encaisser un paiement. Reprendre où vous en étiez prend quelques minutes.",
            "payments.payoutPendingTitle": "Stripe vérifie vos renseignements",
            "payments.payoutPendingDetail": "Vous avez donné à Stripe tout ce qu'il a demandé. La vérification prend habituellement quelques minutes, parfois un jour ou deux. Nous activerons les demandes de paiement dès que ce sera fait — rien à faire de votre côté.",
            "payments.payoutRestrictedTitle": "Les paiements sont suspendus",
            "payments.payoutRestrictedDetail": "Stripe a suspendu les paiements sur votre compte et a besoin de quelque chose de votre part avant d'en encaisser un autre. Votre tableau de bord Stripe précise quoi.",
            "payments.payoutReadyTitle": "Prêt à encaisser des paiements",
            "payments.payoutReadyDetail": "Demandez un acompte ou un paiement final depuis n'importe quelle conversation. Cela arrive comme un texto ordinaire avec un lien, et l'argent va dans votre compte bancaire.",
            "payments.payoutActionSetUp": "Configurer les paiements",
            "payments.payoutActionFinish": "Terminer la configuration",
            "payments.payoutActionOpenStripe": "Ouvrir Stripe",

            "payments.reqBankAccount": "Les coordonnées de votre compte bancaire",
            "payments.reqWebsite":
                "Votre site web ou une description de ce que vous faites",
            "payments.reqWorkKind": "Le type de travail que vous faites",
            "payments.reqOwnerId":
                "Une pièce d'identité avec photo du propriétaire de l'entreprise",
            "payments.reqOwnerIdSecond":
                "Un deuxième document pour le propriétaire de l'entreprise",
            // NAS is the Canadian number and SSN the American one; a workspace
            // has one or the other, and neither acronym is translated.
            "payments.reqOwnerSin": "Le NAS ou le SSN du propriétaire",
            "payments.reqOwnerAddress": "L'adresse du propriétaire",
            "payments.reqOwnerDob": "La date de naissance du propriétaire",
            // "numéro d'entreprise", never "numéro d'affaires" — see the English.
            "payments.reqBusinessNumber": "Votre numéro d'entreprise",
            "payments.reqBusinessDocument":
                "Un document prouvant l'existence de l'entreprise",
            "payments.reqTos": "L'acceptation des conditions de Stripe",
            "payments.reqSignatoryId":
                "Une pièce d'identité avec photo de la personne qui signe pour "
                + "l'entreprise",

        ]
    )
}
