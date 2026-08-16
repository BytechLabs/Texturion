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
} as const;

export const quotesFr: Translated<typeof quotesEn> = {
  statusDraft: "Brouillon",
  statusSent: "En attente",
  statusViewed: "Ouvert, sans réponse",
  statusAccepted: "Accepté",
  statusDeclined: "Refusé",
  statusExpired: "Expiré",
};
