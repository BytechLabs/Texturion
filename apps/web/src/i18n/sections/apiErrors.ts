import { ERROR_CODES, INTERNAL_ERROR_CODE, type ErrorCode } from "@loonext/shared";

import type { Translated } from "../translated";

/**
 * #228 — what a refusal from the server says to somebody who does not read
 * English.
 *
 * ## The gap this closes
 *
 * The API composes one English sentence per call site — 370 of them — and all
 * three clients render it exactly as it arrived. That is the right default and
 * it stays: the server's sentence is specific in a way no generic one can be
 * ("No such API key", "This company already has a subscription"), and an
 * English-reading crew keeps every word of it.
 *
 * It is the wrong default for the reader this issue exists for. A member whose
 * app is in French, on a workspace we sell to Quebec on purpose, meets an
 * English sentence at the exact moment something has gone wrong — the moment
 * with the least patience for it in the whole product.
 *
 * ## Why generic French beats specific English here
 *
 * The obvious objection is that these sentences lose information, and they do.
 * "That can't be done as things stand" is genuinely less useful than "This
 * company already has a subscription."
 *
 * But the comparison that matters is not against the English sentence as READ.
 * It is against the English sentence as MET by somebody who does not read
 * English, which carries no information at all — only the knowledge that
 * something failed, plus the friction of being addressed in the wrong language
 * by software their own province requires to speak theirs. A correct generic
 * sentence in the reader's language is strictly more than that.
 *
 * So the rule is asymmetric on purpose, and only ever REPLACES a sentence the
 * reader could not use:
 *
 * - reading in English → the server's specific sentence, exactly as today;
 * - reading in another language → the code's sentence, in that language.
 *
 * ## What this is not
 *
 * Not the end state. Specificity should come back for the codes where the
 * message carries the whole content — `conflict` (109 sites) and
 * `validation_failed` (48) especially, where the sentence is usually an
 * instruction rather than a description. That needs the server to emit an
 * optional message KEY beside its text so each call site can opt in without
 * flattening; this catalogue is the floor underneath that work, not a
 * substitute for it. `not_found` (139 sites) mostly does not need it — "No such
 * attachment" and "Introuvable" carry about the same amount.
 *
 * ## Completeness
 *
 * The type is `Record<ErrorCode | "internal_error", string>`, so adding a code
 * to `packages/shared` and forgetting it here fails `tsc` in this file rather
 * than showing a French reader the code's own name. The phones cannot import
 * this, so `api-error-vocabulary-parity.test.ts` holds them to the same key set
 * in both directions.
 */
export type ApiErrorVocabulary = Record<ErrorCode | typeof INTERNAL_ERROR_CODE, string> & {
  /**
   * A 5xx, with the server's own reference for it (#555).
   *
   * A whole template rather than a suffix, because French does not have to put
   * it where English does. The phones already said this sentence in English;
   * web did not say it at all, and dropped a reference support asks for.
   */
  withReference: string;
};

/** Every code, so a new one is a type error here rather than a gap in French. */
export const API_ERROR_VOCABULARY_CODES = [...ERROR_CODES, INTERNAL_ERROR_CODE] as const;

export const apiErrorsEn: ApiErrorVocabulary = {
  unauthorized: "You're signed out. Sign in again to carry on.",
  forbidden: "You don't have access to that.",
  subscription_inactive: "Your subscription isn't active.",
  // #303 — a person, not a button. The English at the call sites is careful not
  // to accuse anybody, and this has to be careful in the same way.
  sending_suspended:
    "Sending is paused on this workspace. Get in touch and we'll sort it out.",
  // #277 — nothing lapsed and nothing is at risk. Says the remedy, because the
  // remedy is one button.
  workspace_paused: "Your plan is paused. Resume it in billing to carry on.",
  usage_cap_reached: "You've reached a spending cap for this period.",
  registration_pending: "Your texting registration is still being reviewed.",
  recipient_opted_out: "This person asked us to stop texting them.",
  validation_failed: "Something in that wasn't right. Check the details and try again.",
  not_found: "We couldn't find that.",
  conflict: "That can't be done as things stand. Refresh and take another look.",
  quiet_hours_confirmation_required:
    "It's quiet hours where they are. Confirm to send anyway.",
  mfa_required: "Two-step verification is needed first.",
  mfa_challenge_required: "Confirm it's you to carry on.",
  confirmation_code_required: "Enter the confirmation code to carry on.",
  mfa_reprove_required: "Confirm it's you again to carry on.",
  rate_limited: "Too many tries. Wait a minute and try again.",
  service_unavailable: "That's busy right now. Try again in a moment.",
  internal_error: "Something went wrong on our end. Try again in a moment.",
  withReference: "{message} Reference {id}.",
};

export const apiErrorsFr: Translated<typeof apiErrorsEn> = {
  unauthorized: "Vous êtes déconnecté. Reconnectez-vous pour continuer.",
  forbidden: "Vous n'avez pas accès à cela.",
  subscription_inactive: "Votre abonnement n'est pas actif.",
  sending_suspended:
    "L'envoi est suspendu pour cet espace de travail. Écrivez-nous et nous réglerons cela.",
  workspace_paused:
    "Votre forfait est en pause. Reprenez-le dans la facturation pour continuer.",
  usage_cap_reached: "Vous avez atteint une limite de dépenses pour cette période.",
  registration_pending: "Votre inscription pour les textos est encore à l'étude.",
  recipient_opted_out: "Cette personne nous a demandé de ne plus lui écrire.",
  validation_failed:
    "Quelque chose ne va pas dans cette demande. Vérifiez les détails et réessayez.",
  not_found: "Nous n'avons pas trouvé cela.",
  conflict: "Impossible dans l'état actuel. Actualisez et regardez de nouveau.",
  quiet_hours_confirmation_required:
    "C'est une heure de tranquillité chez cette personne. Confirmez pour envoyer quand même.",
  mfa_required: "La vérification en deux étapes est requise d'abord.",
  mfa_challenge_required: "Confirmez votre identité pour continuer.",
  confirmation_code_required: "Entrez le code de confirmation pour continuer.",
  mfa_reprove_required: "Confirmez de nouveau votre identité pour continuer.",
  rate_limited: "Trop de tentatives. Attendez une minute et réessayez.",
  service_unavailable: "C'est occupé en ce moment. Réessayez dans un instant.",
  internal_error: "Une erreur s'est produite de notre côté. Réessayez dans un instant.",
  withReference: "{message} Référence {id}.",
};
