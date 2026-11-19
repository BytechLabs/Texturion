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
            "apiRefusals.areaCodeCountryMismatch":
                "requested_area_code must be a {country} area code (the company's country).",
            "apiRefusals.areaCodeNotAssigned":
                "requested_area_code is not an assigned US/CA geographic area code.",
            "apiRefusals.billingAlreadySubscribed":
                "This company already has a subscription.",
            "apiRefusals.carrierOptOutNeedsStart":
                "This customer texted STOP, so their carrier is blocking your texts. Only they can undo it, by texting START to your number.",
            "apiRefusals.contactNotFound": "No such contact.",
            "apiRefusals.contactNumberNotFound":
                "No such contact number.",
            "apiRefusals.contactUnmergeMainNumberInUse":
                "Choose a different main number before undoing this merge.",
            "apiRefusals.conversationNotFound": "No such conversation.",
            "apiRefusals.idempotencyKeyLength": "Idempotency-Key must contain 1 to 255 characters.",
            "apiRefusals.inviteAlreadyPending":
                "A pending invite for this email already exists.",
            "apiRefusals.numberCountryMismatch":
                "chosen_number_e164 must be a {country} number (the company's country).",
            "apiRefusals.numberNotAssigned":
                "chosen_number_e164 is not an assigned US/CA geographic number.",
            "apiRefusals.optOutNotActive": "This number is not opted out.",
            "apiRefusals.outboundSendPaused":
                "Texting is paused while we deal with an issue. Nothing you sent was lost.",
            "apiRefusals.paymentsNotSetUp":
                "This workspace has not set up payments yet.",
            "apiRefusals.portAlreadyPending":
                "A transfer for this number is already in progress.",
            "apiRefusals.remindersNeedCustomer": "Link a customer conversation to turn on reminders.",
            "apiRefusals.remindersWorkspaceNotFound": "No such workspace.",
            "apiRefusals.scheduledTextKeyUsed":
                "Idempotency-Key was already used for a different scheduled text.",
            "apiRefusals.taskCreateKeyUsed": "Idempotency-Key was already used for a task.",
            "apiRefusals.textEnablementAlreadyPending":
                "This number already has a text-enablement in progress.",
            "apiRefusals.textEnablementNumberInUse":
                "This number is already in service on Loonext and can't be text-enabled.",
            "apiRefusals.textEnablementWrongCode":
                "That code didn't match. Request a new code and try again.",
            "apiRefusals.contactImportInvalidCustomFields":
                "Custom fields must be a JSON object of text values.",
            "apiRefusals.contactImportTooManyOtherNumbers":
                "Row {row} exceeds {limit} other phone numbers.",
            "apiRefusals.exportFileNotFound":
                "No such export file.",
            "apiRefusals.exportFileSizeUnavailable":
                "This file's size could not be read. Try again later.",
            "apiRefusals.noActiveSendingNumber":
                "There is no active number available to send from.",
            "apiRefusals.workspaceExportNotReady":
                "No ready workspace export with that ID.",
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
            "apiErrors.unsupported_service_code": "Use your phone to dial this service code.",
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
            "apiErrors.contactImportUndeclaredColumnsOne":
                "File column {columns} was not declared. This import never guesses what a column means because treating a do-not-text column as empty could message somebody who opted out. Every file column ({total} total) must be mapped or explicitly ignored. Send one `{field}` value per column as `<index>:<field or {ignore}>:<header>`. Nothing was imported.",
            "apiErrors.contactImportUndeclaredColumnsMany":
                "File columns {columns} were not declared. This import never guesses what a column means because treating a do-not-text column as empty could message somebody who opted out. Every file column ({total} total) must be mapped or explicitly ignored. Send one `{field}` value per column as `<index>:<field or {ignore}>:<header>`. Nothing was imported.",
            "apiErrors.contactImportUndeclaredPropertiesOne":
                "{properties} is a vCard property this import does not read. CATEGORIES, NOTE, and property parameters can carry do-not-text instructions. Send one `{field}` value for it as `<PROPERTY>:<{ignore} or opted_out>`. Nothing was imported.",
            "apiErrors.contactImportUndeclaredPropertiesMany":
                "{properties} are vCard properties this import does not read. CATEGORIES, NOTE, and property parameters can carry do-not-text instructions. Send one `{field}` value per property as `<PROPERTY>:<{ignore} or opted_out>`. Nothing was imported.",
            "apiErrors.contactImportUndeclaredPropertiesCapped":
                "{properties}, and {more} more, are vCard properties this import does not read. CATEGORIES, NOTE, and property parameters can carry do-not-text instructions. Send one `{field}` value per property as `<PROPERTY>:<{ignore} or opted_out>`. Nothing was imported.",
            "apiErrors.contactImportUnreadableFlag":
                "The do-not-text column “{header}” contains values this import cannot read as yes or no: {values}. Use true/false (yes/no, 1/0, or x on rows to block), then import again. Nothing was imported.",
            "apiErrors.contactImportUnreadableFlagCapped":
                "The do-not-text column “{header}” contains values this import cannot read as yes or no: {values}, and {more} more. Use true/false (yes/no, 1/0, or x on rows to block), then import again. Nothing was imported.",
            "apiErrors.selfDowngradeAcknowledgementRequired":
                "Confirm that you understand what you'll lose before changing your own role.",
            // #555 — a whole template rather than a suffix, because French does
            // not have to put the reference where English does.
            "apiErrors.withReference": "{message} Reference {id}.",
        ],
        frCA: [
            "apiRefusals.areaCodeCountryMismatch":
                "Choisissez un indicatif régional du pays où votre espace de travail est enregistré ({country}).",
            "apiRefusals.areaCodeNotAssigned":
                "Choisissez un indicatif régional géographique attribué au Canada ou aux États-Unis.",
            "apiRefusals.billingAlreadySubscribed":
                "Cet espace de travail a déjà un abonnement.",
            "apiRefusals.carrierOptOutNeedsStart":
                "Ce client a texté STOP. Son fournisseur bloque vos textos. Seul le client peut lever ce blocage en textant START à votre numéro.",
            "apiRefusals.contactNotFound": "Ce contact est introuvable.",
            "apiRefusals.contactNumberNotFound":
                "Ce numéro ne figure pas dans cette fiche de contact.",
            "apiRefusals.contactUnmergeMainNumberInUse":
                "Choisissez un autre numéro principal avant d’annuler la fusion.",
            "apiRefusals.conversationNotFound": "Cette conversation est introuvable.",
            "apiRefusals.idempotencyKeyLength": "L’en-tête Idempotency-Key doit contenir de 1 à 255 caractères.",
            "apiRefusals.inviteAlreadyPending":
                "Une invitation à cette adresse courriel est déjà en attente.",
            "apiRefusals.numberCountryMismatch":
                "Choisissez un numéro du pays où votre espace de travail est enregistré ({country}).",
            "apiRefusals.numberNotAssigned":
                "Choisissez un numéro géographique attribué au Canada ou aux États-Unis.",
            "apiRefusals.optOutNotActive": "Ce numéro ne figure pas dans la liste de désabonnement.",
            "apiRefusals.outboundSendPaused":
                "L’envoi de textos est suspendu pendant que nous réglons un problème. Vos textos ont été conservés.",
            "apiRefusals.paymentsNotSetUp":
                "Les paiements ne sont pas encore configurés dans cet espace de travail.",
            "apiRefusals.portAlreadyPending":
                "Un transfert est déjà en cours pour ce numéro.",
            "apiRefusals.remindersNeedCustomer": "Associez une conversation avec un client pour activer les rappels.",
            "apiRefusals.remindersWorkspaceNotFound": "Cet espace de travail est introuvable.",
            "apiRefusals.scheduledTextKeyUsed":
                "Cet en-tête Idempotency-Key a déjà servi à programmer un autre texto.",
            "apiRefusals.taskCreateKeyUsed": "Cet en-tête Idempotency-Key a déjà servi à créer une tâche.",
            "apiRefusals.textEnablementAlreadyPending":
                "L’activation des textos est déjà en cours pour ce numéro.",
            "apiRefusals.textEnablementNumberInUse":
                "Ce numéro est déjà en service sur Loonext. Vous ne pouvez pas y activer les textos de cette façon.",
            "apiRefusals.textEnablementWrongCode":
                "Ce code ne correspond pas. Demandez un nouveau code, puis réessayez.",
            "apiRefusals.contactImportInvalidCustomFields":
                "Les champs personnalisés doivent être dans un objet JSON contenant des valeurs textuelles.",
            "apiRefusals.contactImportTooManyOtherNumbers":
                "La ligne {row} contient plus de {limit} autres numéros de téléphone.",
            "apiRefusals.exportFileNotFound":
                "Ce fichier d’exportation est introuvable.",
            "apiRefusals.exportFileSizeUnavailable":
                "Impossible de lire la taille de ce fichier. Réessayez plus tard.",
            "apiRefusals.noActiveSendingNumber":
                "Il n’y a aucun numéro actif pour envoyer ce texto.",
            "apiRefusals.workspaceExportNotReady":
                "Aucune exportation prête ne correspond à cet identifiant.",
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
            "apiErrors.unsupported_service_code": "Composez ce numéro sur votre téléphone.",
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
            "apiErrors.contactImportUndeclaredColumnsOne":
                "La colonne {columns} du fichier n’a pas été déclarée. Cette importation ne devine jamais le sens d’une colonne, car traiter une colonne d’interdiction de textos comme vide pourrait envoyer un message à une personne désabonnée. Chaque colonne du fichier ({total} au total) doit être associée à un champ ou explicitement ignorée. Envoyez une valeur `{field}` par colonne au format `<index>:<field ou {ignore}>:<header>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUndeclaredColumnsMany":
                "Les colonnes {columns} du fichier n’ont pas été déclarées. Cette importation ne devine jamais le sens d’une colonne, car traiter une colonne d’interdiction de textos comme vide pourrait envoyer un message à une personne désabonnée. Chaque colonne du fichier ({total} au total) doit être associée à un champ ou explicitement ignorée. Envoyez une valeur `{field}` par colonne au format `<index>:<field ou {ignore}>:<header>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUndeclaredPropertiesOne":
                "{properties} est une propriété vCard que cette importation ne lit pas. CATEGORIES, NOTE et les paramètres de propriété peuvent contenir une consigne de ne pas envoyer de textos. Envoyez pour cette propriété une valeur `{field}` au format `<PROPERTY>:<{ignore} ou opted_out>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUndeclaredPropertiesMany":
                "{properties} sont des propriétés vCard que cette importation ne lit pas. CATEGORIES, NOTE et les paramètres de propriété peuvent contenir une consigne de ne pas envoyer de textos. Envoyez une valeur `{field}` par propriété au format `<PROPERTY>:<{ignore} ou opted_out>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUndeclaredPropertiesCapped":
                "{properties}, ainsi que {more} autres, sont des propriétés vCard que cette importation ne lit pas. CATEGORIES, NOTE et les paramètres de propriété peuvent contenir une consigne de ne pas envoyer de textos. Envoyez une valeur `{field}` par propriété au format `<PROPERTY>:<{ignore} ou opted_out>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUnreadableFlag":
                "La colonne d’interdiction de textos « {header} » contient des valeurs que cette importation ne peut pas interpréter comme oui ou non : {values}. Utilisez true/false (yes/no, 1/0 ou x sur les lignes à bloquer), puis recommencez l’importation. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUnreadableFlagCapped":
                "La colonne d’interdiction de textos « {header} » contient des valeurs que cette importation ne peut pas interpréter comme oui ou non : {values}, ainsi que {more} autres. Utilisez true/false (yes/no, 1/0 ou x sur les lignes à bloquer), puis recommencez l’importation. Aucune donnée n’a été importée.",
            "apiErrors.selfDowngradeAcknowledgementRequired":
                "Confirmez que vous comprenez ce que vous perdrez avant de modifier votre propre rôle.",
            "apiErrors.withReference": "{message} Référence {id}.",
        ]
    )
}
