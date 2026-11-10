/**
 * The words for blocking a number, in both languages.
 *
 * A block is the business's choice about its own inbox. It is not an opt-out,
 * so every confirmation says what it does and what it leaves alone: the
 * crew can still text the number.
 */
import type { Translated } from "../translated";

export const blockedNumbersEn = {
  navBlockedNumbers: "Blocked numbers",
  navBlockedNumbersDesc: "Numbers whose texts and calls go straight to spam",

  title: "Blocked numbers",
  intro:
    "Texts and calls from these numbers go straight to spam. You can still " +
    "text them, and unblocking lets their next text or call through.",
  empty: "No blocked numbers.",
  emptyBody:
    "Block a number from its conversation or its contact page when it keeps " +
    "bothering the crew.",
  loadFailed: "Couldn't load the blocked numbers.",

  blockedBy: "Blocked by {name}",
  blockedByUnknown: "Blocked",
  reason: "Reason: {reason}",
  teammate: "A teammate",

  blockAction: "Block number",
  unblockAction: "Unblock number",
  unblockRowAction: "Unblock",
  unblockRowAria: "Unblock {number}",
  blockedBadge: "Blocked",

  blockTitle: "Block {number}?",
  blockBody:
    "Future texts and calls from this number go straight to spam. You can " +
    "still text them.",
  blockConfirm: "Block",
  blocking: "Blocking...",
  blocked: "Number blocked",
  blockFailed: "Couldn't block that number.",
  unblocked: "Number unblocked",
  unblockFailed: "Couldn't unblock that number.",
  manageNote: "Send this number's future texts and calls straight to spam.",
  manageNoteBlocked: "This number's texts and calls go straight to spam.",
};

export const blockedNumbersFr: Translated<typeof blockedNumbersEn> = {
  navBlockedNumbers: "Numéros bloqués",
  navBlockedNumbersDesc:
    "Numéros dont les textos et appels vont directement aux pourriels",

  title: "Numéros bloqués",
  intro:
    "Les textos et appels de ces numéros vont directement aux pourriels. " +
    "Vous pouvez quand même leur écrire, et débloquer un numéro laisse passer " +
    "son prochain texto ou appel.",
  empty: "Aucun numéro bloqué.",
  emptyBody:
    "Bloquez un numéro depuis sa conversation ou sa fiche client quand il " +
    "dérange l'équipe.",
  loadFailed: "Impossible de charger les numéros bloqués.",

  blockedBy: "Bloqué par {name}",
  blockedByUnknown: "Bloqué",
  reason: "Raison : {reason}",
  teammate: "Un coéquipier",

  blockAction: "Bloquer ce numéro",
  unblockAction: "Débloquer ce numéro",
  unblockRowAction: "Débloquer",
  unblockRowAria: "Débloquer {number}",
  blockedBadge: "Bloqué",

  blockTitle: "Bloquer {number} ?",
  blockBody:
    "Les prochains textos et appels de ce numéro iront directement aux " +
    "pourriels. Vous pouvez quand même lui écrire.",
  blockConfirm: "Bloquer",
  blocking: "Blocage...",
  blocked: "Numéro bloqué",
  blockFailed: "Impossible de bloquer ce numéro.",
  unblocked: "Numéro débloqué",
  unblockFailed: "Impossible de débloquer ce numéro.",
  manageNote:
    "Envoyer les prochains textos et appels de ce numéro directement aux pourriels.",
  manageNoteBlocked:
    "Les textos et appels de ce numéro vont directement aux pourriels.",
};
