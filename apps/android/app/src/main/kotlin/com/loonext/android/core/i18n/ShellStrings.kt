package com.loonext.android.core.i18n

/**
 * #228 — the app's PLUMBING, in both languages: the shell around every screen,
 * the You sheet, the joining orientation and its notification ask, the app lock,
 * and the developer Diagnostics surface.
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

        // ── Diagnostics (#198), the developer surface behind seven taps ───────
        "shell.diagCallFlow" to "Call flow",
        "shell.diagShare" to "Share",
        "shell.diagShareAll" to "Share all",
        "shell.diagNoCallEvents" to "No call events yet this session.",
        "shell.diagCrashReports" to "Crash reports",
        "shell.diagNoCrashReports" to "No crash reports on this device.",
        "shell.diagDetailsInside" to "Details inside",
        "shell.diagOnThread" to "on {thread}",
        "shell.diagUnknownTime" to "Unknown time",
        "shell.diagDeleteTitle" to "Delete this crash report?",
        "shell.diagDeleteBody" to
            "It is removed from this device only and cannot be recovered.",
        "shell.diagKeep" to "Keep",
        "shell.diagDevice" to "Device",
        "shell.diagAppVersion" to "App version",
        "shell.diagSdk" to "SDK {sdk} (Android {release})",
        "shell.diagPushToken" to "Push token",
        "shell.diagRegistered" to "Registered",
        "shell.diagNotRegistered" to "Not registered",
        "shell.diagAllowed" to "Allowed",
        "shell.diagBlocked" to "Blocked",
        "shell.diagSocket" to "Softphone socket",
        "shell.diagSocketReady" to "Ready",
        "shell.diagSocketConnecting" to "Connecting",
        "shell.diagSocketDisconnected" to "Disconnected",
        "shell.diagSocketNotRunning" to "Not running",
        "shell.diagExport" to "Export everything",
        "shell.diagExportCaption" to
            "Device facts, call flow, and crash reports in one share",
    )

    override val frCA = mapOf(
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

        "shell.diagCallFlow" to "Déroulement des appels",
        "shell.diagShare" to "Partager",
        "shell.diagShareAll" to "Tout partager",
        "shell.diagNoCallEvents" to "Aucun événement d'appel pour cette session.",
        "shell.diagCrashReports" to "Rapports de plantage",
        "shell.diagNoCrashReports" to "Aucun rapport de plantage sur ce téléphone.",
        "shell.diagDetailsInside" to "Détails à l'intérieur",
        "shell.diagOnThread" to "sur {thread}",
        "shell.diagUnknownTime" to "Heure inconnue",
        "shell.diagDeleteTitle" to "Supprimer ce rapport de plantage ?",
        "shell.diagDeleteBody" to
            "Il est retiré de ce téléphone seulement et ne peut pas être récupéré.",
        "shell.diagKeep" to "Conserver",
        "shell.diagDevice" to "Appareil",
        "shell.diagAppVersion" to "Version de l'application",
        "shell.diagSdk" to "SDK {sdk} (Android {release})",
        "shell.diagPushToken" to "Jeton de notification",
        "shell.diagRegistered" to "Enregistré",
        "shell.diagNotRegistered" to "Non enregistré",
        "shell.diagAllowed" to "Autorisées",
        "shell.diagBlocked" to "Bloquées",
        // The four values agree with "connexion" (feminine) in the label above
        // them, and none of them repeats that word — "Connexion : Connexion" is
        // a row that has told the reader nothing.
        "shell.diagSocket" to "Connexion du téléphone logiciel",
        "shell.diagSocketReady" to "Prête",
        "shell.diagSocketConnecting" to "En cours d'établissement",
        "shell.diagSocketDisconnected" to "Déconnectée",
        "shell.diagSocketNotRunning" to "Inactive",
        "shell.diagExport" to "Tout exporter",
        "shell.diagExportCaption" to
            "Les données de l'appareil, le déroulement des appels et les rapports " +
            "de plantage en un seul partage",
    )
}
