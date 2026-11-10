import type { Translated } from "../translated";

/**
 * Words used in more than one place, and nowhere in particular.
 *
 * Its own file so a module can use these without importing `catalog.ts`,
 * which pulls in every section in both languages (the root error boundaries
 * do).
 */
export const commonEn = {
  cancel: "Cancel",
  /** #724: the action on a creation toast that goes to what was made. */
  open: "Open",
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

export const commonFr: Translated<typeof commonEn> = {
  cancel: "Annuler",
  open: "Ouvrir",
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
