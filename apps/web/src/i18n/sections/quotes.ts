/**
 * #287 — the words a quote's status is read in, in both languages.
 *
 * Its own file rather than another block in `inbox`, for the reason that
 * file's own header gives: one file per surface, so a translator working
 * through a screen sees its strings adjacent rather than sorted by concept.
 *
 * `fr` is typed as `en`'s exact shape, so a key added to one and forgotten in
 * the other fails `tsc` rather than surfacing as its own name to a French
 * reader.
 *
 * These exist from the first commit of the feature rather than being
 * retrofitted. #228 spent a long time converting sentences that were written
 * in English first and translated afterwards, and the cheapest moment to name
 * a key is before anything renders it.
 *
 * A note on register. `sent` and `viewed` are what the CREW sees about their
 * own offer, so they are written from the business's side: "Waiting" says what
 * the owner is doing about it, where "Sent" would only say what already
 * happened. `viewed` is the one worth having at all — knowing the customer
 * opened it and has still not answered is the difference between chasing and
 * waiting.
 */
import type { Translated } from "../translated";

export const quotesEn = {
  statusDraft: "Draft",
  statusSent: "Waiting",
  statusViewed: "Opened, no answer",
  statusAccepted: "Accepted",
  statusDeclined: "Declined",
  statusExpired: "Expired",
  /* #287 — the page a homeowner opens. The WORKSPACE's language, because
     there is no session here and nothing knows who is holding the phone;
     the business wrote the quote, so the business's language is the honest
     default. */
  unavailableTitle: "This quote isn't available",
  unavailableDetail: "The link may have expired, or the business may have withdrawn it. Text them back and they can send a new one.",
  acceptedTitle: "Accepted. {business} has been told.",
  acceptedDetail: "You accepted {amount} for {description}",
  acceptAction: "Accept this quote",
  accepting: "Accepting…",
  priceHolds: "This price holds until {date}.",
  acceptFailed: "That didn't go through. The quote may have just expired or been withdrawn. Text {business} and they can sort it.",
  noLongerOpen: "This quote is no longer open. Text {business} if you would still like the work done.",
} as const;

export const quotesFr: Translated<typeof quotesEn> = {
  statusDraft: "Brouillon",
  statusSent: "En attente",
  statusViewed: "Ouvert, sans réponse",
  statusAccepted: "Accepté",
  statusDeclined: "Refusé",
  statusExpired: "Expiré",
  unavailableTitle: "Ce devis n'est pas disponible",
  unavailableDetail: "Le lien a peut-être expiré, ou l'entreprise l'a retiré. Répondez-leur par texto et ils pourront en envoyer un nouveau.",
  acceptedTitle: "Accepté. {business} en a été informé.",
  acceptedDetail: "Vous avez accepté {amount} pour {description}",
  acceptAction: "Accepter ce devis",
  accepting: "Acceptation…",
  priceHolds: "Ce prix tient jusqu'au {date}.",
  acceptFailed: "Cela n'a pas fonctionné. Le devis vient peut-être d'expirer ou d'être retiré. Écrivez à {business} et ils pourront arranger cela.",
  noLongerOpen: "Ce devis n'est plus ouvert. Écrivez à {business} si vous souhaitez toujours faire réaliser les travaux.",
};
