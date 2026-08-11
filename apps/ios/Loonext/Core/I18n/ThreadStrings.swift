import Foundation

/// #228 — the conversation: its timeline, its composer, and the files that ride
/// on both (`Features/Thread`, `Features/Compose`, `Features/Attachments`).
///
/// The busiest surface in the product, so it is also the one where a half-English
/// screen is most obvious: a crew member reads this all day and reads the
/// settings index twice a year.
///
/// ## It is the Android catalogue's twin, on purpose
///
/// Every key here that Android's `ThreadStrings.kt` already has keeps that key's
/// NAME and its exact English and French. A crew that switches devices must not
/// meet a different product, and two catalogues that agree about the sentence
/// but disagree about the key are two catalogues that drift the next time one of
/// them is edited.
///
/// The keys Android does not have are the ones iOS says something Android does
/// not — a permission path that reads `Settings › Loonext` rather than
/// `Paramètres › Applis`, a wrap-up status line written for a press-and-hold
/// mic, the make-a-task placeholders. Those are named by MEANING in the same
/// `thread.camelCase` shape, so a later Android change can adopt them.
///
/// ## The register
///
/// `CommonStrings`': Quebec French, VOUVOIEMENT, accents spelled normally, a
/// normal space before `:`. Product names (Loonext, Lou, Stripe, Telnyx) and the
/// carrier keywords (STOP / START / HELP / URGENT) are never translated — a
/// carrier matches on the keyword, and a customer told to text "ARRÊT" will not
/// be unsubscribed by anybody.
///
/// The shared vocabulary, so the phone and the laptop agree word for word:
/// texto · conversation · client · équipe · espace de travail · numéro · tâche ·
/// rappel · devis · acompte · forfait · facturation · paramètres ·
/// boîte de réception.
enum ThreadStrings {
    static let section = AppStrings.Section(
        name: "ThreadStrings",
        en: [
            // --- The thread itself ---------------------------------------
            "thread.notFound": "This conversation doesn't exist or was removed.",
            "thread.backToInbox": "Back to inbox",
            "thread.noMessages": "No messages yet.",
            "thread.newMessagePill": "New message",
            "thread.callContact": "Call {name}",
            "thread.optedOut": "Opted out",
            "thread.conversationFallback": "Conversation",
            "thread.viewContact": "View contact",
            "thread.photo": "Photo",
            "thread.file": "File",
            "thread.teammate": "Teammate",
            "thread.youSuffix": " (you)",
            "thread.conversationOptions": "Conversation options for {name}",
            "thread.conversationOptionsBadge":
                "Conversation options for {name}, {badge}",
            // The iOS permission path, not Android's. One key, two true
            // sentences: a member sent to "Settings › Apps › Loonext" on an
            // iPhone is being sent somewhere that does not exist.
            "thread.micNeededForCalls":
                "Loonext needs the microphone to place calls. "
                + "Allow it in Settings › Loonext.",

            // --- Status ---------------------------------------------------
            "thread.statusHeading": "STATUS",
            "thread.statusNew": "New",
            "thread.statusOpen": "Open",
            "thread.statusWaiting": "Waiting",
            "thread.statusClosed": "Closed",

            // --- Day dividers ---------------------------------------------
            "thread.dayToday": "Today",
            "thread.dayYesterday": "Yesterday",

            // --- Queued sends (#234) --------------------------------------
            "thread.deleteQueuedTitle": "Delete this message?",
            "thread.deleteQueuedBody":
                "It hasn't been sent, and deleting it here is the only copy gone.",
            "thread.keepIt": "Keep it",
            "thread.queuedOffline": "Queued — will send when you're back online",
            "thread.sending": "Sending…",
            "thread.sent": "Sent",
            "thread.delivered": "Delivered",
            "thread.sendNow": "Send now",
            "thread.retry": "Retry",
            "thread.onePhoto": "1 photo",
            "thread.manyPhotos": "{count} photos",

            // --- Tags ------------------------------------------------------
            "thread.tags": "Tags",
            "thread.addTag": "Add tag",
            "thread.manageTags": "Manage tags",
            "thread.removeTag": "Remove tag {name}",
            "thread.addTagNamed": "Add tag {name}",
            "thread.addOrCreateTag": "Add or create a tag",
            "thread.findTag": "Find a tag",
            "thread.create": "Create",
            "thread.add": "Add",
            "thread.didYouMean": "Did you mean “{name}”?",
            "thread.tagsLocked":
                "No tag by that name. Ask an admin to add it — this workspace keeps "
                + "a set list.",
            "thread.noTagsCreate": "No tags yet. Create the first one above.",
            "thread.noTagsAdmin": "No tags yet. An admin adds the first one.",

            // --- Opt-out (#407) ---------------------------------------------
            "thread.optOutTitle": "Opt this customer out?",
            "thread.optOutBody":
                "They won't receive texts from you until the opt-out is removed. "
                + "This is recorded in the conversation timeline.",
            "thread.optOut": "Opt out",
            "thread.optOutOfTexts": "Opt out of texts",
            "thread.revokeTitle": "Remove the opt-out?",
            "thread.revokeBody":
                "You'll be able to text this customer again. Only do this if they "
                + "asked to hear from you.",
            "thread.removeOptOut": "Remove opt-out",
            "thread.carrierStopNote":
                "This customer texted STOP. Only they can undo it, by texting START "
                + "to your number.",

            // --- Assignment --------------------------------------------------
            "thread.assignTo": "Assign to",
            "thread.assignToEllipsis": "Assign to…",
            "thread.assignedTo": "Assigned to {name}",
            "thread.unassigned": "Unassigned",

            // --- Spam (#250) --------------------------------------------------
            "thread.spam": "Spam",
            "thread.spamTitle": "This looks like spam",
            "thread.notSpam": "Not spam",
            "thread.spamBody":
                "We didn't send a notification for it. Nothing is hidden, and you "
                + "can reply as normal.",

            // --- Snooze (#293) -------------------------------------------------
            "thread.bringBack": "Bring back",
            "thread.bringBackNow": "Bring back now",
            "thread.bringBackHint":
                "Brings this conversation back to your inbox now",
            "thread.cancelReminder": "Cancel the reminder",
            "thread.snoozeUntil": "Snooze until",
            "thread.remindMeToChase": "Remind me to chase",
            "thread.pickADate": "Pick a date…",
            "thread.remindMe": "Remind me",
            "thread.snooze": "Snooze",
            "thread.whyOptional": "Why? (optional)",
            "thread.returnDateTime": "Return date and time",
            "thread.snoozeExplainer":
                "It comes back to your inbox then — and immediately if the customer "
                + "replies before that.",
            "thread.followUpExplainer":
                "It comes back then as something to chase — unless they reply first, "
                + "in which case there is nothing to chase and the reminder "
                + "disappears.",

            // --- Pinned ----------------------------------------------------------
            "thread.pinned": "Pinned",
            "thread.pinnedCount": "Pinned · {count}",
            "thread.collapsePinned": "Collapse pinned",
            "thread.expandPinned": "Expand pinned",

            // --- Timeline visibility ------------------------------------------
            "thread.showMessages": "Show messages",
            "thread.showNotes": "Show notes",
            "thread.showEvents": "Show events",
            "thread.refresh": "Refresh",

            // --- Message bubbles + long-press actions ---------------------------
            "thread.internalNote": "Internal note",
            "thread.noteOnTask": "on: {title}",
            "thread.openTask": "Open task",
            "thread.openTaskNamed": "Open task {title}",
            "thread.reopenTaskNamed": "Reopen task {title}",
            "thread.markTaskDoneNamed": "Mark task {title} done",
            "thread.hasTask": "Has a task",
            "thread.openTheTask": "Open the task",
            "thread.goToMessage": "Go to that message",
            "thread.photoUnavailable": "Photo unavailable · tap to retry",
            "thread.copyText": "Copy text",
            "thread.done": "Done",
            "thread.retrySend": "Retry send",
            "thread.makeTask": "Make a task",

            // --- Make a task (#214) -----------------------------------------------
            "thread.newTask": "New task",
            "thread.newTaskFrom": "From {name}'s message · posts to the thread",
            "thread.taskTitle": "Title",
            "thread.taskTitlePlaceholder": "Task title",
            "thread.taskTitleFallback": "Follow up",
            "thread.due": "Due",
            "thread.dueOptional": "Due (optional)",
            "thread.addDueDate": "Add a due date",
            "thread.clearDueDate": "Clear due date",
            "thread.pickATime": "Pick a time…",
            "thread.createTask": "Create task",
            "thread.setDueDate": "Set due date",
            "thread.nobody": "Nobody",
            "thread.suggested": "Suggested",
            "thread.addressSection": "Address",
            "thread.clear": "Clear",
            "thread.clearAddress": "Clear address",
            "thread.addrStreet": "Street",
            "thread.addrUnit": "Unit / suite",
            "thread.addrCity": "City",
            "thread.addrState": "State / province",
            "thread.addrPostal": "Postal code",
            "thread.taskLineNote": "The thread shows the task line",

            // --- Contact panel (#165 / #301) ---------------------------------------
            "thread.openFullContact": "Open the full contact",
            "thread.sectionDetails": "Details",
            "thread.sectionConsent": "Consent",
            "thread.sectionLeadSource": "Where they came from",
            "thread.sectionTasks": "Tasks in this conversation",
            "thread.sectionOtherConversations": "Other conversations",
            "thread.fieldName": "Name",
            "thread.addName": "Add a name",
            "thread.fieldAddress": "Address",
            "thread.addAddress": "Add an address",
            "thread.fieldNotes": "Notes",
            "thread.notesPlaceholder":
                "Gate code, dog's name, preferred arrival window…",
            "thread.saveFailed": "Couldn't save. Check your connection.",
            "thread.leadFromLine": "{name} · the line they called",
            "thread.leadSaidSo": "{name} · somebody said so",
            "thread.leadAsk": "Ask them: how did you hear about us?",
            "thread.dontKnow": "Don't know",
            "thread.tasksLoadFailed": "Couldn't load this conversation's tasks.",
            "thread.noTasks": "No tasks in this conversation.",
            "thread.priorLoadFailed": "Couldn't load prior conversations.",
            "thread.noOtherConversations":
                "No other conversations with this contact.",

            // --- The catch-up card (#247) --------------------------------------------
            "thread.summaryReading": "Reading the thread…",
            "thread.summaryReady": "Lou's catch-up",
            "thread.summaryOffer": "Catch me up",
            "thread.summaryOfferAria": "Catch me up on this thread",
            "thread.summaryOfferHint":
                "Lou reads the thread and shows what they asked, what you said, and "
                + "what's still open.",
            "thread.summaryHide": "Hide",
            "thread.summaryLineHint": "Opens the message this came from.",

            // --- Scheduled strip (#233) ------------------------------------------
            "thread.scheduledWaiting": "Waiting",
            "thread.cancelScheduledAria": "Cancel the message scheduled for {when}",

            // --- Photos & files (#165 / #317) --------------------------------------
            "thread.photosAndFiles": "Photos & files",
            "thread.backToConversation": "Back to conversation",
            "thread.galleryView": "View",
            "thread.galleryImages": "Images",
            "thread.galleryFiles": "Files",
            "thread.noPhotosLoaded": "No photos loaded yet.",
            "thread.noPhotosYet": "No photos in this conversation yet.",
            "thread.noFilesLoaded": "No files loaded yet.",
            "thread.noFilesYet": "No files in this conversation yet.",
            "thread.loadMore": "Load more",
            "thread.loadAnyway": "Load",
            "thread.fileCantOpen": "This file can't be opened.",
            "thread.reportThisFile": "Report this file",
            "thread.reportFileTitle": "Report this file?",
            "thread.reportFileBody":
                "Nobody on your team will be able to open {name} until an owner or "
                + "admin releases it. Nothing is deleted.",
            "thread.reportFile": "Report file",
            "thread.reportFileFailed": "Couldn't report that file. Try again.",
            "thread.playAudio": "Play audio message",
            "thread.pauseAudio": "Pause audio message",
            "thread.openAttachment": "Open {kind}",

            // --- The composer -------------------------------------------------------
            "thread.modeText": "Text",
            "thread.modeNote": "Note",
            "thread.textPlaceholder": "Text message",
            "thread.notePlaceholder": "Write an internal note…",
            "thread.addToMessage": "Add to message",
            "thread.attachPhoto": "Attach a photo",
            "thread.attachFile": "Attach a file",
            "thread.attachFilesToNote": "Attach files to this note",
            "thread.savedReply": "Saved reply",
            "thread.sendLater": "Send later",
            "thread.sendMessage": "Send message",
            "thread.saveNote": "Save note",
            "thread.removeAttachment": "Remove attachment",
            "thread.removeNamed": "Remove {name}",
            "thread.attachLimitPhotos":
                "You can attach up to {max} photos per text.",
            "thread.attachLimitText": "You can attach up to {max} files per text.",
            "thread.attachLimitNote": "Notes can carry up to 10 files.",
            "thread.photoReadFailed":
                "Couldn't read that photo. Try attaching it again.",
            "thread.sendsAs": "Sends as: ",
            "thread.callThemInstead": "Call them instead",
            "thread.reportThis": "Report this",

            // --- The send boundary (#408) -------------------------------------------
            "thread.collisionTitle": "Somebody already answered",
            "thread.collisionAsk": " Send yours as well?",
            "thread.sendAnyway": "Send anyway",
            "thread.letMeLook": "Let me look",

            // --- Lou in the composer -------------------------------------------------
            "thread.draftWithLou": "Draft with Lou",
            "thread.finishWithLou": "Finish with Lou",
            "thread.drafting": "Drafting…",
            "thread.lousDrafts": "Lou's drafts",
            "thread.dismiss": "Dismiss",
            "thread.louNeedsBusiness":
                "Lou doesn't know what you do yet. Tell it, and drafts get specific.",

            // --- The dictated wrap-up (#507) -------------------------------------------
            //
            // iOS holds the mic down rather than latching it, so the running
            // commentary is this platform's own sentence rather than Android's.
            "thread.holdToDictateWrapUp": "Hold to dictate a wrap-up",
            "thread.wrapUpHint":
                "Say what was agreed after the call. Lou writes your words down for "
                + "you to check before you post the note.",
            "thread.wrapUpTranscribing": "Writing down what you said…",
            "thread.wrapUpGoAhead": "Go ahead — let go when you're done",
            "thread.wrapUpGoAheadLeft": "Go ahead — {seconds}s left",
            "thread.wrapUpTooShort":
                "Hold the mic while you talk — that was too short to write down.",

            // --- Mentions ---------------------------------------------------------------
            "thread.mentionTeammate": "Mention a teammate",
            "thread.noMentionable": "No teammates can see this conversation.",

            // --- Saved replies (#274 / #475) ---------------------------------------------
            "thread.templates": "Templates",
            "thread.savedReplies": "Saved replies",
            "thread.noTemplates":
                "No saved replies yet. Create them on the web under Settings.",
            "thread.nothingMatches": "Nothing matches.",
            "thread.templateHint":
                "Type / in the composer to open these inline · shared with the crew",
            "thread.searchTemplates": "Search templates…",
            "thread.insert": "Insert",

            // --- Send later (#233 / #539) --------------------------------------------------
            "thread.sendAt": "Send at",
            "thread.schedule": "Schedule",
            "thread.whichClock": "Which clock",
            "thread.workspaceTime": "Your workspace's time",
            "thread.quietHoursTitle": "That lands late where they are",
            "thread.scheduleAnyway": "Schedule it anyway",
            "thread.pickAnotherTime": "Pick another time",

            // --- Marking up a photo (#294) -------------------------------------------------
            "thread.markupTitle": "Point at something",
            "thread.workPhaseAria": "What these photos show",

            // --- Starting a conversation (#183) ---------------------------------------------
            "thread.newTextTitle": "New text",
            "thread.numberNotReady": "Your number isn't ready yet.",
            "thread.numberNotReadyBody":
                "You need an active number to start a conversation. Check the web "
                + "app for its status.",
            "thread.toLabel": "To",
            "thread.messageLabel": "Message",
            "thread.recipientPlaceholder": "Name or phone number",
            "thread.clearRecipient": "Clear recipient",
            "thread.nanpOnly": "US and Canadian numbers only.",
            "thread.noContactMatch":
                "No match in contacts. This starts a new conversation.",
            "thread.willText": "Will text {number}",
            "thread.fromNumber": "From: {number}",
            "thread.sendText": "Send text",
            "thread.lateThereTitle": "It's late where they are",
            "thread.lateThereBody": "It's {time} at this number. Send anyway?",
            "thread.lateThereUnknown": "between 8pm and 8am",
            "thread.wait": "Wait",
            "thread.theirTimeAskFirst":
                "It's {time} for this customer. We'll ask before sending this late.",
            "thread.theirTime": "It's {time} for them.",
        ],
        frCA: [
            // --- The thread itself ---------------------------------------
            "thread.notFound": "Cette conversation n'existe pas ou a été supprimée.",
            "thread.backToInbox": "Retour à la boîte de réception",
            "thread.noMessages": "Aucun message pour l'instant.",
            "thread.newMessagePill": "Nouveau message",
            "thread.callContact": "Appeler {name}",
            "thread.optedOut": "Désabonné",
            "thread.conversationFallback": "Conversation",
            "thread.viewContact": "Voir le contact",
            "thread.photo": "Photo",
            "thread.file": "Fichier",
            "thread.teammate": "Collègue",
            "thread.youSuffix": " (vous)",
            "thread.conversationOptions": "Options de conversation pour {name}",
            "thread.conversationOptionsBadge":
                "Options de conversation pour {name}, {badge}",
            "thread.micNeededForCalls":
                "Loonext a besoin du micro pour passer des appels. "
                + "Autorisez-le dans Réglages › Loonext.",

            // --- Status ---------------------------------------------------
            "thread.statusHeading": "STATUT",
            "thread.statusNew": "Nouveau",
            "thread.statusOpen": "Ouvert",
            "thread.statusWaiting": "En attente",
            "thread.statusClosed": "Fermé",

            // --- Day dividers ---------------------------------------------
            "thread.dayToday": "Aujourd'hui",
            "thread.dayYesterday": "Hier",

            // --- Queued sends (#234) --------------------------------------
            "thread.deleteQueuedTitle": "Supprimer ce message ?",
            "thread.deleteQueuedBody":
                "Il n'a pas été envoyé, et le supprimer ici efface la seule copie.",
            "thread.keepIt": "Le garder",
            "thread.queuedOffline":
                "En file d'attente — s'enverra dès votre retour en ligne",
            "thread.sending": "Envoi…",
            "thread.sent": "Envoyé",
            "thread.delivered": "Livré",
            "thread.sendNow": "Envoyer maintenant",
            "thread.retry": "Réessayer",
            "thread.onePhoto": "1 photo",
            "thread.manyPhotos": "{count} photos",

            // --- Tags ------------------------------------------------------
            "thread.tags": "Étiquettes",
            "thread.addTag": "Ajouter une étiquette",
            "thread.manageTags": "Gérer les étiquettes",
            "thread.removeTag": "Retirer l'étiquette {name}",
            "thread.addTagNamed": "Ajouter l'étiquette {name}",
            "thread.addOrCreateTag": "Ajouter ou créer une étiquette",
            "thread.findTag": "Trouver une étiquette",
            "thread.create": "Créer",
            "thread.add": "Ajouter",
            "thread.didYouMean": "Vouliez-vous dire « {name} » ?",
            "thread.tagsLocked":
                "Aucune étiquette de ce nom. Demandez à un administrateur de "
                + "l'ajouter — cet espace de travail garde une liste fixe.",
            "thread.noTagsCreate":
                "Aucune étiquette pour l'instant. Créez la première ci-dessus.",
            "thread.noTagsAdmin":
                "Aucune étiquette pour l'instant. Un administrateur ajoute la première.",

            // --- Opt-out (#407) ---------------------------------------------
            "thread.optOutTitle": "Désabonner ce client ?",
            "thread.optOutBody":
                "Il ne recevra plus vos textos tant que le désabonnement n'est pas "
                + "retiré. C'est inscrit dans l'historique de la conversation.",
            "thread.optOut": "Désabonner",
            "thread.optOutOfTexts": "Désabonner des textos",
            "thread.revokeTitle": "Retirer le désabonnement ?",
            "thread.revokeBody":
                "Vous pourrez de nouveau texter ce client. Ne faites ceci que s'il "
                + "a demandé à recevoir vos messages.",
            "thread.removeOptOut": "Retirer le désabonnement",
            "thread.carrierStopNote":
                "Ce client a texté STOP. Lui seul peut annuler cela, en textant "
                + "START à votre numéro.",

            // --- Assignment --------------------------------------------------
            "thread.assignTo": "Assigner à",
            "thread.assignToEllipsis": "Assigner à…",
            "thread.assignedTo": "Assignée à {name}",
            "thread.unassigned": "Non assignée",

            // --- Spam (#250) --------------------------------------------------
            "thread.spam": "Pourriel",
            "thread.spamTitle": "Ceci ressemble à un pourriel",
            "thread.notSpam": "Pas un pourriel",
            "thread.spamBody":
                "Nous n'avons pas envoyé de notification. Rien n'est caché, et vous "
                + "pouvez répondre normalement.",

            // --- Snooze (#293) -------------------------------------------------
            "thread.bringBack": "Ramener",
            "thread.bringBackNow": "Ramener maintenant",
            "thread.bringBackHint":
                "Ramène cette conversation dans votre boîte de réception maintenant",
            "thread.cancelReminder": "Annuler le rappel",
            "thread.snoozeUntil": "Reporter jusqu'à",
            "thread.remindMeToChase": "Me rappeler de relancer",
            "thread.pickADate": "Choisir une date…",
            "thread.remindMe": "Me rappeler",
            "thread.snooze": "Reporter",
            "thread.whyOptional": "Pourquoi ? (facultatif)",
            "thread.returnDateTime": "Date et heure du retour",
            "thread.snoozeExplainer":
                "Elle revient dans votre boîte de réception à ce moment-là — et "
                + "immédiatement si le client répond avant.",
            "thread.followUpExplainer":
                "Elle revient à ce moment-là comme une relance à faire — sauf si le "
                + "client répond avant, auquel cas il n'y a rien à relancer et le "
                + "rappel disparaît.",

            // --- Pinned ----------------------------------------------------------
            "thread.pinned": "Épinglé",
            "thread.pinnedCount": "Épinglés · {count}",
            "thread.collapsePinned": "Réduire les épinglés",
            "thread.expandPinned": "Développer les épinglés",

            // --- Timeline visibility ------------------------------------------
            "thread.showMessages": "Afficher les textos",
            "thread.showNotes": "Afficher les notes",
            "thread.showEvents": "Afficher les évènements",
            "thread.refresh": "Actualiser",

            // --- Message bubbles + long-press actions ---------------------------
            "thread.internalNote": "Note interne",
            "thread.noteOnTask": "sur : {title}",
            "thread.openTask": "Ouvrir la tâche",
            "thread.openTaskNamed": "Ouvrir la tâche {title}",
            "thread.reopenTaskNamed": "Rouvrir la tâche {title}",
            "thread.markTaskDoneNamed": "Marquer la tâche {title} comme faite",
            "thread.hasTask": "A une tâche",
            "thread.openTheTask": "Ouvrir la tâche",
            "thread.goToMessage": "Aller à ce message",
            "thread.photoUnavailable": "Photo indisponible · touchez pour réessayer",
            "thread.copyText": "Copier le texte",
            "thread.done": "Fait",
            "thread.retrySend": "Renvoyer",
            "thread.makeTask": "Créer une tâche",

            // --- Make a task (#214) -----------------------------------------------
            "thread.newTask": "Nouvelle tâche",
            "thread.newTaskFrom":
                "Depuis le message de {name} · publié dans la conversation",
            "thread.taskTitle": "Titre",
            "thread.taskTitlePlaceholder": "Titre de la tâche",
            "thread.taskTitleFallback": "Faire un suivi",
            "thread.due": "Échéance",
            "thread.dueOptional": "Échéance (facultatif)",
            "thread.addDueDate": "Ajouter une échéance",
            "thread.clearDueDate": "Effacer l'échéance",
            "thread.pickATime": "Choisir une heure…",
            "thread.createTask": "Créer la tâche",
            "thread.setDueDate": "Fixer l'échéance",
            "thread.nobody": "Personne",
            "thread.suggested": "Suggéré",
            "thread.addressSection": "Adresse",
            "thread.clear": "Effacer",
            "thread.clearAddress": "Effacer l'adresse",
            "thread.addrStreet": "Rue",
            "thread.addrUnit": "Unité / suite",
            "thread.addrCity": "Ville",
            "thread.addrState": "Province / État",
            "thread.addrPostal": "Code postal",
            "thread.taskLineNote": "La conversation affichera la ligne de tâche",

            // --- Contact panel (#165 / #301) ---------------------------------------
            "thread.openFullContact": "Ouvrir la fiche complète",
            "thread.sectionDetails": "Coordonnées",
            "thread.sectionConsent": "Consentement",
            "thread.sectionLeadSource": "D'où il vient",
            "thread.sectionTasks": "Tâches de cette conversation",
            "thread.sectionOtherConversations": "Autres conversations",
            "thread.fieldName": "Nom",
            "thread.addName": "Ajouter un nom",
            "thread.fieldAddress": "Adresse",
            "thread.addAddress": "Ajouter une adresse",
            "thread.fieldNotes": "Notes",
            "thread.notesPlaceholder":
                "Code de barrière, nom du chien, heure d'arrivée préférée…",
            "thread.saveFailed":
                "Impossible d'enregistrer. Vérifiez votre connexion.",
            "thread.leadFromLine": "{name} · la ligne qu'il a appelée",
            "thread.leadSaidSo": "{name} · quelqu'un l'a indiqué",
            "thread.leadAsk": "Demandez-lui : comment nous avez-vous connus ?",
            "thread.dontKnow": "Je ne sais pas",
            "thread.tasksLoadFailed":
                "Impossible de charger les tâches de cette conversation.",
            "thread.noTasks": "Aucune tâche dans cette conversation.",
            "thread.priorLoadFailed":
                "Impossible de charger les conversations précédentes.",
            "thread.noOtherConversations":
                "Aucune autre conversation avec ce client.",

            // --- The catch-up card (#247) --------------------------------------------
            "thread.summaryReading": "Lecture de la conversation…",
            "thread.summaryReady": "Le résumé de Lou",
            "thread.summaryOffer": "Faites-moi un résumé",
            "thread.summaryOfferAria": "Faites-moi un résumé de cette conversation",
            "thread.summaryOfferHint":
                "Lou lit la conversation et montre ce que le client a demandé, ce "
                + "que vous avez répondu, et ce qui reste en suspens.",
            "thread.summaryHide": "Masquer",
            "thread.summaryLineHint": "Ouvre le message d'où ceci provient.",

            // --- Scheduled strip (#233) ------------------------------------------
            "thread.scheduledWaiting": "En attente",
            "thread.cancelScheduledAria": "Annuler le message prévu pour {when}",

            // --- Photos & files (#165 / #317) --------------------------------------
            "thread.photosAndFiles": "Photos et fichiers",
            "thread.backToConversation": "Retour à la conversation",
            "thread.galleryView": "Affichage",
            "thread.galleryImages": "Images",
            "thread.galleryFiles": "Fichiers",
            "thread.noPhotosLoaded": "Aucune photo chargée pour l'instant.",
            "thread.noPhotosYet": "Aucune photo dans cette conversation.",
            "thread.noFilesLoaded": "Aucun fichier chargé pour l'instant.",
            "thread.noFilesYet": "Aucun fichier dans cette conversation.",
            "thread.loadMore": "Charger plus",
            "thread.loadAnyway": "Charger",
            "thread.fileCantOpen": "Impossible d'ouvrir ce fichier.",
            "thread.reportThisFile": "Signaler ce fichier",
            "thread.reportFileTitle": "Signaler ce fichier ?",
            "thread.reportFileBody":
                "Personne dans votre équipe ne pourra ouvrir {name} tant qu'un "
                + "propriétaire ou un administrateur ne l'aura pas débloqué. Rien "
                + "n'est supprimé.",
            "thread.reportFile": "Signaler le fichier",
            "thread.reportFileFailed":
                "Impossible de signaler ce fichier. Réessayez.",
            "thread.playAudio": "Écouter le message vocal",
            "thread.pauseAudio": "Mettre le message vocal en pause",
            "thread.openAttachment": "Ouvrir {kind}",

            // --- The composer -------------------------------------------------------
            "thread.modeText": "Texto",
            "thread.modeNote": "Note",
            "thread.textPlaceholder": "Texto",
            "thread.notePlaceholder": "Écrire une note interne…",
            "thread.addToMessage": "Ajouter au message",
            "thread.attachPhoto": "Joindre une photo",
            "thread.attachFile": "Joindre un fichier",
            "thread.attachFilesToNote": "Joindre des fichiers à cette note",
            "thread.savedReply": "Réponse enregistrée",
            "thread.sendLater": "Envoyer plus tard",
            "thread.sendMessage": "Envoyer le message",
            "thread.saveNote": "Enregistrer la note",
            "thread.removeAttachment": "Retirer la pièce jointe",
            "thread.removeNamed": "Retirer {name}",
            "thread.attachLimitPhotos":
                "Vous pouvez joindre jusqu'à {max} photos par texto.",
            "thread.attachLimitText":
                "Vous pouvez joindre jusqu'à {max} fichiers par texto.",
            "thread.attachLimitNote": "Une note peut porter jusqu'à 10 fichiers.",
            "thread.photoReadFailed":
                "Impossible de lire cette photo. Réessayez de la joindre.",
            "thread.sendsAs": "S'envoie ainsi : ",
            "thread.callThemInstead": "Appelez-le plutôt",
            "thread.reportThis": "Signaler ceci",

            // --- The send boundary (#408) -------------------------------------------
            "thread.collisionTitle": "Quelqu'un a déjà répondu",
            "thread.collisionAsk": " Envoyer le vôtre quand même ?",
            "thread.sendAnyway": "Envoyer quand même",
            "thread.letMeLook": "Laissez-moi voir",

            // --- Lou in the composer -------------------------------------------------
            "thread.draftWithLou": "Rédiger avec Lou",
            "thread.finishWithLou": "Terminer avec Lou",
            "thread.drafting": "Rédaction…",
            "thread.lousDrafts": "Les brouillons de Lou",
            "thread.dismiss": "Fermer",
            "thread.louNeedsBusiness":
                "Lou ne sait pas encore ce que vous faites. Dites-le-lui, et les "
                + "brouillons deviendront précis.",

            // --- The dictated wrap-up (#507) -------------------------------------------
            "thread.holdToDictateWrapUp":
                "Maintenez pour dicter un compte rendu",
            "thread.wrapUpHint":
                "Dites ce qui a été convenu après l'appel. Lou transcrit vos mots "
                + "pour que vous les vérifiiez avant de publier la note.",
            "thread.wrapUpTranscribing": "Transcription de ce que vous avez dit…",
            "thread.wrapUpGoAhead": "Allez-y — relâchez quand vous avez terminé",
            "thread.wrapUpGoAheadLeft": "Allez-y — {seconds} s restantes",
            "thread.wrapUpTooShort":
                "Maintenez le micro pendant que vous parlez — c'était trop court "
                + "pour être transcrit.",

            // --- Mentions ---------------------------------------------------------------
            "thread.mentionTeammate": "Mentionner un collègue",
            "thread.noMentionable":
                "Personne de l'équipe ne voit cette conversation.",

            // --- Saved replies (#274 / #475) ---------------------------------------------
            "thread.templates": "Modèles",
            "thread.savedReplies": "Réponses enregistrées",
            "thread.noTemplates":
                "Aucune réponse enregistrée. Créez-les sur le web dans Paramètres.",
            "thread.nothingMatches": "Aucun résultat.",
            "thread.templateHint":
                "Tapez / dans la zone de rédaction pour les ouvrir · partagées avec "
                + "l'équipe",
            "thread.searchTemplates": "Rechercher des modèles…",
            "thread.insert": "Insérer",

            // --- Send later (#233 / #539) --------------------------------------------------
            "thread.sendAt": "Envoyer à",
            "thread.schedule": "Programmer",
            "thread.whichClock": "Quelle heure",
            "thread.workspaceTime": "L'heure de votre espace de travail",
            "thread.quietHoursTitle": "Ça arrive tard chez lui",
            "thread.scheduleAnyway": "Programmer quand même",
            "thread.pickAnotherTime": "Choisir une autre heure",

            // --- Marking up a photo (#294) -------------------------------------------------
            "thread.markupTitle": "Pointer quelque chose",
            "thread.workPhaseAria": "Ce que montrent ces photos",

            // --- Starting a conversation (#183) ---------------------------------------------
            "thread.newTextTitle": "Nouveau texto",
            "thread.numberNotReady": "Votre numéro n'est pas encore prêt.",
            "thread.numberNotReadyBody":
                "Il vous faut un numéro actif pour démarrer une conversation. "
                + "Vérifiez son état dans l'application web.",
            "thread.toLabel": "À",
            "thread.messageLabel": "Message",
            "thread.recipientPlaceholder": "Nom ou numéro de téléphone",
            "thread.clearRecipient": "Effacer le destinataire",
            "thread.nanpOnly": "Numéros américains et canadiens seulement.",
            "thread.noContactMatch":
                "Aucune correspondance dans les contacts. Ceci démarre une nouvelle "
                + "conversation.",
            "thread.willText": "Textera {number}",
            "thread.fromNumber": "De : {number}",
            "thread.sendText": "Envoyer le texto",
            "thread.lateThereTitle": "Il est tard chez lui",
            "thread.lateThereBody": "Il est {time} à ce numéro. Envoyer quand même ?",
            "thread.lateThereUnknown": "entre 20 h et 8 h",
            "thread.wait": "Attendre",
            "thread.theirTimeAskFirst":
                "Il est {time} chez ce client. Nous demanderons avant d'envoyer si tard.",
            "thread.theirTime": "Il est {time} chez lui.",
        ]
    )
}
