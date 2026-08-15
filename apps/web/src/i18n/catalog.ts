/**
 * #228 Phase 1 — the app's own words, in one place, in two languages.
 *
 * ## Why an in-house catalogue rather than next-intl
 *
 * Not NIH, and worth the paragraph because "use the library" is the obvious
 * review note. `next-intl` earns its keep through locale ROUTING —
 * `/fr/inbox`, a middleware that negotiates and rewrites, and
 * `generateStaticParams` per locale. This app cannot use any of that:
 *
 * - The middleware's first gate is already the D27 marketing/app host split,
 *   which redirects across two origins on the path. A second router-shaped
 *   middleware in front of it is the kind of interaction that produces a
 *   redirect loop nobody can reproduce locally, on the one surface where a loop
 *   signs everybody out.
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
 * Each section's French is typed as its English's exact shape, so a key added
 * to one and forgotten in the other **fails `tsc`**, in the file that forgot
 * it. That is stronger than any check we could write over JSON, and it is why
 * the catalogue is TypeScript: a missing key in a JSON message file is a
 * runtime fallback nobody sees until a French user does.
 *
 * ## One file per surface
 *
 * `sections/` rather than one object, for two reasons that both matter. The
 * extraction of 2,000-odd strings runs in parallel and would otherwise collide
 * on every change in a single file. And a translator working through a screen
 * needs its strings ADJACENT — a catalogue sorted by concept makes them
 * translate a sentence with no idea what sits above it.
 *
 * ## Interpolation
 *
 * `{name}` only. No plural rules, no gender, no dates — dates and money go
 * through the locale-aware formatters that already exist (`formatMoney`,
 * `lib/format/time`), and inventing a second numbering system here would be
 * exactly the drift this file exists to prevent.
 */
import { appShellEn, appShellFr } from "./sections/appShell";
import { contactsEn, contactsFr } from "./sections/contacts";
import { inboxEn, inboxFr } from "./sections/inbox";
import { miscEn, miscFr } from "./sections/misc";
import { onboardingEn, onboardingFr } from "./sections/onboarding";
import { settingsEn, settingsFr } from "./sections/settings";
import { settingsMoreEn, settingsMoreFr } from "./sections/settingsMore";
import { webhooksEn, webhooksFr } from "./sections/webhooks";
import { shellEn, shellFr } from "./sections/shell";
import { tasksEn, tasksFr } from "./sections/tasks";
import { threadEn, threadFr } from "./sections/thread";
import type { Translated } from "./translated";

/** Words used in more than one place, and nowhere in particular. */
const commonEn = {
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
} as const;

const commonFr: Translated<typeof commonEn> = {
  cancel: "Annuler",
  save: "Enregistrer",
  saving: "Enregistrement…",
  saved: "Enregistré",
  delete: "Supprimer",
  close: "Fermer",
  back: "Retour",
  retry: "Réessayer",
  loadFailed: "Impossible de charger. Vérifiez votre connexion et réessayez.",
  somethingWentWrong: "Une erreur s'est produite. Réessayez.",
};

/** Text-to-pay (#224), the first surface extracted. */
const paymentsEn = {
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
  // The customer's page (#224). Drawn in the BUSINESS's language, because the
  // reader has a relationship with them and not with us.
  linkUnavailableTitle: "This link isn't available",
  linkUnavailableDetail:
    "It may have expired, or already been paid. Ask the business for a new " +
    "one — and never send money to a link you were not expecting.",
  theBusiness: "the business",
  asksFor: "{business} asks for",
  payAmount: "Pay {amount}",
  cardHandledByStripe:
    "Card details are handled by Stripe. {business} receives the payment " +
    "directly — nobody else holds your card.",
  settledPaidTitle: "This has been paid",
  settledCancelledTitle: "This request was cancelled",
  settledExpiredTitle: "This request has expired",
  settledPaidDetail:
    "{business} has received {amount}. Your receipt was emailed to you by " +
    "Stripe. Nothing else is needed.",
  settledCancelledDetail:
    "{business} called this request off. If you were expecting to pay, message " +
    "them and they can send a new one.",
  settledExpiredDetail:
    "This request was for {amount} and is no longer open. Ask {business} for a " +
    "new link.",
  askForANewOne: "Ask the business to send you a new one.",
} as const;

/**
 * Quebec French.
 *
 * Two standing rules, and the first is deliberately the opposite of the one
 * governing `packages/shared/src/locale.ts`:
 *
 * - **Accents are used normally.** The GSM-7 restriction that governs the
 *   automated SMS bodies exists because those are billed by the segment.
 *   Nothing on a web page is, so `bientôt` is spelled `bientôt`.
 * - **Vouvoiement.** The product speaks to the crew the way a business speaks
 *   to a professional, matching the register of the English.
 */
const paymentsFr: Translated<typeof paymentsEn> = {
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
  linkUnavailableTitle: "Ce lien n'est pas disponible",
  linkUnavailableDetail:
    "Il a peut-être expiré, ou le paiement a déjà été fait. Demandez un " +
    "nouveau lien à l'entreprise — et n'envoyez jamais d'argent par un lien " +
    "auquel vous ne vous attendiez pas.",
  theBusiness: "l'entreprise",
  asksFor: "{business} vous demande",
  payAmount: "Payer {amount}",
  cardHandledByStripe:
    "Les données de votre carte sont traitées par Stripe. {business} reçoit le " +
    "paiement directement — personne d'autre ne détient votre carte.",
  settledPaidTitle: "Ce paiement a été effectué",
  settledCancelledTitle: "Cette demande a été annulée",
  settledExpiredTitle: "Cette demande a expiré",
  settledPaidDetail:
    "{business} a reçu {amount}. Stripe vous a envoyé votre reçu par courriel. " +
    "Rien d'autre n'est requis.",
  settledCancelledDetail:
    "{business} a annulé cette demande. Si vous vous attendiez à payer, " +
    "écrivez-leur et ils pourront vous en envoyer une nouvelle.",
  settledExpiredDetail:
    "Cette demande était de {amount} et n'est plus ouverte. Demandez un " +
    "nouveau lien à {business}.",
  askForANewOne: "Demandez à l'entreprise de vous en envoyer un nouveau.",
};

export const EN = {
  common: commonEn,
  payments: paymentsEn,
  settings: settingsEn,
  settingsMore: settingsMoreEn,
  webhooks: webhooksEn,
  appShell: appShellEn,
  thread: threadEn,
  onboarding: onboardingEn,
  contacts: contactsEn,
  inbox: inboxEn,
  tasks: tasksEn,
  shell: shellEn,
  misc: miscEn,
} as const;

/** The shape a full translation must have: every section, every key. */
export type Catalog = {
  [Section in keyof typeof EN]: Translated<(typeof EN)[Section]>;
};

export const FR_CA: Catalog = {
  common: commonFr,
  payments: paymentsFr,
  settings: settingsFr,
  settingsMore: settingsMoreFr,
  webhooks: webhooksFr,
  appShell: appShellFr,
  thread: threadFr,
  onboarding: onboardingFr,
  contacts: contactsFr,
  inbox: inboxFr,
  tasks: tasksFr,
  shell: shellFr,
  misc: miscFr,
};

/** Every catalogue, by locale. */
export const CATALOGS = { en: EN as unknown as Catalog, "fr-CA": FR_CA };
