/**
 * #228 Phase 1 — the app's own words, in one place, in two languages.
 *
 * ## Why an in-house catalogue rather than next-intl
 *
 * Not NIH, and worth the paragraph because "use the library" is the obvious
 * review note. `next-intl` earns its keep through locale ROUTING —
 * `/fr/inbox`, a middleware that negotiates and rewrites, and `generateStaticParams`
 * per locale. This app cannot use any of that:
 *
 * - The middleware's first gate is already the D27 marketing/app host split,
 *   which redirects across two origins on the path. A second router-shaped
 *   middleware in front of it is the kind of interaction that produces a
 *   redirect loop nobody can reproduce locally, on the one surface where a
 *   loop signs everybody out.
 * - The app's language is a PERSON's setting, not a URL's (#228: user > device
 *   > company > English). Two members of the same workspace open the same
 *   thread in different languages, and a locale in the path would make that a
 *   different URL for each of them — so a link pasted into a note would change
 *   the reader's language.
 * - The marketing site's French is a Bill 96 deliverable with its own SEO
 *   requirements (real French URLs, hreflang, translated slugs). It is a
 *   different problem from the app's, and solving both with one routing scheme
 *   would compromise the one that actually needs URLs.
 *
 * What is left after routing is a keyed lookup and an interpolation, which is
 * the file you are reading. The phones cannot import it either way.
 *
 * ## The completeness guarantee is the type, not a linter
 *
 * `EN` is the source of truth and `FR_CA` is typed as its exact shape, so a key
 * added to English and forgotten in French **fails `tsc`**. That is stronger
 * than any check we could write over JSON, and it is why the catalogue is
 * TypeScript rather than the `.json` a library would want: a missing key in a
 * JSON message file is a runtime fallback nobody sees until a French user does.
 *
 * ## Interpolation
 *
 * `{name}` only. No plural rules, no gender, no dates — dates and money go
 * through the locale-aware formatters that already exist
 * (`formatMoney`, `lib/format/time`), and inventing a second numbering system
 * here would be the drift this file exists to prevent.
 */

/**
 * Every string the app says, keyed by where it is said.
 *
 * Grouped by SURFACE rather than by meaning, because the question a reader asks
 * is "what does this screen say", and a translator working through a screen
 * needs its strings adjacent — a catalogue sorted by concept makes them
 * translate a sentence with no idea what is above it.
 */
export const EN = {
  common: {
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    delete: "Delete",
    close: "Close",
    back: "Back",
    retry: "Try again",
    loadFailed: "Couldn't load this. Check your connection and try again.",
    somethingWentWrong: "Something went wrong. Try again.",
  },
  payments: {
    settingsTitle: "Getting paid",
    settingsDescription:
      "Ask a customer for a deposit or a final payment, right in the thread.",
    askAction: "Ask for payment",
    amountLabel: "Amount",
    descriptionLabel: "What for",
    theyWillReceive: "They will receive:",
    askFor: "Ask for {amount}",
    asked: "Asked for {amount}.",
    sendFailed: "That didn't send.",
    footnote:
      "Goes out as a text with a secure payment link. The money lands in your " +
      "bank account — we take nothing on top.",
    stripeNeeds: "Stripe still needs:",
    payouts: "Payouts",
    payoutsOn: "On — money reaches your bank",
    payoutsOff: "Stripe has not switched payouts on yet",
    chargedIn: "Charged in",
    refundNote:
      "Refunds, receipts and payout history all live in your Stripe dashboard. " +
      "We never hold your money and we take nothing on top of what you charge — " +
      "Stripe's own card fee is the only deduction.",
    stripeOpenFailed: "Couldn't open Stripe. Try again in a moment.",
    refundedBack: "{amount} went back to them.",
    disputedNote:
      "Their bank has pulled this back. Stripe has emailed you what it needs.",
    cancelAria: "Cancel the {amount} request for {description}",
  },
} as const;

/**
 * The shape a translation must have: the same keys, all of them, as strings.
 *
 * Mapped rather than `typeof EN` so a translation is not required to repeat the
 * English literal types — `"Cancel"` is the English value, not the contract.
 */
export type Catalog = {
  [Section in keyof typeof EN]: { [Key in keyof (typeof EN)[Section]]: string };
};

/**
 * Quebec French.
 *
 * Two standing rules, both from the fr-CA copy already shipped in
 * `packages/shared/src/locale.ts`, and both deliberately different here:
 *
 * - **Accents are used normally.** The GSM-7 restriction that governs the
 *   automated SMS bodies does not apply to a web page — nothing here is billed
 *   by the segment, so `bientôt` is spelled `bientôt`.
 * - **Vouvoiement.** The product speaks to the crew as a business speaks to a
 *   professional, matching the register of the English.
 */
export const FR_CA: Catalog = {
  common: {
    cancel: "Annuler",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Enregistré",
    delete: "Supprimer",
    close: "Fermer",
    back: "Retour",
    retry: "Réessayer",
    loadFailed:
      "Impossible de charger. Vérifiez votre connexion et réessayez.",
    somethingWentWrong: "Une erreur s'est produite. Réessayez.",
  },
  payments: {
    settingsTitle: "Encaisser les paiements",
    settingsDescription:
      "Demandez un acompte ou le paiement final à un client, directement dans la conversation.",
    askAction: "Demander un paiement",
    amountLabel: "Montant",
    descriptionLabel: "Pour quoi",
    theyWillReceive: "Le client recevra :",
    askFor: "Demander {amount}",
    asked: "Demande de {amount} envoyée.",
    sendFailed: "L'envoi a échoué.",
    footnote:
      "Envoyé par texto avec un lien de paiement sécurisé. L'argent arrive dans " +
      "votre compte bancaire — nous ne prenons rien de plus.",
    stripeNeeds: "Stripe a encore besoin de :",
    payouts: "Versements",
    payoutsOn: "Actifs — l'argent se rend à votre banque",
    payoutsOff: "Stripe n'a pas encore activé les versements",
    chargedIn: "Facturé en",
    refundNote:
      "Les remboursements, les reçus et l'historique des versements se trouvent " +
      "dans votre tableau de bord Stripe. Nous ne détenons jamais votre argent et " +
      "nous ne prenons rien de plus que ce que vous facturez — seuls les frais de " +
      "carte de Stripe sont retenus.",
    stripeOpenFailed: "Impossible d'ouvrir Stripe. Réessayez dans un moment.",
    refundedBack: "{amount} leur a été remboursé.",
    disputedNote:
      "Leur banque a repris ce paiement. Stripe vous a écrit pour la suite.",
    cancelAria: "Annuler la demande de {amount} pour {description}",
  },
};

/** Every catalogue, by locale. */
export const CATALOGS = { en: EN as unknown as Catalog, "fr-CA": FR_CA };
