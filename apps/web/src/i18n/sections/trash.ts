/**
 * The words for deleting records and the Trash they wait in (#691).
 *
 * Two promises are repeated wherever they apply, because they are the two
 * things people assume wrongly: a text that was already sent stays on the
 * customer's phone, and an opt-out (STOP) outlives every delete.
 */
import type { Translated } from "../translated";

export const trashEn = {
  // Shared
  restored: "Restored",
  restoreFailed: "Couldn't restore that. Try again in a moment.",
  keep: "Keep it",
  moveToTrash: "Move to Trash",

  // Message
  deleteMessage: "Delete message",
  deleteNote: "Delete note",
  messageDeleted: "Message moved to Trash",
  messageDeletedSent:
    "Message moved to Trash. Removed from Loonext only; the customer still has the text.",
  noteDeleted: "Note moved to Trash",
  messageDeleteFailed: "Couldn't delete that message. Try again in a moment.",

  // Conversation
  deleteConversation: "Delete conversation",
  deleteConversationTitle: "Delete this conversation?",
  deleteConversationsTitle: "Delete {count} conversations?",
  deleteConversationBody:
    "It moves to the Trash for 30 days, then it's erased for good. Texts you already sent stay on the customer's phone; this removes them from Loonext only. If the customer texted STOP, that stays on record.",
  conversationDeleted: "Conversation moved to Trash",
  conversationsDeleted: "{count} conversations moved to Trash",
  conversationDeleteFailed:
    "Couldn't delete the conversation. Try again in a moment.",
  conversationsDeletedPartial:
    "{done} of {total} conversations moved to Trash. The rest couldn't be deleted.",
  bulkDelete: "Delete",

  // Calls
  callActionsAria: "Actions for the call from {name}",
  deleteCall: "Delete call",
  deleteVoicemail: "Delete voicemail",
  callDeleted: "Call moved to Trash",
  voicemailDeleted: "Voicemail moved to Trash. The call stays in your log.",
  callDeleteFailed: "Couldn't delete the call. Try again in a moment.",
  voicemailDeleteFailed: "Couldn't delete the voicemail. Try again in a moment.",

  // Trash page
  navLink: "Trash",
  title: "Trash",
  description:
    "Deleted conversations, messages, calls and voicemails wait here for 30 days, then they're erased for good.",
  noAccess: "Only people who can delete records can open the Trash.",
  loadFailed: "Couldn't load the Trash.",
  emptyTitle: "The Trash is empty",
  emptyBody:
    "When someone deletes a conversation, message, call or voicemail, it waits here for 30 days.",
  kindConversation: "Conversation",
  kindMessage: "Message",
  kindNote: "Note",
  kindCall: "Call",
  kindVoicemail: "Voicemail",
  unknownContact: "Unknown contact",
  messageCountOne: "{count} message",
  messageCountMany: "{count} messages",
  messageOutbound: "Sent to them",
  messageInbound: "From them",
  noSnippet: "No text",
  callOutcomeAnswered: "Answered",
  callOutcomeMissed: "Missed",
  callOutcomeVoicemail: "Went to voicemail",
  callWithVoicemail: "Includes a voicemail",
  voicemailLength: "{seconds}s voicemail",
  deletedByLine: "Deleted {when} by {who}",
  deletedByUnknown: "Deleted {when}",
  someone: "someone",
  you: "you",
  daysLeftMany: "{count} days left",
  daysLeftOne: "1 day left",
  daysLeftToday: "Erased within a day",
  restore: "Restore",
  restoring: "Restoring…",
  deleteForever: "Delete forever",
  loadMore: "Show more",
  loadingMore: "Loading…",
  deleteForeverTitle: "Delete this forever?",
  deleteForeverBody:
    "{what} will be erased now, along with its recordings, photos and transcripts. This can't be undone and nobody can restore it. Opt-outs and billing records are kept.",
  deleteForeverType: "Type {word} to confirm",
  confirmWord: "DELETE",
  deleteForeverConfirm: "Delete forever",
  deleteForeverWorking: "Deleting…",
  deletedForever: "Deleted forever",
  deleteForeverFailed: "Couldn't delete that. Try again in a moment.",

  // Audit sentences (Settings > History)
  auditActionDeleted: "Deleted a record",
  auditActionRestored: "Restored from the Trash",
  auditActionPurged: "Erased for good",
  auditDeleted: "{who} deleted {what}",
  auditRestored: "{who} restored {what} from the Trash",
  auditPurgedByExpiry: "{what} was erased after 30 days in the Trash",
  auditPurgedByPerson: "{who} erased {what} for good",
  auditTargetMessage: "a message",
  auditTargetConversation: "a conversation",
  auditTargetCall: "a call",
  auditTargetVoicemail: "a voicemail",
  auditTargetContact: "a contact",
  auditTargetOther: "a record",
} as const;

export const trashFr: Translated<typeof trashEn> = {
  restored: "Restauré",
  restoreFailed: "Impossible de restaurer. Réessayez dans un instant.",
  keep: "Le garder",
  moveToTrash: "Mettre à la corbeille",

  deleteMessage: "Supprimer le message",
  deleteNote: "Supprimer la note",
  messageDeleted: "Message mis à la corbeille",
  messageDeletedSent:
    "Message mis à la corbeille. Retiré de Loonext seulement; le client a toujours le texto.",
  noteDeleted: "Note mise à la corbeille",
  messageDeleteFailed:
    "Impossible de supprimer ce message. Réessayez dans un instant.",

  deleteConversation: "Supprimer la conversation",
  deleteConversationTitle: "Supprimer cette conversation?",
  deleteConversationsTitle: "Supprimer {count} conversations?",
  deleteConversationBody:
    "Elle va à la corbeille pendant 30 jours, puis elle est effacée définitivement. Les textos déjà envoyés restent sur le téléphone du client; cela les retire de Loonext seulement. Si le client a écrit STOP, cela reste au dossier.",
  conversationDeleted: "Conversation mise à la corbeille",
  conversationsDeleted: "{count} conversations mises à la corbeille",
  conversationDeleteFailed:
    "Impossible de supprimer la conversation. Réessayez dans un instant.",
  conversationsDeletedPartial:
    "{done} conversations sur {total} mises à la corbeille. Les autres n'ont pas pu être supprimées.",
  bulkDelete: "Supprimer",

  callActionsAria: "Actions pour l'appel de {name}",
  deleteCall: "Supprimer l'appel",
  deleteVoicemail: "Supprimer le message vocal",
  callDeleted: "Appel mis à la corbeille",
  voicemailDeleted:
    "Message vocal mis à la corbeille. L'appel reste dans votre journal.",
  callDeleteFailed: "Impossible de supprimer l'appel. Réessayez dans un instant.",
  voicemailDeleteFailed:
    "Impossible de supprimer le message vocal. Réessayez dans un instant.",

  navLink: "Corbeille",
  title: "Corbeille",
  description:
    "Les conversations, messages, appels et messages vocaux supprimés attendent ici pendant 30 jours, puis ils sont effacés définitivement.",
  noAccess:
    "Seules les personnes qui peuvent supprimer des données peuvent ouvrir la corbeille.",
  loadFailed: "Impossible de charger la corbeille.",
  emptyTitle: "La corbeille est vide",
  emptyBody:
    "Quand quelqu'un supprime une conversation, un message, un appel ou un message vocal, il attend ici pendant 30 jours.",
  kindConversation: "Conversation",
  kindMessage: "Message",
  kindNote: "Note",
  kindCall: "Appel",
  kindVoicemail: "Message vocal",
  unknownContact: "Contact inconnu",
  messageCountOne: "{count} message",
  messageCountMany: "{count} messages",
  messageOutbound: "Envoyé au client",
  messageInbound: "Reçu du client",
  noSnippet: "Aucun texte",
  callOutcomeAnswered: "Répondu",
  callOutcomeMissed: "Manqué",
  callOutcomeVoicemail: "Allé à la boîte vocale",
  callWithVoicemail: "Comprend un message vocal",
  voicemailLength: "Message vocal de {seconds} s",
  deletedByLine: "Supprimé {when} par {who}",
  deletedByUnknown: "Supprimé {when}",
  someone: "quelqu'un",
  you: "vous",
  daysLeftMany: "{count} jours restants",
  daysLeftOne: "1 jour restant",
  daysLeftToday: "Effacé d'ici un jour",
  restore: "Restaurer",
  restoring: "Restauration…",
  deleteForever: "Supprimer définitivement",
  loadMore: "Afficher plus",
  loadingMore: "Chargement…",
  deleteForeverTitle: "Supprimer définitivement?",
  deleteForeverBody:
    "{what} sera effacé maintenant, avec ses enregistrements, photos et transcriptions. Cette action est irréversible et personne ne pourra le restaurer. Les désabonnements et les dossiers de facturation sont conservés.",
  deleteForeverType: "Tapez {word} pour confirmer",
  confirmWord: "SUPPRIMER",
  deleteForeverConfirm: "Supprimer définitivement",
  deleteForeverWorking: "Suppression…",
  deletedForever: "Supprimé définitivement",
  deleteForeverFailed: "Impossible de supprimer. Réessayez dans un instant.",

  auditActionDeleted: "A supprimé un élément",
  auditActionRestored: "A restauré depuis la corbeille",
  auditActionPurged: "A effacé définitivement",
  auditDeleted: "{who} a supprimé {what}",
  auditRestored: "{who} a restauré {what} depuis la corbeille",
  auditPurgedByExpiry: "{what} a été effacé après 30 jours dans la corbeille",
  auditPurgedByPerson: "{who} a effacé définitivement {what}",
  auditTargetMessage: "un message",
  auditTargetConversation: "une conversation",
  auditTargetCall: "un appel",
  auditTargetVoicemail: "un message vocal",
  auditTargetContact: "un contact",
  auditTargetOther: "un élément",
};
