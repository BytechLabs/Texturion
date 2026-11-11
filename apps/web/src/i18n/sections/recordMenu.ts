/**
 * #712 — the words in the one action list every record type shares, in both
 * languages. Only the actions that did not already have a catalogue entry live
 * here; "Copy text", "Pinned", the delete verbs and the rest keep the keys
 * they have always had, so the ⋯ menu and the right-click menu say the same
 * thing because they read the same entry.
 */
import type { Translated } from "../translated";

export const recordMenuEn = {
  open: "Open",
  openInNewTab: "Open in new tab",
  openConversation: "Open conversation",
  markRead: "Mark read",
  closeConversation: "Close conversation",
  reopenConversation: "Reopen conversation",
  text: "Message",
  callBack: "Call back",
  call: "Call",
  copyNumber: "Copy number",
  copyLink: "Copy link",
  linkCopied: "Link copied",
  moveDueDate: "Move due date",
  cancelScheduled: "Cancel scheduled text",
  taskDeleteBody: "This task will be removed for everyone on your team.",
  moreActionsFor: "More actions for {name}",
  currentMark: "Current",
} as const;

export const recordMenuFr: Translated<typeof recordMenuEn> = {
  open: "Ouvrir",
  openInNewTab: "Ouvrir dans un nouvel onglet",
  openConversation: "Ouvrir la conversation",
  markRead: "Marquer comme lue",
  closeConversation: "Fermer la conversation",
  reopenConversation: "Rouvrir la conversation",
  text: "Texto",
  callBack: "Rappeler",
  call: "Appeler",
  copyNumber: "Copier le numéro",
  copyLink: "Copier le lien",
  linkCopied: "Lien copié",
  moveDueDate: "Déplacer l’échéance",
  cancelScheduled: "Annuler le texto planifié",
  taskDeleteBody: "Cette tâche sera retirée pour toute votre équipe.",
  moreActionsFor: "Autres actions pour {name}",
  currentMark: "Actuel",
};
