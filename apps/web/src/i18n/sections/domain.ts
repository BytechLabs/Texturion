/**
 * #228 — the words the SHARED modules say, in both languages.
 *
 * Every other section in this directory belongs to a screen. This one belongs
 * to `packages/shared`, and it exists because that package turned out to be the
 * largest untranslated surface in the product: 325 English sentences that no
 * ledger was counting, rendered on all three clients.
 *
 * Both phones already translate them. `DomainStrings.kt` and
 * `DomainStrings.swift` hold 330 keys under `domain.`, hand-ported when each
 * shared module was ported, while the web kept calling the shared function and
 * rendering whatever English came back. So a French reader saw a French app
 * with English underneath it — "Not delivered" under a message bubble, in an
 * app whose every other word had been translated.
 *
 * KEYS MATCH THE PHONES EXACTLY, and `send-failures.parity.test.ts` fails if
 * the three tables ever disagree. That is the whole value of this file: the
 * shared module names a key, and three clients look it up in three catalogues
 * that are checked against each other rather than against a comment asking
 * somebody to keep them identical.
 *
 * It grows one shared module at a time. Send failures first, because they are
 * the ones a person reads while wondering whether to try again.
 */
import type { Translated } from "../translated";

export const domainEn = {
  /*
   * Why a text did not arrive, in words the reader can act on.
   *
   * Deliberately different sentences for the temporary and permanent cases —
   * "Carriers are blocking this right now" invites another try in a minute,
   * "Carriers blocked this as spam" does not, and a person deciding whether to
   * retry needs the difference.
   */
  sendFailureGeneric: "Not delivered",
  sendFailureOptedOut: "This customer opted out",
  sendFailureUnreachable: "That number can't receive texts",
  sendFailureNotTextable: "That number isn't textable",
  sendFailureBlockedNow: "Carriers are blocking this right now",
  sendFailureSpam: "Carriers blocked this as spam",
  sendFailureRateLimited: "Sent too fast for carriers. Try again shortly",
  sendFailureHandsetRejected: "Their phone rejected it",
  sendFailureHandsetUnavailable: "Their phone couldn't receive it",
  sendFailureExpired: "It expired before it could send",
  sendFailureContent: "Carriers wouldn't accept this message",
  sendFailureEmpty: "There was nothing to send",
  sendFailureAttachment: "Carriers wouldn't accept that attachment",
  sendFailureTooLong: "Too long to send",
  sendFailureRegistration: "Your US texting registration isn't approved yet",
  sendFailureNumberNotReady: "This number isn't set up for texting yet",
  sendFailureTextingOff: "Texting is turned off for this number",
  sendFailureNoSms: "This number can't send texts",
  sendFailureNoMms: "This number can't send pictures",
} as const;

export const domainFr: Translated<typeof domainEn> = {
  sendFailureGeneric: "Non livré",
  sendFailureOptedOut: "Ce client s'est désabonné",
  sendFailureUnreachable: "Ce numéro ne peut pas recevoir de textos",
  sendFailureNotTextable: "Ce numéro n'accepte pas les textos",
  sendFailureBlockedNow: "Les fournisseurs bloquent ce message en ce moment",
  sendFailureSpam: "Les fournisseurs l'ont bloqué comme pourriel",
  sendFailureRateLimited: "Envoyé trop vite pour les fournisseurs. Réessayez sous peu",
  sendFailureHandsetRejected: "Son téléphone l'a refusé",
  sendFailureHandsetUnavailable: "Son téléphone n'a pas pu le recevoir",
  sendFailureExpired: "Il a expiré avant de pouvoir partir",
  sendFailureContent: "Les fournisseurs ont refusé ce message",
  sendFailureEmpty: "Il n'y avait rien à envoyer",
  sendFailureAttachment: "Les fournisseurs ont refusé cette pièce jointe",
  sendFailureTooLong: "Trop long pour être envoyé",
  sendFailureRegistration:
    "Votre inscription pour les textos américains n'est pas encore approuvée",
  sendFailureNumberNotReady: "Ce numéro n'est pas encore configuré pour les textos",
  sendFailureTextingOff: "Les textos sont désactivés pour ce numéro",
  sendFailureNoSms: "Ce numéro ne peut pas envoyer de textos",
  sendFailureNoMms: "Ce numéro ne peut pas envoyer d'images",
};
