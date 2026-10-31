import type { Translated } from "../translated";

/**
 * The error boundaries' words (app/error.tsx, app/global-error.tsx). misc.ts
 * spreads both halves in, so the keys are still `misc.errorHeading` and so on.
 *
 * These render OUTSIDE any LocaleProvider today — the provider is mounted
 * inside CompanyProvider, which is exactly what has just failed — so they
 * read English until a provider sits above them. The keys exist so that day
 * is a mount and not a re-extraction.
 *
 * Their own file because the root boundaries ship with the root layout on
 * every page, and importing them from misc.ts brings the rest of `misc`, in
 * both languages, with them.
 */
export const boundariesEn = {
  homeAria: "Loonext home",
  errorHeading: "Something broke on our side.",
  errorBodyBefore:
    "It was nothing you did. Try the page again; if it keeps failing,",
  errorContactLink: "tell us what you were doing",
  errorBodyAfter: "and we will look into it.",
  globalErrorBody:
    "It was nothing you did. Try again; if it keeps failing, come back in a " +
    "few minutes.",
  errorReference: "Reference: {digest}",
  backToHome: "Back to the home page",
} as const;

export const boundariesFr: Translated<typeof boundariesEn> = {
  homeAria: "Accueil Loonext",
  errorHeading: "Une erreur est survenue de notre côté.",
  errorBodyBefore:
    "Ce n'est pas de votre faute. Réessayez la page ; si le problème persiste,",
  errorContactLink: "dites-nous ce que vous faisiez",
  errorBodyAfter: "et nous allons examiner la situation.",
  globalErrorBody:
    "Ce n'est pas de votre faute. Réessayez ; si le problème persiste, " +
    "revenez dans quelques minutes.",
  errorReference: "Référence : {digest}",
  backToHome: "Retour à la page d'accueil",
};
