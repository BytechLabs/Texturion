import Foundation

/// #228 — what a refusal from the server says to somebody who does not read
/// English.
///
/// Hand-port of `apps/web/src/i18n/sections/apiErrors.ts`, and the reasoning
/// lives there in full. The short version, because it is the part somebody
/// would reasonably undo:
///
/// The API composes one English sentence per call site — 370 of them — and all
/// three clients render it exactly as it arrived. That stays for an English
/// reader: "No such API key" is specific in a way no per-code sentence can be.
///
/// It is the wrong default for the reader this issue exists for. The comparison
/// is not against that sentence as READ but as MET by somebody who does not
/// read English, which carries nothing but the fact that something failed. A
/// correct generic sentence in their own language is less specific and strictly
/// more informative — so this only ever replaces a sentence the reader could
/// not use.
///
/// The key set is held equal to web's and Android's, in both directions, by
/// `packages/shared/src/api-error-vocabulary-parity.test.ts`. A code added to
/// `packages/shared/src/error-codes.ts` and missed here would resolve to its
/// own name on screen, which is worse than the English it replaced.
enum ApiErrorStrings {
    static let section = AppStrings.Section(
        name: "ApiErrorStrings",
        en: [
            "apiErrors.unauthorized": "You're signed out. Sign in again to carry on.",
            "apiErrors.forbidden": "You don't have access to that.",
            "apiErrors.subscription_inactive": "Your subscription isn't active.",
            // #303 — a person, not a button. The English at the call sites is
            // careful not to accuse anybody, and this is careful the same way.
            "apiErrors.sending_suspended":
                "Sending is paused on this workspace. Get in touch and we'll sort it out.",
            // #277 — nothing lapsed and nothing is at risk. Says the remedy,
            // because the remedy is one button.
            "apiErrors.workspace_paused":
                "Your plan is paused. Resume it in billing to carry on.",
            "apiErrors.usage_cap_reached": "You've reached a spending cap for this period.",
            "apiErrors.registration_pending":
                "Your texting registration is still being reviewed.",
            "apiErrors.recipient_opted_out": "This person asked us to stop texting them.",
            "apiErrors.validation_failed":
                "Something in that wasn't right. Check the details and try again.",
            "apiErrors.not_found": "We couldn't find that.",
            "apiErrors.conflict":
                "That can't be done as things stand. Refresh and take another look.",
            "apiErrors.quiet_hours_confirmation_required":
                "It's quiet hours where they are. Confirm to send anyway.",
            "apiErrors.mfa_required": "Two-step verification is needed first.",
            "apiErrors.mfa_challenge_required": "Confirm it's you to carry on.",
            "apiErrors.confirmation_code_required":
                "Enter the confirmation code to carry on.",
            "apiErrors.mfa_reprove_required": "Confirm it's you again to carry on.",
            "apiErrors.rate_limited": "Too many tries. Wait a minute and try again.",
            "apiErrors.service_unavailable": "That's busy right now. Try again in a moment.",
            "apiErrors.internal_error":
                "Something went wrong on our end. Try again in a moment.",
            // #555 — a whole template rather than a suffix, because French does
            // not have to put the reference where English does.
            "apiErrors.withReference": "{message} Reference {id}.",
        ],
        frCA: [
            "apiErrors.unauthorized":
                "Vous êtes déconnecté. Reconnectez-vous pour continuer.",
            "apiErrors.forbidden": "Vous n'avez pas accès à cela.",
            "apiErrors.subscription_inactive": "Votre abonnement n'est pas actif.",
            "apiErrors.sending_suspended":
                "L'envoi est suspendu pour cet espace de travail. Écrivez-nous et nous réglerons cela.",
            "apiErrors.workspace_paused":
                "Votre forfait est en pause. Reprenez-le dans la facturation pour continuer.",
            "apiErrors.usage_cap_reached":
                "Vous avez atteint une limite de dépenses pour cette période.",
            "apiErrors.registration_pending":
                "Votre inscription pour les textos est encore à l'étude.",
            "apiErrors.recipient_opted_out":
                "Cette personne nous a demandé de ne plus lui écrire.",
            "apiErrors.validation_failed":
                "Quelque chose ne va pas dans cette demande. Vérifiez les détails et réessayez.",
            "apiErrors.not_found": "Nous n'avons pas trouvé cela.",
            "apiErrors.conflict":
                "Impossible dans l'état actuel. Actualisez et regardez de nouveau.",
            "apiErrors.quiet_hours_confirmation_required":
                "C'est une heure de tranquillité chez cette personne. Confirmez pour envoyer quand même.",
            "apiErrors.mfa_required": "La vérification en deux étapes est requise d'abord.",
            "apiErrors.mfa_challenge_required": "Confirmez votre identité pour continuer.",
            "apiErrors.confirmation_code_required":
                "Entrez le code de confirmation pour continuer.",
            "apiErrors.mfa_reprove_required":
                "Confirmez de nouveau votre identité pour continuer.",
            "apiErrors.rate_limited": "Trop de tentatives. Attendez une minute et réessayez.",
            "apiErrors.service_unavailable":
                "C'est occupé en ce moment. Réessayez dans un instant.",
            "apiErrors.internal_error":
                "Une erreur s'est produite de notre côté. Réessayez dans un instant.",
            "apiErrors.withReference": "{message} Référence {id}.",
        ]
    )
}
