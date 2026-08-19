package com.loonext.android.core.i18n

/**
 * #228 — what a refusal from the server says to somebody who does not read
 * English.
 *
 * Hand-port of `apps/web/src/i18n/sections/apiErrors.ts`, and the reasoning
 * lives there in full. The short version, because it is the part somebody would
 * reasonably undo:
 *
 * The API composes one English sentence per call site — 370 of them — and all
 * three clients render it exactly as it arrived. That stays for an English
 * reader: "No such API key" is specific in a way no per-code sentence can be.
 *
 * It is the wrong default for the reader this issue exists for. The comparison
 * is not against that sentence as READ but as MET by somebody who does not read
 * English, which carries nothing but the fact that something failed. A correct
 * generic sentence in their own language is less specific and strictly more
 * informative — so this only ever replaces a sentence the reader could not use.
 *
 * The key set is held equal to web's and iOS's, in both directions, by
 * `packages/shared/src/api-error-vocabulary-parity.test.ts`. A code added to
 * `packages/shared/src/error-codes.ts` and missed here would resolve to its own
 * name on screen, which is worse than the English it replaced.
 */
object ApiErrorStrings : AppStrings.Section {
    override val en = mapOf(
        "apiErrors.unauthorized" to "You're signed out. Sign in again to carry on.",
        "apiErrors.forbidden" to "You don't have access to that.",
        "apiErrors.subscription_inactive" to "Your subscription isn't active.",
        // #303 — a person, not a button. The English at the call sites is
        // careful not to accuse anybody, and this is careful in the same way.
        "apiErrors.sending_suspended" to
            "Sending is paused on this workspace. Get in touch and we'll sort it out.",
        // #277 — nothing lapsed and nothing is at risk. Says the remedy,
        // because the remedy is one button.
        "apiErrors.workspace_paused" to
            "Your plan is paused. Resume it in billing to carry on.",
        "apiErrors.usage_cap_reached" to "You've reached a spending cap for this period.",
        "apiErrors.registration_pending" to "Your texting registration is still being reviewed.",
        "apiErrors.recipient_opted_out" to "This person asked us to stop texting them.",
        "apiErrors.validation_failed" to
            "Something in that wasn't right. Check the details and try again.",
        "apiErrors.not_found" to "We couldn't find that.",
        "apiErrors.conflict" to
            "That can't be done as things stand. Refresh and take another look.",
        "apiErrors.quiet_hours_confirmation_required" to
            "It's quiet hours where they are. Confirm to send anyway.",
        "apiErrors.mfa_required" to "Two-step verification is needed first.",
        "apiErrors.mfa_challenge_required" to "Confirm it's you to carry on.",
        "apiErrors.confirmation_code_required" to "Enter the confirmation code to carry on.",
        "apiErrors.mfa_reprove_required" to "Confirm it's you again to carry on.",
        "apiErrors.rate_limited" to "Too many tries. Wait a minute and try again.",
        "apiErrors.service_unavailable" to "That's busy right now. Try again in a moment.",
        "apiErrors.internal_error" to
            "Something went wrong on our end. Try again in a moment.",
        // #555 — a whole template rather than a suffix, because French does not
        // have to put the reference where English does.
        "apiErrors.withReference" to "{message} Reference {id}.",
    )

    override val frCA = mapOf(
        "apiErrors.unauthorized" to "Vous êtes déconnecté. Reconnectez-vous pour continuer.",
        "apiErrors.forbidden" to "Vous n'avez pas accès à cela.",
        "apiErrors.subscription_inactive" to "Votre abonnement n'est pas actif.",
        "apiErrors.sending_suspended" to
            "L'envoi est suspendu pour cet espace de travail. Écrivez-nous et nous réglerons cela.",
        "apiErrors.workspace_paused" to
            "Votre forfait est en pause. Reprenez-le dans la facturation pour continuer.",
        "apiErrors.usage_cap_reached" to
            "Vous avez atteint une limite de dépenses pour cette période.",
        "apiErrors.registration_pending" to "Votre inscription pour les textos est encore à l'étude.",
        "apiErrors.recipient_opted_out" to "Cette personne nous a demandé de ne plus lui écrire.",
        "apiErrors.validation_failed" to
            "Quelque chose ne va pas dans cette demande. Vérifiez les détails et réessayez.",
        "apiErrors.not_found" to "Nous n'avons pas trouvé cela.",
        "apiErrors.conflict" to
            "Impossible dans l'état actuel. Actualisez et regardez de nouveau.",
        "apiErrors.quiet_hours_confirmation_required" to
            "C'est une heure de tranquillité chez cette personne. Confirmez pour envoyer quand même.",
        "apiErrors.mfa_required" to "La vérification en deux étapes est requise d'abord.",
        "apiErrors.mfa_challenge_required" to "Confirmez votre identité pour continuer.",
        "apiErrors.confirmation_code_required" to "Entrez le code de confirmation pour continuer.",
        "apiErrors.mfa_reprove_required" to "Confirmez de nouveau votre identité pour continuer.",
        "apiErrors.rate_limited" to "Trop de tentatives. Attendez une minute et réessayez.",
        "apiErrors.service_unavailable" to "C'est occupé en ce moment. Réessayez dans un instant.",
        "apiErrors.internal_error" to
            "Une erreur s'est produite de notre côté. Réessayez dans un instant.",
        "apiErrors.withReference" to "{message} Référence {id}.",
    )
}
