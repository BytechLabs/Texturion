package com.loonext.android.core.i18n

/**
 * #228 — the app's PLUMBING, in both languages: the shell around every screen,
 * the You sheet, the joining orientation and its notification ask, and the app
 * lock.
 *
 * These are the words nobody opens the app to read, which is exactly why they
 * matter: a French reader who meets an English tab bar, an English Sign out and
 * an English unlock screen has a French app in the middle and an English one
 * around the edges, and that reads as a translation somebody abandoned halfway.
 *
 * ## The register, and where it came from
 *
 * Quebec French, VOUVOIEMENT, accents spelled normally — the GSM-7 restriction
 * in `MessageLocale` governs the automated TEXTS, which are billed per segment,
 * and nothing on a screen is. Vocabulary held steady with web so the two clients
 * agree: texto · conversation · client · équipe · espace de travail · numéro ·
 * tâche · paramètres · boîte de réception.
 *
 * Where web has already translated the same sentence, its French is copied
 * character for character rather than written again — `apps/web/src/i18n/
 * sections/shell.ts` for the nav and the account sheet, and `.../onboarding.ts`
 * for the four orientation screens. Two clients each having a go at "Sign out"
 * is how a product ends up with two names for one button.
 *
 * Product names (Loonext, Stripe, Telnyx, Lou), the platform's own name
 * (Android), and the carrier keywords are never translated: a carrier matches on
 * them, and a person looking for "Android" in a bug report needs to find it.
 */
object ShellStrings : AppStrings.Section {
    override val en = mapOf(
        // #228 — the notification channels. These are the app's only copy
        // that another app renders: Android shows them in system Settings →
        // Notifications, which is where somebody goes to turn one off.
        "push.channelMessagesName" to
            "Messages",
        "push.channelMessagesDesc" to
            "New texts from customers.",
        "push.channelMissedCallsName" to
            "Missed calls",
        "push.channelMissedCallsDesc" to
            "Calls to your business number that nobody picked up.",
        "push.channelTaskRemindersName" to
            "Task reminders",
        "push.channelTaskRemindersDesc" to
            "Jobs you are assigned, shortly before they are due.",
        "push.channelAssignmentsName" to
            "Assigned to you",
        "push.channelAssignmentsDesc" to
            "Conversations and jobs a teammate puts on your name.",
        "push.channelUrgentName" to
            "Urgent texts",
        "push.channelUrgentDesc" to
            "A customer said their job is urgent.",
        "push.channelPaymentsName" to
            "Payments",
        "push.channelPaymentsDesc" to
            "Money paid, refunded, or pulled back on a job.",
        "push.channelIncomingCallsName" to
            "Incoming calls",
        "push.channelIncomingCallsDesc" to
            "Ringing calls to your business number.",
        // ── The nav pill, and what a screen reader calls it ───────────────────
        "shell.navForYou" to "For you",
        "shell.navInbox" to "Inbox",
        "shell.navCalls" to "Calls",
        "shell.navTasks" to "Tasks",
        "shell.navContacts" to "Contacts",
        "shell.account" to "Account",
        "shell.accountUnread" to "Account, {count} unread notifications",

        // ── The You sheet ─────────────────────────────────────────────────────
        "shell.you" to "You",
        "shell.theme" to "Theme",
        "shell.themeSystem" to "System",
        "shell.themeLight" to "Light",
        "shell.themeDark" to "Dark",
        "shell.notifications" to "Notifications",
        "shell.settings" to "Settings",
        "shell.signOut" to "Sign out",
        "shell.unreadNew" to "{count} new",
        "shell.workspaces" to "Workspaces",
        "shell.currentWorkspace" to "Current",
        "shell.copyNumber" to "Copy number",
        /** The clipboard's own label for what was just copied (Android 13+). */
        "shell.clipPhoneNumber" to "Phone number",
        "shell.footerVersion" to "v{version}",
        "shell.footerWorkspace" to "{name} workspace",
        /**
         * The bootstrap's own last resort, written where there is no
         * composition — see [com.loonext.android.features.shell.RootViewModel].
         * Every OTHER failure on that path renders the server's own sentence
         * verbatim, because those are the API's to word and to translate.
         */
        "shell.bootstrapFailed" to "Couldn't load your workspace.",

        // ── The app lock (#330) ───────────────────────────────────────────────
        // Never a fault, in either language: nothing has gone wrong, the person
        // turned this on, and the phone is theirs. `AppLockTest` pins that for
        // the English (it forbids "expired", "error", "failed", "invalid",
        // "denied"), so a French rewording must hold the same promise.
        "shell.lockHeadlineInbox" to "Unlock to see your inbox",
        "shell.lockHeadlineFinish" to "Unlock to finish turning this on",
        // Says whose data it is protecting, not whose fault this is.
        "shell.lockBody" to "Your customers' conversations are on this phone.",
        "shell.lockAction" to "Unlock",
        "shell.lockPromptTitle" to "Unlock Loonext",
        "shell.lockPromptSubtitle" to "Your customers' conversations are on this phone",

        /*
         * ── The joining member's orientation (#286/#521) ──────────────────────
         *
         * These four screens are ALSO on web and iOS, and
         * `packages/shared/src/member-orientation-copy.test.ts` reads all three
         * sources so the ports cannot drift. That guard reads THIS file for the
         * Android half — the words moved here, so the guard followed them, the
         * same way it followed web's into `i18n/sections/onboarding.ts`.
         *
         * The order of the four is load-bearing too: the guard asserts the
         * notification screen comes after the inbox one, because "requested with
         * context, not cold" is three screens of reason and then the ask.
         */
        "shell.orientationInboxTitle" to "One inbox, the whole crew",
        "shell.orientationInboxBody" to
            "Every text your customers send lands here, and everyone on the crew " +
            "can see it. Nothing sits unanswered in one person's phone.",
        "shell.orientationNumberTitle" to "You answer as the business",
        "shell.orientationNumberBody" to
            "Your replies go out from the workspace's number, so customers never " +
            "get your personal one. If a number isn't shared with you, " +
            "Settings tells you which and why.",
        "shell.orientationNotesTitle" to "Notes stay inside",
        "shell.orientationNotesBody" to
            "Switch the composer to Note and only the crew sees it — the customer " +
            "never does. Mention a teammate in one and it lands on their For you.",
        "shell.orientationNotificationsTitle" to "You choose when we buzz you",
        "shell.orientationNotificationsBody" to
            "You're joining a workspace that already has traffic. Turn on " +
            "notifications for the work meant for you, and change them any " +
            "time in Settings.",
        "shell.orientationSays" to "{name} says",
        "shell.orientationTheySaid" to "They said",
        "shell.orientationSkip" to "Skip",
        "shell.orientationNext" to "Next",
        "shell.orientationStartWorking" to "Start working",

        // ── The notification ask, standalone and at the end of the flow ───────
        "shell.notificationsTurnOn" to "Turn on notifications",
        "shell.notificationsNotNow" to "Not now",
        "shell.primerTitle" to "Want a nudge when work comes in?",
        "shell.primerBody" to
            "We'll buzz you for new customer texts, missed calls and the " +
            "work assigned to you — nothing else. You can change what " +
            "reaches you, and when, in Settings.",

        // ── Settings › Profile: the language THIS person reads (#228) ─────────
        "shell.languageTitle" to "Your language",
        "shell.languageDescription" to
            "The language this app is drawn in for you. Everyone on the crew " +
            "picks their own, so changing it here changes nothing for anybody else.",
        "shell.languageSameAsPhone" to "Same as my phone",
        "shell.languageFollowingDevice" to "Right now that is {language}.",
        "shell.languageNotCustomers" to
            "This is not the language your customers are texted in. That one " +
            "belongs to the workspace, under Workspace.",
        "shell.languageSaved" to "Language updated.",

        // ── The FAB and the one route header that is ours ─────────────────────
        "shell.newConversation" to "New conversation",

        /*
         * ── The two signed-in interstitials ───────────────────────────────────
         *
         * Both hand off to the web, so both name a destination rather than a
         * screen in this app. The domain is a domain and stays as typed in
         * either language — somebody reads it out of the button and into a
         * browser.
         */
        "shell.setupWorkspaceTitle" to "Let's set up your workspace",
        "shell.setupWorkspaceBody" to
            "Workspace creation and checkout live on the web for now. " +
            "Create yours at app.loonext.com, then come back and pull to refresh.",
        "shell.setupWorkspaceAction" to "Open app.loonext.com",
        "shell.finishSetupTitle" to "Finish setting up",
        "shell.finishSetupBody" to
            "Your workspace hasn't completed checkout yet. Finish on the web " +
            "and your number, texting, and calling light up here.",
        "shell.finishSetupAction" to "Finish checkout",
        "shell.externalStepDone" to "I've done this — refresh",

        /*
         * ── The update notice, and the floor (#339) ───────────────────────────
         *
         * Ported 1:1 in behaviour from web's `update-prompt.tsx`, and the French
         * is copied from `apps/web/src/i18n/sections/shell.ts` (`updateReadyTitle`,
         * `updateDismiss`, `updateBlockTitle`, `updateVersion`, `updateMinimum`).
         *
         * The one word that differs is deliberate and is not a translation
         * choice: a browser RELOADS and a phone UPDATES, so web says "Recharger"
         * where this says "Mettre à jour". A person with both devices is told
         * the same thing about the same release, in the verb their device
         * actually needs.
         */
        "shell.updateReadyTitle" to "A newer version of Loonext is ready",
        "shell.updateReadyBody" to "Update to pick up the latest fixes.",
        "shell.updateAction" to "Update",
        "shell.updateDismiss" to "Dismiss update notice",
        "shell.updateBlockTitle" to "Loonext needs an update",
        "shell.updateBlockBody" to
            "This version can no longer connect safely. Update to continue.",
        "shell.updateBlockAction" to "Update Loonext",
        // Support's first question is "what are you running", and the person
        // reading this cannot reach the settings screen that would say.
        "shell.updateVersion" to "You are on {version}",
        "shell.updateMinimum" to " · {version} or newer is required",

        /*
         * ── Handing the phone over (#330) ─────────────────────────────────────
         *
         * The English is the hand-port of `packages/shared/src/hand-over-phone.ts`
         * and `HandOverPhoneTest` holds it to that file WORD FOR WORD, so these
         * entries are a move rather than a rewrite: the English below is the
         * English that was in the Kotlin, to the character.
         *
         * The French says "quittera ce téléphone" where the English says "comes
         * off this phone" for the reason the sentence exists — the person is
         * deciding whether it is safe to hand the phone over, and the list is
         * the answer.
         */
        "shell.handOverAction" to "Hand this phone to someone else",
        "shell.handOverTitle" to "Hand this phone over?",
        "shell.handOverConfirm" to "Sign out and clear",
        "shell.handOverCancel" to "Stay signed in",
        "shell.handOverBody" to
            "You'll be signed out and everything from this workspace comes " +
            "off this phone: the conversations, your customers' details, and the " +
            "unread counts. The next person signs in as themselves.",
        // Two shapes rather than a count: "1 messages" is the shape that tells a
        // reader nobody proofread the warning they are being asked to act on.
        "shell.handOverUnsentOne" to
            "One message hasn't sent yet and will be discarded. If it matters, " +
            "stay signed in until you have signal.",
        "shell.handOverUnsentMany" to
            "{count} messages haven't sent yet and will be discarded. If they " +
            "matter, stay signed in until you have signal.",

        // ── The app lock, when the phone cannot hold one (#330) ───────────────
        "shell.lockCannotEnable" to
            "Set a screen lock, fingerprint or face unlock on this phone first — " +
            "without one there is nothing for this to ask you for.",

        /*
         * ── Full-size photos on metered data (#289) ───────────────────────────
         *
         * The hint is the one a person meets INSTEAD of a photo, so it says the
         * condition and the remedy in one line: a spinner that never resolves is
         * how a deliberate setting gets reported as a bug.
         *
         * "Wi-Fi" is the network's own name and is spelled the same in both.
         */
        "shell.meteredHint" to "You're on mobile data. Tap to load the full-size photo.",
        "shell.meteredLoad" to "Load",
        "shell.wifiOnlyLabel" to "Full-size photos on Wi-Fi only",
        "shell.wifiOnlyDescription" to
            "Threads and galleries always load. Only full-size photos and downloads " +
            "wait for Wi-Fi — tap one to load it anyway.",
        // #721: why no phone rang, after a missed call or voicemail.
        "shell.callRoutingBlocked" to "Blocked number",
        "shell.callRoutingLineBusy" to "Line busy",
        "shell.callRoutingScreened" to "Screened as spam",
        "shell.callRoutingAfterHours" to "After hours, nobody on call",
        "shell.callRoutingPaused" to "Line paused",
        "shell.callRoutingOverCap" to "Calling limit reached",
        "shell.callRoutingNobodyReachable" to "Nobody could be rung",
        "shell.navTrash" to "Trash",
        "shell.callActionMessage" to "Message",
        "shell.callActionCallBack" to "Call back",
        "shell.callActionContact" to "Contact",
        "shell.callActionAddContact" to "Add contact",
        "shell.callActionTask" to "Task",
        "shell.callActionDetails" to "Details",
        "shell.howItEnded" to "How it ended",
        "shell.openConversation" to "Open the conversation",
        "shell.viewContact" to "View contact",
        "shell.allCalls" to "All calls",
        "shell.loadingCall" to "Loading call",
        "shell.voicemail" to "Voicemail",
        "shell.directionLabel" to "Direction",
        "shell.directionOutgoing" to "Outgoing",
        "shell.directionIncoming" to "Incoming",
        "shell.numberLabel" to "Number",
        "shell.placedBy" to "Placed by",
        "shell.answeredBy" to "Answered by",
        "shell.startedLabel" to "Started",
        "shell.endedLabel" to "Ended",
        "shell.callerVerified" to "Caller verified",
        "shell.callerVerifiedYes" to "Yes",
        "shell.callerVerifiedPartly" to "Partly ({attestation})",
        "shell.whyNoPhoneRang" to "Why no phone rang",
        "shell.outcomeInProgress" to "In progress",
        "shell.outcomeAnswered" to "Answered",
        "shell.outcomeNoAnswer" to "No answer",
        "shell.outcomeLeftVoicemail" to "Left a voicemail",
        "shell.outcomeMissed" to "Missed",
        "shell.transcriptRecordingLost" to "They started leaving a voicemail, but the recording didn't save.",
        "shell.transcriptNoVoicemail" to "No voicemail was left on this call.",
        "shell.transcriptNoWords" to "We couldn't make out any words in this one. The recording still plays.",
        "shell.transcriptNotYet" to "This voicemail hasn't been written down yet. Playing it will do that.",
        // #725: how a call ended.
        "shell.callEndedCallerHungUp" to "The caller hung up",
        "shell.callEndedNoAnswerInTime" to "Nobody answered in time",
        "shell.callEndedDeclinedByEveryone" to "Everyone declined",
        "shell.callEndedNobodyReachable" to "Nobody could be rung",
        "shell.callEndedRejectedBlocked" to "Blocked number",
        "shell.callEndedRejectedOverLimit" to "Calling limit reached",
        "shell.callEndedLinePaused" to "Line paused",
        "shell.callEndedStuckCallCleanedUp" to "The call stopped responding and was ended",
        "shell.callEndedIntentExpired" to "The transfer timed out",
        "shell.callEndedVoicemailFailed" to "The voicemail could not record",
        "shell.callEndedCarrierRefused" to "The carrier refused the call",
        "shell.callEndedPlacerHungUp" to "Hung up on our side",
        "shell.callEndedCustomerHungUp" to "The customer hung up",
    )

    override val frCA = mapOf(
        // #228 — the notification channels. These are the app's only copy
        // that another app renders: Android shows them in system Settings →
        // Notifications, which is where somebody goes to turn one off.
        "push.channelMessagesName" to
            "Messages",
        "push.channelMessagesDesc" to
            "Nouveaux textos de vos clients.",
        "push.channelMissedCallsName" to
            "Appels manqués",
        "push.channelMissedCallsDesc" to
            "Appels à votre numéro d'affaires que personne n'a pris.",
        "push.channelTaskRemindersName" to
            "Rappels de tâches",
        "push.channelTaskRemindersDesc" to
            "Les travaux qui vous sont assignés, peu avant l'heure prévue.",
        "push.channelAssignmentsName" to
            "Assigné à vous",
        "push.channelAssignmentsDesc" to
            "Les conversations et les travaux qu'un collègue met à votre nom.",
        "push.channelUrgentName" to
            "Textos urgents",
        "push.channelUrgentDesc" to
            "Un client a indiqué que son travail est urgent.",
        "push.channelPaymentsName" to
            "Paiements",
        "push.channelPaymentsDesc" to
            "Argent payé, remboursé ou repris sur un travail.",
        "push.channelIncomingCallsName" to
            "Appels entrants",
        "push.channelIncomingCallsDesc" to
            "Appels en sonnerie vers votre numéro d'affaires.",
        "shell.navForYou" to "Pour vous",
        "shell.navInbox" to "Boîte de réception",
        "shell.navCalls" to "Appels",
        "shell.navTasks" to "Tâches",
        "shell.navContacts" to "Contacts",
        "shell.account" to "Compte",
        "shell.accountUnread" to "Compte, {count} notifications non lues",

        "shell.you" to "Vous",
        "shell.theme" to "Thème",
        "shell.themeSystem" to "Système",
        "shell.themeLight" to "Clair",
        "shell.themeDark" to "Sombre",
        "shell.notifications" to "Notifications",
        "shell.settings" to "Paramètres",
        "shell.signOut" to "Se déconnecter",
        "shell.unreadNew" to "{count} nouvelles",
        "shell.workspaces" to "Espaces de travail",
        "shell.currentWorkspace" to "Actuel",
        "shell.copyNumber" to "Copier le numéro",
        "shell.clipPhoneNumber" to "Numéro de téléphone",
        "shell.footerVersion" to "v{version}",
        "shell.footerWorkspace" to "espace de travail {name}",
        "shell.bootstrapFailed" to
            "Impossible de charger votre espace de travail.",

        "shell.lockHeadlineInbox" to
            "Déverrouillez pour voir votre boîte de réception",
        "shell.lockHeadlineFinish" to "Déverrouillez pour terminer l'activation",
        "shell.lockBody" to "Les conversations de vos clients sont sur ce téléphone.",
        "shell.lockAction" to "Déverrouiller",
        "shell.lockPromptTitle" to "Déverrouiller Loonext",
        "shell.lockPromptSubtitle" to
            "Les conversations de vos clients sont sur ce téléphone",

        "shell.orientationInboxTitle" to "Une boîte de réception, toute l'équipe",
        "shell.orientationInboxBody" to
            "Chaque texto que vos clients envoient arrive ici, et toute l'équipe " +
            "peut le voir. Rien ne reste sans réponse dans le téléphone d'une " +
            "seule personne.",
        "shell.orientationNumberTitle" to "Vous répondez au nom de l'entreprise",
        "shell.orientationNumberBody" to
            "Vos réponses partent du numéro de l'espace de travail, alors les " +
            "clients n'obtiennent jamais votre numéro personnel. Si un numéro " +
            "n'est pas partagé avec vous, les paramètres vous disent lequel et " +
            "pourquoi.",
        "shell.orientationNotesTitle" to "Les notes restent à l'interne",
        "shell.orientationNotesBody" to
            "Basculez le rédacteur en mode Note et seule l'équipe la voit — " +
            "jamais le client. Mentionnez un coéquipier dans une note et elle " +
            "arrive dans son Pour vous.",
        "shell.orientationNotificationsTitle" to
            "Vous choisissez quand nous vous avertissons",
        "shell.orientationNotificationsBody" to
            "Vous joignez un espace de travail qui a déjà du trafic. Activez les " +
            "notifications pour le travail qui vous est destiné, et modifiez-les " +
            "quand vous voulez dans les paramètres.",
        "shell.orientationSays" to "{name} dit",
        "shell.orientationTheySaid" to "On a écrit",
        "shell.orientationSkip" to "Passer",
        "shell.orientationNext" to "Suivant",
        "shell.orientationStartWorking" to "Commencer à travailler",

        "shell.notificationsTurnOn" to "Activer les notifications",
        "shell.notificationsNotNow" to "Pas maintenant",
        "shell.primerTitle" to "Voulez-vous être averti quand du travail arrive ?",
        "shell.primerBody" to
            "Nous vous avertirons pour les nouveaux textos de clients, les appels " +
            "manqués et le travail qui vous est attribué — rien d'autre. Vous " +
            "pouvez changer ce qui vous parvient, et quand, dans les paramètres.",

        "shell.languageTitle" to "Votre langue",
        "shell.languageDescription" to
            "La langue dans laquelle cette application vous est présentée. Chaque " +
            "membre de l'équipe choisit la sienne, alors la changer ici ne change " +
            "rien pour les autres.",
        "shell.languageSameAsPhone" to "Comme mon téléphone",
        "shell.languageFollowingDevice" to "En ce moment, c'est {language}.",
        "shell.languageNotCustomers" to
            "Ce n'est pas la langue des textos envoyés à vos clients. Celle-là " +
            "appartient à l'espace de travail, sous Espace de travail.",
        "shell.languageSaved" to "Langue mise à jour.",

        "shell.newConversation" to "Nouvelle conversation",

        // ── The two signed-in interstitials ───────────────────────────────────
        "shell.setupWorkspaceTitle" to "Configurons votre espace de travail",
        "shell.setupWorkspaceBody" to
            "La création d'un espace de travail et le paiement se font sur le " +
            "web pour l'instant. Créez le vôtre à app.loonext.com, puis revenez " +
            "ici et tirez vers le bas pour actualiser.",
        "shell.setupWorkspaceAction" to "Ouvrir app.loonext.com",
        "shell.finishSetupTitle" to "Terminer la configuration",
        "shell.finishSetupBody" to
            "Votre espace de travail n'a pas terminé le paiement. Terminez sur " +
            "le web et votre numéro, les textos et les appels s'activeront ici.",
        "shell.finishSetupAction" to "Terminer le paiement",
        "shell.externalStepDone" to "C'est fait — actualiser",

        // ── The update notice, and the floor (#339) ───────────────────────────
        // Copied from web's `i18n/sections/shell.ts`, except the verb: web
        // reloads a tab, this updates an app.
        "shell.updateReadyTitle" to "Une nouvelle version de Loonext est prête",
        "shell.updateReadyBody" to
            "Mettez à jour pour obtenir les derniers correctifs.",
        "shell.updateAction" to "Mettre à jour",
        "shell.updateDismiss" to "Masquer l'avis de mise à jour",
        "shell.updateBlockTitle" to "Loonext a besoin d'une mise à jour",
        "shell.updateBlockBody" to
            "Cette version ne peut plus se connecter en toute sécurité. " +
            "Mettez à jour pour continuer.",
        "shell.updateBlockAction" to "Mettre à jour Loonext",
        "shell.updateVersion" to "Vous utilisez {version}",
        "shell.updateMinimum" to " · {version} ou plus récente est requise",

        // ── Handing the phone over (#330) ─────────────────────────────────────
        "shell.handOverAction" to "Confier ce téléphone à quelqu'un d'autre",
        "shell.handOverTitle" to "Confier ce téléphone ?",
        "shell.handOverConfirm" to "Se déconnecter et tout effacer",
        "shell.handOverCancel" to "Rester connecté",
        "shell.handOverBody" to
            "Vous serez déconnecté et tout ce qui vient de cet espace de travail " +
            "quittera ce téléphone : les conversations, les coordonnées de vos " +
            "clients et les compteurs de messages non lus. La prochaine personne " +
            "se connectera en son propre nom.",
        "shell.handOverUnsentOne" to
            "Un message n'est pas encore envoyé et sera supprimé. Si c'est " +
            "important, restez connecté jusqu'à ce que vous ayez du signal.",
        "shell.handOverUnsentMany" to
            "{count} messages ne sont pas encore envoyés et seront supprimés. " +
            "Si c'est important, restez connecté jusqu'à ce que vous ayez du signal.",

        // ── The app lock, when the phone cannot hold one (#330) ───────────────
        "shell.lockCannotEnable" to
            "Configurez d'abord un verrouillage d'écran, une empreinte digitale " +
            "ou la reconnaissance faciale sur ce téléphone — sans cela, il n'y a " +
            "rien à vous demander.",

        // ── Full-size photos on metered data (#289) ───────────────────────────
        "shell.meteredHint" to
            "Vous êtes sur les données mobiles. Touchez pour charger la photo " +
            "en pleine résolution.",
        "shell.meteredLoad" to "Charger",
        "shell.wifiOnlyLabel" to "Photos en pleine résolution sur Wi-Fi seulement",
        "shell.wifiOnlyDescription" to
            "Les conversations et les galeries se chargent toujours. Seules les " +
            "photos en pleine résolution et les téléchargements attendent le " +
            "Wi-Fi — touchez-en une pour la charger quand même.",
        "shell.callRoutingBlocked" to "Numéro bloqué",
        "shell.callRoutingLineBusy" to "Ligne occupée",
        "shell.callRoutingScreened" to "Filtré comme pourriel",
        "shell.callRoutingAfterHours" to "Hors des heures, personne de garde",
        "shell.callRoutingPaused" to "Ligne en pause",
        "shell.callRoutingOverCap" to "Limite d'appels atteinte",
        "shell.callRoutingNobodyReachable" to "Aucun téléphone n'a pu sonner",
        "shell.navTrash" to "Corbeille",
        "shell.callActionMessage" to "Texto",
        "shell.callActionCallBack" to "Rappeler",
        "shell.callActionContact" to "Contact",
        "shell.callActionAddContact" to "Ajouter le contact",
        "shell.callActionTask" to "Tâche",
        "shell.callActionDetails" to "Détails",
        "shell.howItEnded" to "Comment il s'est terminé",
        "shell.openConversation" to "Ouvrir la conversation",
        "shell.viewContact" to "Voir le contact",
        "shell.allCalls" to "Tous les appels",
        "shell.loadingCall" to "Chargement de l'appel",
        "shell.voicemail" to "Message vocal",
        "shell.directionLabel" to "Sens",
        "shell.directionOutgoing" to "Sortant",
        "shell.directionIncoming" to "Entrant",
        "shell.numberLabel" to "Numéro",
        "shell.placedBy" to "Placé par",
        "shell.answeredBy" to "Répondu par",
        "shell.startedLabel" to "Début",
        "shell.endedLabel" to "Fin",
        "shell.callerVerified" to "Appelant vérifié",
        "shell.callerVerifiedYes" to "Oui",
        "shell.callerVerifiedPartly" to "Partiellement ({attestation})",
        "shell.whyNoPhoneRang" to "Pourquoi aucun téléphone n'a sonné",
        "shell.outcomeInProgress" to "En cours",
        "shell.outcomeAnswered" to "Répondu",
        "shell.outcomeNoAnswer" to "Sans réponse",
        "shell.outcomeLeftVoicemail" to "A laissé un message vocal",
        "shell.outcomeMissed" to "Manqué",
        "shell.transcriptRecordingLost" to "Le client a commencé à laisser un message vocal, mais l'enregistrement n'a pas été conservé.",
        "shell.transcriptNoVoicemail" to "Aucun message vocal n'a été laissé sur cet appel.",
        "shell.transcriptNoWords" to "Nous n'avons distingué aucun mot dans celui-ci. L'enregistrement se lit toujours.",
        "shell.transcriptNotYet" to "Ce message vocal n'a pas encore été transcrit. Le lire s'en chargera.",
        "shell.callEndedCallerHungUp" to "L'appelant a raccroché",
        "shell.callEndedNoAnswerInTime" to "Personne n'a répondu à temps",
        "shell.callEndedDeclinedByEveryone" to "Tout le monde a refusé",
        "shell.callEndedNobodyReachable" to "Aucun téléphone n'a pu sonner",
        "shell.callEndedRejectedBlocked" to "Numéro bloqué",
        "shell.callEndedRejectedOverLimit" to "Limite d'appels atteinte",
        "shell.callEndedLinePaused" to "Ligne en pause",
        "shell.callEndedStuckCallCleanedUp" to "L'appel ne répondait plus et a été terminé",
        "shell.callEndedIntentExpired" to "Le transfert a expiré",
        "shell.callEndedVoicemailFailed" to "Le message vocal n'a pas pu être enregistré",
        "shell.callEndedCarrierRefused" to "L'opérateur a refusé l'appel",
        "shell.callEndedPlacerHungUp" to "Raccroché de notre côté",
        "shell.callEndedCustomerHungUp" to "Le client a raccroché",
    )
}
