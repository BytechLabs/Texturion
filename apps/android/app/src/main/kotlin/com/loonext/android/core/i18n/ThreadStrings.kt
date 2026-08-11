package com.loonext.android.core.i18n

/**
 * #228 — the conversation: its timeline, its composer, and the files that ride
 * on both (`features/thread`, `features/compose`, `features/attachments`).
 *
 * The busiest surface in the product, so it is also the one where a half-English
 * screen is most obvious: a crew member reads this all day and reads the
 * settings index twice a year.
 *
 * The register is `CommonStrings`': Quebec French, VOUVOIEMENT, accents spelled
 * normally, a space before `:`. Product names (Loonext, Lou, Stripe, Telnyx) and
 * the carrier keywords (STOP / START / HELP / URGENT) are never translated — a
 * carrier matches on the keyword, and a customer who is told to text "ARRÊT"
 * will not be unsubscribed by anybody.
 *
 * The shared vocabulary, so the phone and the laptop agree word for word:
 * texto · conversation · client · équipe · espace de travail · numéro · tâche ·
 * rappel · devis · acompte · forfait · facturation · paramètres ·
 * boîte de réception.
 */
object ThreadStrings : AppStrings.Section {
    override val en = mapOf(
        // --- The thread itself -------------------------------------------
        "thread.notFound" to "This conversation doesn't exist or was removed.",
        "thread.backToInbox" to "Back to inbox",
        "thread.noMessages" to "No messages yet.",
        "thread.newMessagePill" to "New message",
        "thread.copied" to "Copied.",
        "thread.more" to "More",
        "thread.callContact" to "Call {name}",
        "thread.optedOut" to "Opted out",
        "thread.contactFallback" to "Contact",
        "thread.conversationFallback" to "Conversation",
        "thread.viewContact" to "View contact",
        "thread.photo" to "Photo",
        "thread.file" to "File",
        "thread.teammate" to "Teammate",
        "thread.you" to "You",
        "thread.youSuffix" to " (you)",
        "thread.selected" to "Selected",
        "thread.micNeededForCalls" to
            "Loonext needs the microphone to place calls. " +
            "Allow it in Settings › Apps › Loonext › Permissions.",

        // --- Status ------------------------------------------------------
        "thread.statusHeading" to "STATUS",
        "thread.statusNew" to "New",
        "thread.statusOpen" to "Open",
        "thread.statusWaiting" to "Waiting",
        "thread.statusClosed" to "Closed",

        // --- Day dividers -------------------------------------------------
        "thread.dayToday" to "Today",
        "thread.dayYesterday" to "Yesterday",

        // --- Queued sends (#234) -------------------------------------------
        "thread.deleteQueuedTitle" to "Delete this message?",
        "thread.deleteQueuedBody" to
            "It hasn't been sent, and deleting it here is the only copy gone.",
        "thread.keepIt" to "Keep it",
        "thread.queuedOffline" to "Queued — will send when you're back online",
        "thread.sending" to "Sending…",
        "thread.sent" to "Sent",
        "thread.delivered" to "Delivered",
        "thread.sendNow" to "Send now",
        "thread.retry" to "Retry",
        "thread.oneAttachment" to "1 attachment",
        "thread.manyAttachments" to "{count} attachments",

        // --- Tags ----------------------------------------------------------
        "thread.tags" to "Tags",
        "thread.addTag" to "Add tag",
        "thread.removeTag" to "Remove tag {name}",
        "thread.addOrCreateTag" to "Add or create a tag",
        "thread.findTag" to "Find a tag",
        "thread.create" to "Create",
        "thread.add" to "Add",
        "thread.didYouMean" to "Did you mean \"{name}\"?",
        "thread.tagsLocked" to
            "No tag by that name. Ask an admin to add it — this workspace keeps " +
            "a set list.",
        "thread.noTagsCreate" to "No tags yet. Create the first one above.",
        "thread.noTagsAdmin" to "No tags yet. An admin adds the first one.",
        "thread.attached" to "Attached",

        // --- Opt-out (#407) --------------------------------------------------
        "thread.optOutTitle" to "Opt this customer out?",
        "thread.optOutBody" to
            "They won't receive texts from you until the opt-out is removed. " +
            "This is recorded in the conversation timeline.",
        "thread.optOut" to "Opt out",
        "thread.optOutOfTexts" to "Opt out of texts",
        "thread.revokeTitle" to "Remove the opt-out?",
        "thread.revokeBody" to
            "You'll be able to text this customer again. Only do this if they " +
            "asked to hear from you.",
        "thread.removeOptOut" to "Remove opt-out",
        "thread.carrierStopNote" to
            "This customer texted STOP. Only they can undo it, by texting START " +
            "to your number.",

        // --- Assignment ------------------------------------------------------
        "thread.assignTo" to "Assign to",
        "thread.assignToEllipsis" to "Assign to…",
        "thread.assignedTo" to "Assigned to {name}",
        "thread.unassigned" to "Unassigned",

        // --- Spam (#250) -----------------------------------------------------
        "thread.spam" to "Spam",
        "thread.spamTitle" to "This looks like spam",
        "thread.notSpam" to "Not spam",
        "thread.spamBody" to
            "We didn't send a notification for it. Nothing is hidden, and you " +
            "can reply as normal.",

        // --- Snooze (#293) ----------------------------------------------------
        "thread.bringBack" to "Bring back",
        "thread.bringBackNow" to "Bring back now",
        "thread.cancelReminder" to "Cancel the reminder",
        "thread.snoozeUntil" to "Snooze until",
        "thread.remindMeToChase" to "Remind me to chase",
        "thread.pickADate" to "Pick a date…",
        "thread.remindMe" to "Remind me",
        "thread.snooze" to "Snooze",
        "thread.whyOptional" to "Why? (optional)",

        // --- Pinned ------------------------------------------------------------
        "thread.pinned" to "Pinned",
        "thread.pinnedCount" to "Pinned · {count}",
        "thread.collapse" to "Collapse",
        "thread.expand" to "Expand",

        // --- Timeline visibility -------------------------------------------------
        "thread.showMessages" to "Show messages",
        "thread.showNotes" to "Show notes",
        "thread.showEvents" to "Show events",

        // --- Message bubbles + long-press actions ---------------------------------
        "thread.internalNote" to "Internal note",
        "thread.noteOnTask" to "on: {title}",
        "thread.openTask" to "Open task",
        "thread.hasTask" to "Has a task",
        "thread.openTheTask" to "Open the task",
        "thread.goToMessage" to "Go to that message",
        "thread.photoUnavailable" to "Photo unavailable · tap to retry",
        "thread.copyText" to "Copy text",
        "thread.done" to "Done",
        "thread.retrySend" to "Retry send",
        "thread.makeTask" to "Make a task",

        // --- Make a task (#214) ------------------------------------------------
        "thread.newTask" to "New task",
        "thread.newTaskFrom" to "From {name}'s message · posts to the thread",
        "thread.taskTitle" to "Title",
        "thread.taskTitleFallback" to "Follow up",
        "thread.due" to "Due",
        "thread.dueToday" to "Today",
        "thread.dueTomorrow9" to "Tomorrow 9 AM",
        "thread.pickATime" to "Pick a time…",
        "thread.createTask" to "Create task",
        "thread.setDueDate" to "Set due date",
        "thread.nobodyYet" to "Nobody yet",
        "thread.suggested" to "Suggested",
        "thread.addressSection" to "Address",
        "thread.clear" to "Clear",
        "thread.showAddress" to "Show address",
        "thread.hideAddress" to "Hide address",
        "thread.addrStreet" to "Street",
        "thread.addrUnit" to "Unit / suite",
        "thread.addrCity" to "City",
        "thread.addrState" to "State / province",
        "thread.addrPostal" to "Postal code",

        // --- Contact panel (#165 / #301) -----------------------------------------
        "thread.openFullContact" to "Open the full contact",
        "thread.sectionDetails" to "Details",
        "thread.sectionConsent" to "Consent",
        "thread.sectionLeadSource" to "Where they came from",
        "thread.sectionTasks" to "Tasks in this conversation",
        "thread.sectionOtherConversations" to "Other conversations",
        "thread.fieldName" to "Name",
        "thread.addName" to "Add a name",
        "thread.fieldAddress" to "Address",
        "thread.addAddress" to "Add an address",
        "thread.fieldNotes" to "Notes",
        "thread.notesPlaceholder" to
            "Gate code, dog's name, preferred arrival window…",
        "thread.leadFromLine" to "{name} · the line they called",
        "thread.leadSaidSo" to "{name} · somebody said so",
        "thread.leadAsk" to "Ask them: how did you hear about us?",
        "thread.dontKnow" to "Don't know",
        "thread.tasksLoadFailed" to "Couldn't load this conversation's tasks.",
        "thread.noTasks" to "No tasks in this conversation.",
        "thread.priorLoadFailed" to "Couldn't load prior conversations.",
        "thread.noOtherConversations" to "No other conversations with this contact.",

        // --- The catch-up card (#247) ----------------------------------------------
        "thread.summaryReading" to "Reading the thread…",
        "thread.summaryReady" to "Lou's catch-up",
        "thread.summaryRetry" to "Try the catch-up again",
        "thread.summaryOffer" to "Catch me up",
        "thread.summaryTruncated" to
            "The thread is longer than this — Lou read the most recent part.",
        "thread.summaryLineAria" to "{text}. Open the message this came from.",

        // --- Scheduled strip (#233) ---------------------------------------------
        "thread.scheduledWaiting" to "Waiting",
        "thread.cancelScheduledAria" to "Cancel the message scheduled for {when}",

        // --- Asking for payment (#224), the parts payments.* does not carry --------
        "thread.askAmountLabel" to "Amount in {currency}",
        "thread.askDefaultDescription" to "Deposit",
        "thread.yourBusiness" to "Your business",
        "thread.askFootnote" to
            "Goes out as a text with a secure payment link. The money lands in " +
            "your bank account — we take nothing on top.",

        // --- Photos & files (#165 / #317) ------------------------------------------
        "thread.photosAndFiles" to "Photos & files",
        "thread.backToConversation" to "Back to conversation",
        "thread.galleryImages" to "Images",
        "thread.galleryFiles" to "Files",
        "thread.noPhotosLoaded" to "No photos loaded yet.",
        "thread.noPhotosYet" to "No photos in this conversation yet.",
        "thread.noFilesLoaded" to "No files loaded yet.",
        "thread.noFilesYet" to "No files in this conversation yet.",
        "thread.loadMore" to "Load more",
        "thread.noAppForFile" to "No app on this device can open that file.",
        "thread.fileActions" to "Actions for {name}",
        "thread.reportThisFile" to "Report this file",
        "thread.reportPhotoAction" to "Report this photo",
        "thread.reportFileTitle" to "Report this file?",
        "thread.reportFileBody" to
            "Nobody on your team will be able to open {name} until an owner or " +
            "admin releases it. Nothing is deleted.",
        "thread.reporting" to "Reporting…",
        "thread.reportFile" to "Report file",
        "thread.reportFileFailed" to "Couldn't report that file. Try again.",
        "thread.playAudio" to "Play audio message",
        "thread.pauseAudio" to "Pause audio message",

        // --- The composer ------------------------------------------------------------
        "thread.modeText" to "Text",
        "thread.modeNote" to "Note",
        "thread.textPlaceholder" to "Text message",
        "thread.notePlaceholder" to "Write an internal note…",
        "thread.addToMessage" to "Add to message",
        "thread.attachFiles" to "Attach files",
        "thread.attachFilesToNote" to "Attach files to this note",
        "thread.savedReply" to "Saved reply",
        "thread.sendLater" to "Send later",
        "thread.sendMessage" to "Send message",
        "thread.saveNote" to "Save note",
        "thread.attachedPhoto" to "Attached photo",
        "thread.removePhoto" to "Remove photo",
        "thread.removeNamed" to "Remove {name}",
        "thread.attachLimitText" to "You can attach up to {max} files per text.",
        "thread.attachLimitNote" to "Notes can carry up to 10 files.",
        "thread.sendsAs" to "Sends as: ",
        "thread.mmsSegments" to "MMS · sent in {count} parts",
        "thread.sentInOnePart" to "Sent in 1 part",
        "thread.sentInParts" to "Sent in {count} parts",
        "thread.callThemInstead" to "Call them instead",
        "thread.reportThis" to "Report this",

        // --- The send boundary (#408) ---------------------------------------------
        "thread.collisionTitle" to "Somebody already answered",
        "thread.collisionAsk" to " Send yours as well?",
        "thread.sendAnyway" to "Send anyway",
        "thread.letMeLook" to "Let me look",

        // --- Lou in the composer ----------------------------------------------------
        "thread.draftWithLou" to "Draft with Lou",
        "thread.finishWithLou" to "Finish with Lou",
        "thread.drafting" to "Drafting…",
        "thread.lousDrafts" to "Lou's drafts",
        "thread.dismiss" to "Dismiss",
        "thread.louNeedsBusiness" to
            "Lou doesn't know what you do yet. Tell it, and drafts get specific.",

        // --- The dictated wrap-up (#507) ----------------------------------------------
        "thread.holdToDictate" to "Hold to say what the call was about",
        "thread.wrapUpRecording" to
            "Say what the call was about — {elapsed}. Let go when you're done.",
        "thread.wrapUpWriting" to "Writing your words down…",
        "thread.wrapUpLost" to
            "That recording was lost — something else may have taken the " +
            "microphone. Try again, or type the note.",
        "thread.micAllowed" to
            "Microphone allowed. Hold it and say what the call was about.",
        "thread.micDeniedWrapUp" to
            "Loonext needs the microphone to write down a spoken wrap-up. Type " +
            "the note instead, or allow it in Settings › Apps › Loonext › " +
            "Permissions.",
        "thread.micStartFailed" to
            "Couldn't start the microphone. Something else may be using it — " +
            "type the note instead.",

        // --- Mentions -------------------------------------------------------------------
        "thread.mentionTeammate" to "Mention a teammate",
        "thread.noMentionable" to "No teammates can see this conversation.",

        // --- Saved replies (#274 / #475) ----------------------------------------------
        "thread.templates" to "Templates",
        "thread.savedReplies" to "Saved replies",
        "thread.noTemplates" to
            "No saved replies yet. Create them on the web under Settings.",
        "thread.nothingMatches" to "Nothing matches.",
        "thread.templateHint" to
            "Type / in the composer to open these inline · shared with the crew",
        "thread.searchTemplates" to "Search templates…",
        "thread.insert" to "Insert",

        // --- Send later (#233 / #539) ---------------------------------------------------
        "thread.scheduledConfirm" to "Sending {when}.",
        "thread.next" to "Next",
        "thread.sendAt" to "Send at",
        "thread.schedule" to "Schedule",
        "thread.quietHoursTitle" to "That lands late where they are",
        "thread.scheduleAnyway" to "Schedule it anyway",
        "thread.pickAnotherTime" to "Pick another time",

        // --- Marking up a photo (#294) ---------------------------------------------------
        "thread.markupTitle" to "Point at something",
        "thread.workPhaseAria" to "What these photos show",

        // --- What a file is, in a chip or a bubble (#189) ---------------------------------
        "thread.mmsKindImage" to "Image",
        "thread.mmsKindAudio" to "Audio",
        "thread.mmsKindVideo" to "Video",
        "thread.mmsKindContact" to "Contact card",
        "thread.mmsKindCalendar" to "Calendar invite",
        "thread.mmsKindDocument" to "PDF",
        "thread.mmsKindText" to "Text file",
        "thread.mmsKindFile" to "File",

        // --- Starting a conversation (#183) ------------------------------------------------
        "thread.newTextTitle" to "New text",
        "thread.numberNotReady" to "Your number isn't ready yet.",
        "thread.numberNotReadyBody" to
            "You need an active number to start a conversation. Check the web " +
            "app for its status.",
        "thread.toLabel" to "To",
        "thread.messageLabel" to "Message",
        "thread.recipientPlaceholder" to "Name or phone number",
        "thread.clearRecipient" to "Clear recipient",
        "thread.nanpOnly" to "US and Canadian numbers only.",
        "thread.noContactMatch" to
            "No match in contacts. This starts a new conversation.",
        "thread.willText" to "Will text {number}",
        "thread.fromNumber" to "From: {number}",
        "thread.charactersWithMeter" to "{meter} · {count} characters",
        "thread.characters" to "{count} characters",
        "thread.consentAsked" to "This customer asked us to text them.",
        "thread.consentRecorded" to
            "Required for new contacts. Consent is recorded with your name.",
        "thread.sendText" to "Send text",
        "thread.lateThereTitle" to "It's late where they are",
        "thread.lateThereBody" to "It's {time} at this number. Send anyway?",
        "thread.lateThereUnknown" to "between 8pm and 8am",
        "thread.wait" to "Wait",
        "thread.theirTimeAskFirst" to
            "It's {time} for this customer. We'll ask before sending this late.",
        "thread.theirTime" to "It's {time} for them.",
    )

    override val frCA = mapOf(
        // --- The thread itself -------------------------------------------
        "thread.notFound" to "Cette conversation n'existe pas ou a été supprimée.",
        "thread.backToInbox" to "Retour à la boîte de réception",
        "thread.noMessages" to "Aucun message pour l'instant.",
        "thread.newMessagePill" to "Nouveau message",
        "thread.copied" to "Copié.",
        "thread.more" to "Plus",
        "thread.callContact" to "Appeler {name}",
        "thread.optedOut" to "Désabonné",
        "thread.contactFallback" to "Contact",
        "thread.conversationFallback" to "Conversation",
        "thread.viewContact" to "Voir le contact",
        "thread.photo" to "Photo",
        "thread.file" to "Fichier",
        "thread.teammate" to "Collègue",
        "thread.you" to "Vous",
        "thread.youSuffix" to " (vous)",
        "thread.selected" to "Sélectionné",
        "thread.micNeededForCalls" to
            "Loonext a besoin du micro pour passer des appels. " +
            "Autorisez-le dans Paramètres › Applis › Loonext › Autorisations.",

        // --- Status ------------------------------------------------------
        "thread.statusHeading" to "STATUT",
        "thread.statusNew" to "Nouveau",
        "thread.statusOpen" to "Ouvert",
        "thread.statusWaiting" to "En attente",
        "thread.statusClosed" to "Fermé",

        // --- Day dividers -------------------------------------------------
        "thread.dayToday" to "Aujourd'hui",
        "thread.dayYesterday" to "Hier",

        // --- Queued sends (#234) -------------------------------------------
        "thread.deleteQueuedTitle" to "Supprimer ce message ?",
        "thread.deleteQueuedBody" to
            "Il n'a pas été envoyé, et le supprimer ici efface la seule copie.",
        "thread.keepIt" to "Le garder",
        "thread.queuedOffline" to
            "En file d'attente — s'enverra dès votre retour en ligne",
        "thread.sending" to "Envoi…",
        "thread.sent" to "Envoyé",
        "thread.delivered" to "Livré",
        "thread.sendNow" to "Envoyer maintenant",
        "thread.retry" to "Réessayer",
        "thread.oneAttachment" to "1 pièce jointe",
        "thread.manyAttachments" to "{count} pièces jointes",

        // --- Tags ----------------------------------------------------------
        "thread.tags" to "Étiquettes",
        "thread.addTag" to "Ajouter une étiquette",
        "thread.removeTag" to "Retirer l'étiquette {name}",
        "thread.addOrCreateTag" to "Ajouter ou créer une étiquette",
        "thread.findTag" to "Trouver une étiquette",
        "thread.create" to "Créer",
        "thread.add" to "Ajouter",
        "thread.didYouMean" to "Vouliez-vous dire « {name} » ?",
        "thread.tagsLocked" to
            "Aucune étiquette de ce nom. Demandez à un administrateur de " +
            "l'ajouter — cet espace de travail garde une liste fixe.",
        "thread.noTagsCreate" to
            "Aucune étiquette pour l'instant. Créez la première ci-dessus.",
        "thread.noTagsAdmin" to
            "Aucune étiquette pour l'instant. Un administrateur ajoute la première.",
        "thread.attached" to "Attachée",

        // --- Opt-out (#407) --------------------------------------------------
        "thread.optOutTitle" to "Désabonner ce client ?",
        "thread.optOutBody" to
            "Il ne recevra plus vos textos tant que le désabonnement n'est pas " +
            "retiré. C'est inscrit dans l'historique de la conversation.",
        "thread.optOut" to "Désabonner",
        "thread.optOutOfTexts" to "Désabonner des textos",
        "thread.revokeTitle" to "Retirer le désabonnement ?",
        "thread.revokeBody" to
            "Vous pourrez de nouveau texter ce client. Ne faites ceci que s'il " +
            "a demandé à recevoir vos messages.",
        "thread.removeOptOut" to "Retirer le désabonnement",
        "thread.carrierStopNote" to
            "Ce client a texté STOP. Lui seul peut annuler cela, en textant " +
            "START à votre numéro.",

        // --- Assignment ------------------------------------------------------
        "thread.assignTo" to "Assigner à",
        "thread.assignToEllipsis" to "Assigner à…",
        "thread.assignedTo" to "Assignée à {name}",
        "thread.unassigned" to "Non assignée",

        // --- Spam (#250) -----------------------------------------------------
        "thread.spam" to "Pourriel",
        "thread.spamTitle" to "Ceci ressemble à un pourriel",
        "thread.notSpam" to "Pas un pourriel",
        "thread.spamBody" to
            "Nous n'avons pas envoyé de notification. Rien n'est caché, et vous " +
            "pouvez répondre normalement.",

        // --- Snooze (#293) ----------------------------------------------------
        "thread.bringBack" to "Ramener",
        "thread.bringBackNow" to "Ramener maintenant",
        "thread.cancelReminder" to "Annuler le rappel",
        "thread.snoozeUntil" to "Reporter jusqu'à",
        "thread.remindMeToChase" to "Me rappeler de relancer",
        "thread.pickADate" to "Choisir une date…",
        "thread.remindMe" to "Me rappeler",
        "thread.snooze" to "Reporter",
        "thread.whyOptional" to "Pourquoi ? (facultatif)",

        // --- Pinned ------------------------------------------------------------
        "thread.pinned" to "Épinglé",
        "thread.pinnedCount" to "Épinglés · {count}",
        "thread.collapse" to "Réduire",
        "thread.expand" to "Développer",

        // --- Timeline visibility -------------------------------------------------
        "thread.showMessages" to "Afficher les textos",
        "thread.showNotes" to "Afficher les notes",
        "thread.showEvents" to "Afficher les évènements",

        // --- Message bubbles + long-press actions ---------------------------------
        "thread.internalNote" to "Note interne",
        "thread.noteOnTask" to "sur : {title}",
        "thread.openTask" to "Ouvrir la tâche",
        "thread.hasTask" to "A une tâche",
        "thread.openTheTask" to "Ouvrir la tâche",
        "thread.goToMessage" to "Aller à ce message",
        "thread.photoUnavailable" to "Photo indisponible · touchez pour réessayer",
        "thread.copyText" to "Copier le texte",
        "thread.done" to "Fait",
        "thread.retrySend" to "Renvoyer",
        "thread.makeTask" to "Créer une tâche",

        // --- Make a task (#214) ------------------------------------------------
        "thread.newTask" to "Nouvelle tâche",
        "thread.newTaskFrom" to
            "Depuis le message de {name} · publié dans la conversation",
        "thread.taskTitle" to "Titre",
        "thread.taskTitleFallback" to "Faire un suivi",
        "thread.due" to "Échéance",
        "thread.dueToday" to "Aujourd'hui",
        "thread.dueTomorrow9" to "Demain 9 h",
        "thread.pickATime" to "Choisir une heure…",
        "thread.createTask" to "Créer la tâche",
        "thread.setDueDate" to "Fixer l'échéance",
        "thread.nobodyYet" to "Personne encore",
        "thread.suggested" to "Suggéré",
        "thread.addressSection" to "Adresse",
        "thread.clear" to "Effacer",
        "thread.showAddress" to "Afficher l'adresse",
        "thread.hideAddress" to "Masquer l'adresse",
        "thread.addrStreet" to "Rue",
        "thread.addrUnit" to "Unité / suite",
        "thread.addrCity" to "Ville",
        "thread.addrState" to "Province / État",
        "thread.addrPostal" to "Code postal",

        // --- Contact panel (#165 / #301) -----------------------------------------
        "thread.openFullContact" to "Ouvrir la fiche complète",
        "thread.sectionDetails" to "Coordonnées",
        "thread.sectionConsent" to "Consentement",
        "thread.sectionLeadSource" to "D'où il vient",
        "thread.sectionTasks" to "Tâches de cette conversation",
        "thread.sectionOtherConversations" to "Autres conversations",
        "thread.fieldName" to "Nom",
        "thread.addName" to "Ajouter un nom",
        "thread.fieldAddress" to "Adresse",
        "thread.addAddress" to "Ajouter une adresse",
        "thread.fieldNotes" to "Notes",
        "thread.notesPlaceholder" to
            "Code de barrière, nom du chien, heure d'arrivée préférée…",
        "thread.leadFromLine" to "{name} · la ligne qu'il a appelée",
        "thread.leadSaidSo" to "{name} · quelqu'un l'a indiqué",
        "thread.leadAsk" to "Demandez-lui : comment nous avez-vous connus ?",
        "thread.dontKnow" to "Je ne sais pas",
        "thread.tasksLoadFailed" to
            "Impossible de charger les tâches de cette conversation.",
        "thread.noTasks" to "Aucune tâche dans cette conversation.",
        "thread.priorLoadFailed" to
            "Impossible de charger les conversations précédentes.",
        "thread.noOtherConversations" to "Aucune autre conversation avec ce client.",

        // --- The catch-up card (#247) ----------------------------------------------
        "thread.summaryReading" to "Lecture de la conversation…",
        "thread.summaryReady" to "Le résumé de Lou",
        "thread.summaryRetry" to "Réessayer le résumé",
        "thread.summaryOffer" to "Faites-moi un résumé",
        "thread.summaryTruncated" to
            "La conversation est plus longue que ceci — Lou a lu la partie la " +
            "plus récente.",
        "thread.summaryLineAria" to "{text}. Ouvrir le message d'où ceci provient.",

        // --- Scheduled strip (#233) ---------------------------------------------
        "thread.scheduledWaiting" to "En attente",
        "thread.cancelScheduledAria" to "Annuler le message prévu pour {when}",

        // --- Asking for payment (#224), the parts payments.* does not carry --------
        "thread.askAmountLabel" to "Montant en {currency}",
        "thread.askDefaultDescription" to "Acompte",
        "thread.yourBusiness" to "Votre entreprise",
        "thread.askFootnote" to
            "Part sous forme de texto avec un lien de paiement sécurisé. " +
            "L'argent arrive dans votre compte bancaire — nous ne prenons rien " +
            "de plus.",

        // --- Photos & files (#165 / #317) ------------------------------------------
        "thread.photosAndFiles" to "Photos et fichiers",
        "thread.backToConversation" to "Retour à la conversation",
        "thread.galleryImages" to "Images",
        "thread.galleryFiles" to "Fichiers",
        "thread.noPhotosLoaded" to "Aucune photo chargée pour l'instant.",
        "thread.noPhotosYet" to "Aucune photo dans cette conversation.",
        "thread.noFilesLoaded" to "Aucun fichier chargé pour l'instant.",
        "thread.noFilesYet" to "Aucun fichier dans cette conversation.",
        "thread.loadMore" to "Charger plus",
        "thread.noAppForFile" to
            "Aucune application sur cet appareil ne peut ouvrir ce fichier.",
        "thread.fileActions" to "Actions pour {name}",
        "thread.reportThisFile" to "Signaler ce fichier",
        "thread.reportPhotoAction" to "Signaler cette photo",
        "thread.reportFileTitle" to "Signaler ce fichier ?",
        "thread.reportFileBody" to
            "Personne dans votre équipe ne pourra ouvrir {name} tant qu'un " +
            "propriétaire ou un administrateur ne l'aura pas débloqué. Rien " +
            "n'est supprimé.",
        "thread.reporting" to "Signalement…",
        "thread.reportFile" to "Signaler le fichier",
        "thread.reportFileFailed" to
            "Impossible de signaler ce fichier. Réessayez.",
        "thread.playAudio" to "Écouter le message vocal",
        "thread.pauseAudio" to "Mettre le message vocal en pause",

        // --- The composer ------------------------------------------------------------
        "thread.modeText" to "Texto",
        "thread.modeNote" to "Note",
        "thread.textPlaceholder" to "Texto",
        "thread.notePlaceholder" to "Écrire une note interne…",
        "thread.addToMessage" to "Ajouter au message",
        "thread.attachFiles" to "Joindre des fichiers",
        "thread.attachFilesToNote" to "Joindre des fichiers à cette note",
        "thread.savedReply" to "Réponse enregistrée",
        "thread.sendLater" to "Envoyer plus tard",
        "thread.sendMessage" to "Envoyer le message",
        "thread.saveNote" to "Enregistrer la note",
        "thread.attachedPhoto" to "Photo jointe",
        "thread.removePhoto" to "Retirer la photo",
        "thread.removeNamed" to "Retirer {name}",
        "thread.attachLimitText" to
            "Vous pouvez joindre jusqu'à {max} fichiers par texto.",
        "thread.attachLimitNote" to
            "Une note peut porter jusqu'à 10 fichiers.",
        "thread.sendsAs" to "S'envoie ainsi : ",
        "thread.mmsSegments" to "MMS · envoyé en {count} parties",
        "thread.sentInOnePart" to "Envoyé en 1 partie",
        "thread.sentInParts" to "Envoyé en {count} parties",
        "thread.callThemInstead" to "Appelez-le plutôt",
        "thread.reportThis" to "Signaler ceci",

        // --- The send boundary (#408) ---------------------------------------------
        "thread.collisionTitle" to "Quelqu'un a déjà répondu",
        "thread.collisionAsk" to " Envoyer le vôtre quand même ?",
        "thread.sendAnyway" to "Envoyer quand même",
        "thread.letMeLook" to "Laissez-moi voir",

        // --- Lou in the composer ----------------------------------------------------
        "thread.draftWithLou" to "Rédiger avec Lou",
        "thread.finishWithLou" to "Terminer avec Lou",
        "thread.drafting" to "Rédaction…",
        "thread.lousDrafts" to "Les brouillons de Lou",
        "thread.dismiss" to "Fermer",
        "thread.louNeedsBusiness" to
            "Lou ne sait pas encore ce que vous faites. Dites-le-lui, et les " +
            "brouillons deviendront précis.",

        // --- The dictated wrap-up (#507) ----------------------------------------------
        "thread.holdToDictate" to "Maintenez pour dire de quoi parlait l'appel",
        "thread.wrapUpRecording" to
            "Dites de quoi parlait l'appel — {elapsed}. Relâchez quand vous " +
            "avez terminé.",
        "thread.wrapUpWriting" to "Transcription de vos mots…",
        "thread.wrapUpLost" to
            "Cet enregistrement a été perdu — autre chose a peut-être pris le " +
            "micro. Réessayez, ou tapez la note.",
        "thread.micAllowed" to
            "Micro autorisé. Maintenez-le et dites de quoi parlait l'appel.",
        "thread.micDeniedWrapUp" to
            "Loonext a besoin du micro pour transcrire un compte rendu parlé. " +
            "Tapez la note, ou autorisez-le dans Paramètres › Applis › Loonext " +
            "› Autorisations.",
        "thread.micStartFailed" to
            "Impossible de démarrer le micro. Autre chose l'utilise peut-être — " +
            "tapez la note.",

        // --- Mentions -------------------------------------------------------------------
        "thread.mentionTeammate" to "Mentionner un collègue",
        "thread.noMentionable" to "Personne de l'équipe ne voit cette conversation.",

        // --- Saved replies (#274 / #475) ----------------------------------------------
        "thread.templates" to "Modèles",
        "thread.savedReplies" to "Réponses enregistrées",
        "thread.noTemplates" to
            "Aucune réponse enregistrée. Créez-les sur le web dans Paramètres.",
        "thread.nothingMatches" to "Aucun résultat.",
        "thread.templateHint" to
            "Tapez / dans la zone de rédaction pour les ouvrir · partagées avec " +
            "l'équipe",
        "thread.searchTemplates" to "Rechercher des modèles…",
        "thread.insert" to "Insérer",

        // --- Send later (#233 / #539) ---------------------------------------------------
        "thread.scheduledConfirm" to "Envoi {when}.",
        "thread.next" to "Suivant",
        "thread.sendAt" to "Envoyer à",
        "thread.schedule" to "Programmer",
        "thread.quietHoursTitle" to "Ça arrive tard chez lui",
        "thread.scheduleAnyway" to "Programmer quand même",
        "thread.pickAnotherTime" to "Choisir une autre heure",

        // --- Marking up a photo (#294) ---------------------------------------------------
        "thread.markupTitle" to "Pointer quelque chose",
        "thread.workPhaseAria" to "Ce que montrent ces photos",

        // --- What a file is, in a chip or a bubble (#189) ---------------------------------
        "thread.mmsKindImage" to "Image",
        "thread.mmsKindAudio" to "Audio",
        "thread.mmsKindVideo" to "Vidéo",
        "thread.mmsKindContact" to "Fiche de contact",
        "thread.mmsKindCalendar" to "Invitation d'agenda",
        "thread.mmsKindDocument" to "PDF",
        "thread.mmsKindText" to "Fichier texte",
        "thread.mmsKindFile" to "Fichier",

        // --- Starting a conversation (#183) ------------------------------------------------
        "thread.newTextTitle" to "Nouveau texto",
        "thread.numberNotReady" to "Votre numéro n'est pas encore prêt.",
        "thread.numberNotReadyBody" to
            "Il vous faut un numéro actif pour démarrer une conversation. " +
            "Vérifiez son état dans l'application web.",
        "thread.toLabel" to "À",
        "thread.messageLabel" to "Message",
        "thread.recipientPlaceholder" to "Nom ou numéro de téléphone",
        "thread.clearRecipient" to "Effacer le destinataire",
        "thread.nanpOnly" to "Numéros américains et canadiens seulement.",
        "thread.noContactMatch" to
            "Aucune correspondance dans les contacts. Ceci démarre une nouvelle " +
            "conversation.",
        "thread.willText" to "Textera {number}",
        "thread.fromNumber" to "De : {number}",
        "thread.charactersWithMeter" to "{meter} · {count} caractères",
        "thread.characters" to "{count} caractères",
        "thread.consentAsked" to "Ce client nous a demandé de le texter.",
        "thread.consentRecorded" to
            "Requis pour les nouveaux contacts. Le consentement est inscrit à " +
            "votre nom.",
        "thread.sendText" to "Envoyer le texto",
        "thread.lateThereTitle" to "Il est tard chez lui",
        "thread.lateThereBody" to "Il est {time} à ce numéro. Envoyer quand même ?",
        "thread.lateThereUnknown" to "entre 20 h et 8 h",
        "thread.wait" to "Attendre",
        "thread.theirTimeAskFirst" to
            "Il est {time} chez ce client. Nous demanderons avant d'envoyer si tard.",
        "thread.theirTime" to "Il est {time} chez lui.",
    )
}
