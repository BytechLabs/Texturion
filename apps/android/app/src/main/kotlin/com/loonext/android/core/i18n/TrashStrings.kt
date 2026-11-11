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
        "trash.restoreFailed" to
            "Couldn't restore that. Try again in a moment.",
        "trash.keep" to
            "Keep it",
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
        "trash.restoreFailed" to
            "Impossible de restaurer. Réessayez dans un instant.",
        "trash.keep" to
            "Le garder",
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
