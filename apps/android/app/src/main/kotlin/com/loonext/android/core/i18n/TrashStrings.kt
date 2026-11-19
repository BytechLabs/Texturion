package com.loonext.android.core.i18n

/**
 * #735: the Trash screen's words, in both languages. Copied from web's
 * `apps/web/src/i18n/sections/trash.ts` so the clients say the same thing.
 * "trash.viewTrash" lives with the delete notices in [ThreadStrings].
 */
object TrashStrings : AppStrings.Section {
    override val en = mapOf(
        "trash.restored" to
            "Restored",
        "trash.restoredOneMissed" to "Restored. One scheduled text missed its send time.",
        "trash.restoredManyMissed" to "Restored. {count} scheduled texts missed their send times.",
        "trash.restoreFailed" to
            "Couldn't restore that. Try again in a moment.",
        "trash.keep" to
            "Keep it",
        "trash.moveToTrash" to "Move to Trash",
        "trash.sourceDeleteBody" to "You can restore this item from Trash for 30 days.",
        "trash.linkedJobErase" to "Job #{number} is linked to this record. Its details will be erased when the record is permanently deleted.",
        "trash.linkedJobLoadFailed" to "Couldn't check the linked job.",
        "trash.retryLinkedJob" to "Try again",
        "trash.linkedJob" to "Linked job #{number}",
        "trash.includesJob" to "Includes job #{number}",
        "trash.deleteMessage" to "Delete message",
        "trash.deleteMessageOnly" to "Delete text only",
        "trash.deleteMessageAndJob" to "Delete text and job",
        "trash.deleteNote" to "Delete note",
        "trash.deleteNoteOnly" to "Delete note only",
        "trash.deleteNoteAndJob" to "Delete note and job",
        "trash.deleteCall" to "Delete call",
        "trash.deleteCallOnly" to "Delete call only",
        "trash.deleteCallAndJob" to "Delete call and job",
        "trash.description" to
            "Deleted conversations, messages, calls and voicemails wait here for 30 days, then they're erased for good.",
        "trash.loadFailed" to
            "Couldn't load the Trash.",
        "trash.emptyTitle" to
            "The Trash is empty",
        "trash.emptyBody" to
            "When someone deletes a conversation, message, call or voicemail, it waits here for 30 days.",
        "trash.kindConversation" to
            "Conversation",
        "trash.kindMessage" to
            "Message",
        "trash.kindNote" to
            "Note",
        "trash.kindCall" to
            "Call",
        "trash.kindContact" to "Contact",
        "trash.contactDeleted" to "Contact moved to Trash",
        "trash.kindVoicemail" to
            "Voicemail",
        "trash.unknownContact" to
            "Unknown contact",
        "trash.messageCountOne" to
            "{count} message",
        "trash.messageCountMany" to
            "{count} messages",
        "trash.noSnippet" to
            "No text",
        "trash.callOutcomeAnswered" to
            "Answered",
        "trash.callOutcomeMissed" to
            "Missed",
        "trash.callOutcomeVoicemail" to
            "Went to voicemail",
        "trash.callWithVoicemail" to
            "Includes a voicemail",
        "trash.voicemailLength" to
            "{seconds}s voicemail",
        "trash.deletedByLine" to
            "Deleted {when} by {who}",
        "trash.deletedByUnknown" to
            "Deleted {when}",
        "trash.you" to
            "you",
        "trash.daysLeftMany" to
            "{count} days left",
        "trash.daysLeftOne" to
            "1 day left",
        "trash.daysLeftToday" to
            "Erased within a day",
        "trash.restore" to
            "Restore",
        "trash.restoring" to
            "Restoring…",
        "trash.deleteForever" to
            "Delete forever",
        "trash.loadMore" to
            "Show more",
        "trash.loadingMore" to
            "Loading…",
        "trash.deleteForeverTitle" to
            "Delete this forever?",
        "trash.deleteForeverBody" to
            "{what} will be erased now, along with its recordings, photos and transcripts. This can't be undone and nobody can restore it. Opt-outs and billing records are kept.",
        "trash.deleteForeverConfirm" to
            "Delete forever",
        "trash.deletedForever" to
            "Deleted forever",
        "trash.deleteForeverFailed" to
            "Couldn't delete that. Try again in a moment.",
    )

    override val frCA = mapOf(
        "trash.restored" to
            "Restauré",
        "trash.restoredOneMissed" to "Restauré. Un texto programmé a dépassé son heure d’envoi.",
        "trash.restoredManyMissed" to "Restauré. {count} textos programmés ont dépassé leur heure d’envoi.",
        "trash.restoreFailed" to
            "Impossible de restaurer. Réessayez dans un instant.",
        "trash.keep" to
            "Le garder",
        "trash.moveToTrash" to "Mettre à la corbeille",
        "trash.sourceDeleteBody" to "Vous pouvez restaurer cet élément depuis la corbeille pendant 30 jours.",
        "trash.linkedJobErase" to "La tâche nº {number} est liée à cet élément. Ses détails seront effacés lors de la suppression définitive.",
        "trash.linkedJobLoadFailed" to "Impossible de vérifier la tâche liée.",
        "trash.retryLinkedJob" to "Réessayer",
        "trash.linkedJob" to "Tâche liée nº {number}",
        "trash.includesJob" to "Inclut la tâche nº {number}",
        "trash.deleteMessage" to "Supprimer le message",
        "trash.deleteMessageOnly" to "Supprimer le texto seulement",
        "trash.deleteMessageAndJob" to "Supprimer le texto et la tâche",
        "trash.deleteNote" to "Supprimer la note",
        "trash.deleteNoteOnly" to "Supprimer la note seulement",
        "trash.deleteNoteAndJob" to "Supprimer la note et la tâche",
        "trash.deleteCall" to "Supprimer l’appel",
        "trash.deleteCallOnly" to "Supprimer l’appel seulement",
        "trash.deleteCallAndJob" to "Supprimer l’appel et la tâche",
        "trash.description" to
            "Les conversations, messages, appels et messages vocaux supprimés attendent ici pendant 30 jours, puis ils sont effacés définitivement.",
        "trash.loadFailed" to
            "Impossible de charger la corbeille.",
        "trash.emptyTitle" to
            "La corbeille est vide",
        "trash.emptyBody" to
            "Quand quelqu'un supprime une conversation, un message, un appel ou un message vocal, il attend ici pendant 30 jours.",
        "trash.kindConversation" to
            "Conversation",
        "trash.kindMessage" to
            "Message",
        "trash.kindNote" to
            "Note",
        "trash.kindCall" to
            "Appel",
        "trash.kindContact" to "Contact",
        "trash.contactDeleted" to "Contact déplacé dans la corbeille",
        "trash.kindVoicemail" to
            "Message vocal",
        "trash.unknownContact" to
            "Contact inconnu",
        "trash.messageCountOne" to
            "{count} message",
        "trash.messageCountMany" to
            "{count} messages",
        "trash.noSnippet" to
            "Aucun texte",
        "trash.callOutcomeAnswered" to
            "Répondu",
        "trash.callOutcomeMissed" to
            "Manqué",
        "trash.callOutcomeVoicemail" to
            "Allé à la boîte vocale",
        "trash.callWithVoicemail" to
            "Comprend un message vocal",
        "trash.voicemailLength" to
            "Message vocal de {seconds} s",
        "trash.deletedByLine" to
            "Supprimé {when} par {who}",
        "trash.deletedByUnknown" to
            "Supprimé {when}",
        "trash.you" to
            "vous",
        "trash.daysLeftMany" to
            "{count} jours restants",
        "trash.daysLeftOne" to
            "1 jour restant",
        "trash.daysLeftToday" to
            "Effacé d'ici un jour",
        "trash.restore" to
            "Restaurer",
        "trash.restoring" to
            "Restauration…",
        "trash.deleteForever" to
            "Supprimer définitivement",
        "trash.loadMore" to
            "Afficher plus",
        "trash.loadingMore" to
            "Chargement…",
        "trash.deleteForeverTitle" to
            "Supprimer définitivement?",
        "trash.deleteForeverBody" to
            "{what} sera effacé maintenant, avec ses enregistrements, photos et transcriptions. Cette action est irréversible et personne ne pourra le restaurer. Les désabonnements et les dossiers de facturation sont conservés.",
        "trash.deleteForeverConfirm" to
            "Supprimer définitivement",
        "trash.deletedForever" to
            "Supprimé définitivement",
        "trash.deleteForeverFailed" to
            "Impossible de supprimer. Réessayez dans un instant.",
    )
}
