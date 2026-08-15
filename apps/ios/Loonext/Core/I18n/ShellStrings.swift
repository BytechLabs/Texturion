import Foundation

/// #228 — the app's PLUMBING, in both languages: the front door, the shell
/// around every screen, the You sheet, the update notice, the two-factor wall,
/// the joining orientation and its notification ask, the app lock, and the
/// developer Diagnostics surface.
///
/// These are the words nobody opens the app to read, which is exactly why they
/// matter: a French reader who meets an English sign-in screen, an English tab
/// bar and an English unlock screen has a French app in the middle and an
/// English one around the edges, and that reads as a translation somebody
/// abandoned halfway.
///
/// ## The register, and where it came from
///
/// Quebec French, VOUVOIEMENT, accents spelled normally — the GSM-7 restriction
/// in `MessageLocale` governs the automated TEXTS, which are billed per segment,
/// and nothing on a screen is. Vocabulary held steady with the other two
/// clients: texto · conversation · client · équipe · espace de travail · numéro ·
/// tâche · paramètres · boîte de réception.
///
/// Where Android or web has already translated the same sentence, its key name
/// AND its French are copied character for character rather than written again —
/// `apps/android/.../core/i18n/ShellStrings.kt` for the nav, the You sheet, the
/// lock and the orientation, `apps/web/src/i18n/sections/shell.ts` for the
/// update notice, and `.../onboarding.ts` for the sign-in words. Two clients
/// each having a go at "Sign out" is how a product ends up with two names for
/// one button.
///
/// A HANDFUL OF KEYS ARE iOS'S ALONE, and each is here because this app says a
/// different sentence rather than because nobody looked: the avatar reads "You"
/// where Android's reads "Account", the update card asks somebody to update
/// where web asks them to reload, and the app-switcher cover has no Android twin
/// at all (that platform has `FLAG_SECURE` instead). Changing any of them to
/// match would be a copy change wearing a translation's clothes.
///
/// Product names (Loonext, Stripe, Telnyx, Lou, Google, Apple), the domain in
/// the hand-off copy, and the carrier keywords are never translated: a carrier
/// matches on them, and a person told to open app.loonext.com needs the address
/// they will actually type.
enum ShellStrings {
    static let section = AppStrings.Section(
        name: "ShellStrings",
        en: [
            // #228 — the Wi-Fi-only photo setting, named by packages/shared.
            "shell.meteredHint": "You're on mobile data. Tap to load the full-size photo.",
            "shell.wifiOnlyLabel": "Full-size photos on Wi-Fi only",
            "shell.wifiOnlyDescription": "Threads and galleries always load. Only full-size photos and downloads wait for Wi-Fi — tap one to load it anyway.",
            // ── The front door (#166) ─────────────────────────────────────────
            "shell.authLoginTitle": "The whole crew,\none business number.",
            "shell.authLoginSub":
                "Texts, calls, and the jobs that come from them — together in one inbox.",
            "shell.authContinueGoogle": "Continue with Google",
            "shell.authOr": "or",
            "shell.authEmail": "Email",
            "shell.authPassword": "Password",
            "shell.authName": "Your name",
            "shell.authSignIn": "Sign in",
            "shell.authSigningIn": "Signing in…",
            "shell.authForgot": "Forgot password?",
            "shell.authNewHere": "New to Loonext? Create your account",
            "shell.authSignUpTitle": "Create your account",
            "shell.authSignUpSub": "Your business number in minutes.",
            "shell.authPasswordHint": "At least 8 characters.",
            "shell.authCreateAccount": "Create account",
            "shell.authCreating": "Creating account…",
            "shell.authHaveAccount": "Already have an account? Sign in",
            "shell.authCheckEmailTitle": "Check your email",
            "shell.authCheckEmailSub":
                "Confirm your account from the email we just sent, then sign in.",
            "shell.authCheckEmailNote":
                "Check your email to confirm your account, then sign in.",
            "shell.authBackToSignIn": "Back to sign in",
            "shell.authResetTitle": "Reset your password",
            "shell.authResetSub": "We'll email you a reset link. It works for an hour.",
            "shell.authResetNote":
                "If that email has an account, a reset link is on its way. "
                + "Didn't get it? Check spam.",
            "shell.authSendResetLink": "Send reset link",
            "shell.authSending": "Sending…",
            "shell.authRemembered": "Remembered it? Back to sign in",
            /*
             * The three fallbacks, used only when a failure arrives with nothing
             * to say. Every other auth failure renders the server's own sentence
             * verbatim, because those are the API's to word and to translate.
             */
            "shell.authSignInFailed": "Sign-in failed.",
            "shell.authSignUpFailed": "Sign-up failed.",
            "shell.authResetFailed": "Couldn't send the reset email.",
            "shell.authCaptchaRejected":
                "That security check didn't go through. Please try again.",

            /*
             * ── The two native sign-in buttons, when they go wrong ────────────
             *
             * Android's `auth.googleNotConfigured` and its French are copied
             * verbatim; so is `settingsMore.cantReachSignIn`'s. The rest have no
             * twin on either other client and are written here: Android hands
             * OAuth to an external browser and has no Apple button at all, so
             * its failures are not these failures.
             *
             * Google and Apple are product names and are never translated.
             */
            "shell.authGoogleNotConfigured": "Google sign-in isn't set up for this app yet.",
            "shell.authSignInInterrupted": "Sign-in was interrupted. Try again.",
            "shell.authGoogleFailed": "Google sign-in failed ({error}). Try again.",
            "shell.authGoogleNoCode": "Google didn't return a sign-in code. Try again.",
            "shell.authGoogleWindowFailed":
                "Couldn't open the Google sign-in window. Try again.",
            "shell.authSignInUnreachable":
                "Can't reach the sign-in service. Check your connection.",
            "shell.authAppleIncomplete": "Apple sign-in didn't complete. Try again.",
            "shell.authAppleNoCredential":
                "Apple didn't return a usable credential. Try again.",

            // ── The captcha bridge ────────────────────────────────────────────
            "shell.captchaTitle": "Quick security check",
            "shell.captchaLoadFailed":
                "Couldn't load the security check. Check your connection.",

            // ── The two-factor wall (#496/#314) ───────────────────────────────
            "shell.mfaChallengeTitle": "Enter your code",
            "shell.mfaChallengeBody":
                "Open your authenticator app and type the six digits it shows.",
            "shell.mfaEnrolTitle": "This workspace needs two-factor",
            "shell.mfaEnrolBody":
                "The owner turned it on, and the grace period has ended. Open your "
                + "authenticator app, add the key below, then type the six digits it shows.",
            "shell.mfaRecoveryTitle": "Use a recovery code",
            "shell.mfaRecoveryBody":
                "One of the ten codes you saved when you set two-factor up. Using one "
                + "turns two-factor OFF so you can get in and set it up again.",
            "shell.mfaOpenAuthenticator": "Open my authenticator",
            "shell.mfaNoAuthenticatorApp":
                "No authenticator app answered. Copy the key below instead.",
            "shell.mfaSixDigitLabel": "Six-digit code",
            "shell.mfaRecoveryCodeLabel": "Recovery code",
            "shell.mfaChecking": "Checking…",
            "shell.mfaUseThisCode": "Use this code",
            "shell.mfaContinue": "Continue",
            "shell.mfaHaveItAfterAll": "I have my authenticator after all",
            "shell.mfaNoAuthenticator": "I don't have my authenticator",
            "shell.mfaSetupFailed": "Couldn't start setup. Try again.",
            "shell.mfaCodeInvalid": "That code is not valid.",
            "shell.mfaNoFactorFound":
                "We couldn't find an authenticator on this account. Sign out and back in.",
            "shell.mfaCodeMismatch":
                "That code didn't match. Check your app and try the next one.",

            // ── The two signed-in interstitials the web still owns ────────────
            "shell.needsWorkspaceTitle": "Let's set up your workspace",
            "shell.needsWorkspaceBody":
                "Workspace creation and checkout live on the web for now. "
                + "Create yours at app.loonext.com, then come back and refresh.",
            "shell.needsWorkspaceCta": "Open app.loonext.com",
            "shell.needsCheckoutTitle": "Finish setting up",
            "shell.needsCheckoutBody":
                "Your workspace hasn't completed checkout yet. Finish on the web "
                + "and your number, texting, and calling light up here.",
            "shell.needsCheckoutCta": "Finish checkout",
            "shell.externalRefresh": "I've done this — refresh",
            /**
             * The bootstrap's own last resort, written where there is no view —
             * see `RootViewModel`. Every OTHER failure on that path renders the
             * server's own sentence verbatim.
             */
            "shell.bootstrapFailed": "Couldn't load your workspace.",

            // ── The nav pill, and what a screen reader calls it ───────────────
            "shell.navForYou": "For you",
            "shell.navInbox": "Inbox",
            "shell.navCalls": "Calls",
            "shell.navTasks": "Tasks",
            "shell.navContacts": "Contacts",
            "shell.newMessage": "New message",
            "shell.you": "You",
            /**
             * iOS's avatar says "You" where Android's says "Account", so this is
             * NOT `shell.accountUnread`. Same feature, different sentence — and
             * an extraction does not get to pick.
             */
            "shell.youUnread": "You, {count} unread notifications",

            // ── The You sheet ─────────────────────────────────────────────────
            "shell.identityLine": "{name} · {role}",
            "shell.theme": "Theme",
            "shell.notifications": "Notifications",
            "shell.settings": "Settings",
            "shell.signOut": "Sign out",
            "shell.unreadNew": "{count} new",
            "shell.workspaces": "Workspaces",
            "shell.currentWorkspace": "Current",
            "shell.copyNumber": "Copy number",
            "shell.toastView": "View",

            // ── The update notice, and the floor (#339) ───────────────────────
            "shell.updateReadyTitle": "A newer version of Loonext is ready",
            "shell.updateReadyBody": "Update to pick up the latest fixes.",
            "shell.updateAction": "Update",
            "shell.updateDismiss": "Dismiss update notice",
            "shell.updateBlockTitle": "Loonext needs an update",
            "shell.updateBlockBody":
                "This version can no longer connect safely. Update to continue.",
            "shell.updateBlockAction": "Update Loonext",
            "shell.updateVersion": "You are on {version}",
            "shell.updateUnknownVersion": "an unknown version",
            "shell.updateMinimum": " · {version} or newer is required",

            // ── The app lock (#330) and the switcher cover (#581) ─────────────
            // Never a fault, in either language: nothing has gone wrong, the
            // person turned this on, and the phone is theirs. `AppLockTests`
            // pins that for the English (it forbids "expired", "error",
            // "failed", "invalid", "denied"), so a French rewording must hold
            // the same promise.
            "shell.lockHeadlineInbox": "Unlock to see your inbox",
            "shell.lockHeadlineFinish": "Unlock to finish turning this on",
            // Says whose data it is protecting, not whose fault this is.
            "shell.lockBody": "Your customers' conversations are on this phone.",
            "shell.lockAction": "Unlock",
            "shell.lockPromptSubtitle": "Your customers' conversations are on this phone",
            /**
             * The one word on the app-switcher card. iOS-only: Android sets
             * `FLAG_SECURE` and gets a blank from the system instead.
             */
            "shell.lockedCover": "Locked",

            /*
             * ── The joining member's orientation (#286/#521) ──────────────────
             *
             * These four screens are ALSO on web and Android, and
             * `packages/shared/src/member-orientation-copy.test.ts` reads all
             * three sources so the ports cannot drift. That guard reads THIS
             * file for the iOS half — the words moved here, so the guard
             * followed them, exactly as it already follows Android's into
             * `core/i18n/ShellStrings.kt` and web's into
             * `i18n/sections/onboarding.ts`.
             *
             * The order of the four is load-bearing too: the guard asserts the
             * notification screen comes after the inbox one, because "requested
             * with context, not cold" is three screens of reason and then the ask.
             */
            "shell.orientationInboxTitle": "One inbox, the whole crew",
            "shell.orientationInboxBody":
                "Every text your customers send lands here, and everyone on the "
                + "crew can see it. Nothing sits unanswered in one person's phone.",
            "shell.orientationNumberTitle": "You answer as the business",
            "shell.orientationNumberBody":
                "Your replies go out from the workspace's number, so customers "
                + "never get your personal one. If a number isn't shared with you, "
                + "Settings tells you which and why.",
            "shell.orientationNotesTitle": "Notes stay inside",
            "shell.orientationNotesBody":
                "Switch the composer to Note and only the crew sees it — the "
                + "customer never does. Mention a teammate in one and it lands on "
                + "their For you.",
            "shell.orientationNotificationsTitle": "You choose when we buzz you",
            "shell.orientationNotificationsBody":
                "You're joining a workspace that already has traffic. Turn on "
                + "notifications for the work meant for you, and change them any "
                + "time in Settings.",
            "shell.orientationSays": "{name} says",
            "shell.orientationTheySaid": "They said",
            "shell.orientationSkip": "Skip",
            "shell.orientationNext": "Next",
            "shell.orientationStartWorking": "Start working",
            "shell.orientationStepOf": "Step {index} of {total}",

            // ── The notification ask, standalone and at the end of the flow ───
            "shell.notificationsTurnOn": "Turn on notifications",
            "shell.notificationsNotNow": "Not now",
            "shell.primerTitle": "Want a nudge when work comes in?",
            "shell.primerBody":
                "We'll buzz you for new customer texts, missed calls and "
                + "the work assigned to you — nothing else. You can "
                + "change what reaches you, and when, in Settings.",

            // ── Settings › Profile: the language THIS person reads (#228) ─────
            "shell.languageTitle": "Your language",
            "shell.languageDescription":
                "The language this app is drawn in for you. Everyone on the crew "
                + "picks their own, so changing it here changes nothing for anybody else.",
            "shell.languageSameAsPhone": "Same as my phone",
            "shell.languageFollowingDevice": "Right now that is {language}.",
            "shell.languageNotCustomers":
                "This is not the language your customers are texted in. That one "
                + "belongs to the workspace, under Workspace.",
            "shell.languageSaved": "Language updated.",

            // ── The country picker (#214) ─────────────────────────────────────
            "shell.country": "Country",
            "shell.countryNotSet": "Not set",
            "shell.countrySearch": "Search countries",
            "shell.countryNoMatch": "No countries match \"{query}\".",

            /*
             * ── When calling itself refuses (#136…) ──────────────────────────
             *
             * The live call's own words — Answer, Decline, Hold, the transfer
             * sheet — are NOT here: `ContactsTasksStrings` carries them, because
             * that is where Android files the whole call screen
             * (`contactsTasks.answer`, `contactsTasks.transferThisCall`) and
             * where this app's `CallsView` already reads them from. A second
             * copy under `shell.` would be the drift the catalogue exists to
             * prevent.
             *
             * What IS here is the handful `SoftphoneCore` throws before there is
             * a call to talk about, plus the four words the ongoing-call CARD
             * says. Those have no `contactsTasks.` twin, and web keeps its
             * equivalents under `shell.` (`i18n/sections/shell.ts`:
             * `tooManyCalls`, `lineUnreachable`), so the key names below are
             * that file's.
             */
            "shell.ringing": "Ringing…",
            "shell.withMember": "With {who}",
            "shell.onTheLine": "On the line",
            "shell.leavingVoicemail": "Leaving a voicemail",
            "shell.callingTemporarilyUnavailable": "Calling is temporarily unavailable.",
            "shell.callingNotReady": "Calling isn't ready yet. Try again in a moment.",
            "shell.tooManyCalls": "You're already on two calls.",
            "shell.callStartFailedPleaseRetry": "Couldn't start the call. Please try again.",
            "shell.lineUnreachable": "Couldn't reach the line. Please try again.",
            "shell.phoneConnectFailed":
                "Couldn't connect your phone. Check your connection and try again.",

            /*
             * ── What a push says when the server sent no words ────────────────
             *
             * The server writes the real title and body; these are the
             * last-resort fallbacks for a payload that arrived with neither, and
             * they are the Android twin's (`push/PushPayload.kt`) verbatim so a
             * crew carrying one of each phone reads one product.
             */
            "shell.pushCallTitle": "Incoming call",
            "shell.pushCallBody": "Someone is calling your business number.",
            "shell.pushGenericBody": "You have a new notification.",

            // ── A voicemail's words, and lifting them off the screen (#566) ───
            "shell.copyTranscript": "Copy transcript",

            // ── Diagnostics (#337/#485), the developer surface behind seven taps
            "shell.diagTitle": "Diagnostics",
            "shell.diagDevice": "Device",
            "shell.diagRecentEvents": "Recent events",
            "shell.diagNoEvents": "Nothing recorded on this device.",
            "shell.diagCrashes": "Crashes",
            // Says WHY it might be empty. MetricKit hands crashes over on
            // Apple's schedule, not ours, so a list that is empty right after a
            // crash means "not delivered yet" — and without this line it reads
            // as "the capture is broken".
            "shell.diagNoCrashes":
                "None captured. iOS hands crash reports over on its "
                + "own schedule, usually within a day, so a crash "
                + "from just now may not be here yet.",
            "shell.diagShareEverything": "Share everything",
            "shell.diagShareCaption": "Device facts and recent events in one message",
            "shell.diagClearEvents": "Clear events",
            "shell.diagClearTitle": "Clear recorded events?",
            "shell.diagClearBody":
                "This is the only copy. Share it first if somebody asked for it.",
            "shell.diagClearAll": "Clear events and crashes",
            "shell.diagKeep": "Keep",
            "shell.diagBuild": "build {version}",
            "shell.diagNoReason": "No reason reported",
        ],
        frCA: [
            "shell.meteredHint": "Vous êtes sur les données mobiles. Touchez pour charger la photo en pleine résolution.",
            "shell.wifiOnlyLabel": "Photos en pleine résolution sur Wi-Fi seulement",
            "shell.wifiOnlyDescription": "Les conversations et les galeries se chargent toujours. Seules les photos en pleine résolution et les téléchargements attendent le Wi-Fi — touchez-en une pour la charger quand même.",
            "shell.authLoginTitle": "Toute l'équipe,\nun seul numéro d'entreprise.",
            "shell.authLoginSub":
                "Les textos, les appels et le travail qui en découle — réunis dans une seule boîte de réception.",
            "shell.authContinueGoogle": "Continuer avec Google",
            "shell.authOr": "ou",
            "shell.authEmail": "Courriel",
            "shell.authPassword": "Mot de passe",
            "shell.authName": "Votre nom",
            "shell.authSignIn": "Se connecter",
            "shell.authSigningIn": "Connexion…",
            "shell.authForgot": "Mot de passe oublié ?",
            "shell.authNewHere": "Nouveau sur Loonext ? Créez votre compte",
            "shell.authSignUpTitle": "Créez votre compte",
            "shell.authSignUpSub": "Votre numéro d'entreprise en quelques minutes.",
            "shell.authPasswordHint": "Au moins 8 caractères.",
            "shell.authCreateAccount": "Créer le compte",
            "shell.authCreating": "Création du compte…",
            "shell.authHaveAccount": "Vous avez déjà un compte ? Connectez-vous",
            "shell.authCheckEmailTitle": "Vérifiez vos courriels",
            "shell.authCheckEmailSub":
                "Confirmez votre compte à partir du courriel que nous venons "
                + "d'envoyer, puis connectez-vous.",
            "shell.authCheckEmailNote":
                "Vérifiez vos courriels pour confirmer votre compte, puis connectez-vous.",
            "shell.authBackToSignIn": "Retour à la connexion",
            "shell.authResetTitle": "Réinitialisez votre mot de passe",
            "shell.authResetSub":
                "Nous vous enverrons un lien de réinitialisation par courriel. "
                + "Il est valide une heure.",
            "shell.authResetNote":
                "Si un compte existe pour ce courriel, un lien de réinitialisation "
                + "est en route. Rien reçu ? Vérifiez vos pourriels.",
            "shell.authSendResetLink": "Envoyer le lien",
            "shell.authSending": "Envoi…",
            "shell.authRemembered": "Ça vous revient ? Retour à la connexion",
            "shell.authSignInFailed": "La connexion a échoué.",
            "shell.authSignUpFailed": "La création du compte a échoué.",
            "shell.authResetFailed": "Impossible d'envoyer le courriel de réinitialisation.",
            "shell.authCaptchaRejected":
                "La vérification de sécurité n'a pas abouti. Veuillez réessayer.",

            "shell.authGoogleNotConfigured":
                "La connexion avec Google n'est pas encore configurée pour cette application.",
            "shell.authSignInInterrupted": "La connexion a été interrompue. Réessayez.",
            "shell.authGoogleFailed":
                "La connexion avec Google a échoué ({error}). Réessayez.",
            "shell.authGoogleNoCode":
                "Google n'a pas renvoyé de code de connexion. Réessayez.",
            "shell.authGoogleWindowFailed":
                "Impossible d'ouvrir la fenêtre de connexion avec Google. Réessayez.",
            "shell.authSignInUnreachable":
                "Impossible de joindre le service de connexion. Vérifiez votre connexion.",
            "shell.authAppleIncomplete":
                "La connexion avec Apple ne s'est pas terminée. Réessayez.",
            "shell.authAppleNoCredential":
                "Apple n'a pas renvoyé d'identifiant utilisable. Réessayez.",

            "shell.captchaTitle": "Petite vérification de sécurité",
            "shell.captchaLoadFailed":
                "Impossible de charger la vérification de sécurité. Vérifiez votre connexion.",

            "shell.mfaChallengeTitle": "Entrez votre code",
            "shell.mfaChallengeBody":
                "Ouvrez votre application d'authentification et tapez les six chiffres affichés.",
            "shell.mfaEnrolTitle":
                "Cet espace de travail exige l'authentification à deux facteurs",
            "shell.mfaEnrolBody":
                "Le propriétaire l'a activée et la période de grâce est terminée. "
                + "Ouvrez votre application d'authentification, ajoutez la clé "
                + "ci-dessous, puis tapez les six chiffres affichés.",
            "shell.mfaRecoveryTitle": "Utiliser un code de récupération",
            "shell.mfaRecoveryBody":
                "Un des dix codes que vous avez conservés lors de la configuration. "
                + "En utiliser un DÉSACTIVE l'authentification à deux facteurs pour "
                + "que vous puissiez entrer et la reconfigurer.",
            "shell.mfaOpenAuthenticator": "Ouvrir mon application d'authentification",
            "shell.mfaNoAuthenticatorApp":
                "Aucune application d'authentification n'a répondu. Copiez plutôt la clé ci-dessous.",
            "shell.mfaSixDigitLabel": "Code à six chiffres",
            "shell.mfaRecoveryCodeLabel": "Code de récupération",
            "shell.mfaChecking": "Vérification…",
            "shell.mfaUseThisCode": "Utiliser ce code",
            "shell.mfaContinue": "Continuer",
            "shell.mfaHaveItAfterAll": "J'ai finalement mon application d'authentification",
            "shell.mfaNoAuthenticator": "Je n'ai pas mon application d'authentification",
            "shell.mfaSetupFailed": "Impossible de démarrer la configuration. Réessayez.",
            "shell.mfaCodeInvalid": "Ce code n'est pas valide.",
            "shell.mfaNoFactorFound":
                "Nous n'avons trouvé aucune application d'authentification sur ce "
                + "compte. Déconnectez-vous et reconnectez-vous.",
            "shell.mfaCodeMismatch":
                "Ce code ne correspond pas. Vérifiez votre application et essayez le suivant.",

            "shell.needsWorkspaceTitle": "Configurons votre espace de travail",
            "shell.needsWorkspaceBody":
                "La création de l'espace de travail et le paiement se font sur le "
                + "Web pour l'instant. Créez le vôtre sur app.loonext.com, puis "
                + "revenez et actualisez.",
            "shell.needsWorkspaceCta": "Ouvrir app.loonext.com",
            "shell.needsCheckoutTitle": "Terminer la configuration",
            "shell.needsCheckoutBody":
                "Votre espace de travail n'a pas encore terminé le paiement. "
                + "Terminez sur le Web et votre numéro, les textos et les appels "
                + "s'activeront ici.",
            "shell.needsCheckoutCta": "Terminer le paiement",
            "shell.externalRefresh": "C'est fait — actualiser",
            "shell.bootstrapFailed": "Impossible de charger votre espace de travail.",

            "shell.navForYou": "Pour vous",
            "shell.navInbox": "Boîte de réception",
            "shell.navCalls": "Appels",
            "shell.navTasks": "Tâches",
            "shell.navContacts": "Contacts",
            "shell.newMessage": "Nouveau texto",
            "shell.you": "Vous",
            "shell.youUnread": "Vous, {count} notifications non lues",

            "shell.identityLine": "{name} · {role}",
            "shell.theme": "Thème",
            "shell.notifications": "Notifications",
            "shell.settings": "Paramètres",
            "shell.signOut": "Se déconnecter",
            "shell.unreadNew": "{count} nouvelles",
            "shell.workspaces": "Espaces de travail",
            "shell.currentWorkspace": "Actuel",
            "shell.copyNumber": "Copier le numéro",
            "shell.toastView": "Voir",

            "shell.updateReadyTitle": "Une nouvelle version de Loonext est prête",
            "shell.updateReadyBody": "Mettez à jour pour obtenir les derniers correctifs.",
            "shell.updateAction": "Mettre à jour",
            "shell.updateDismiss": "Masquer l'avis de mise à jour",
            "shell.updateBlockTitle": "Loonext a besoin d'une mise à jour",
            "shell.updateBlockBody":
                "Cette version ne peut plus se connecter en toute sécurité. "
                + "Mettez à jour pour continuer.",
            "shell.updateBlockAction": "Mettre à jour Loonext",
            "shell.updateVersion": "Vous utilisez {version}",
            "shell.updateUnknownVersion": "une version inconnue",
            "shell.updateMinimum": " · {version} ou plus récente est requise",

            "shell.lockHeadlineInbox":
                "Déverrouillez pour voir votre boîte de réception",
            "shell.lockHeadlineFinish": "Déverrouillez pour terminer l'activation",
            "shell.lockBody": "Les conversations de vos clients sont sur ce téléphone.",
            "shell.lockAction": "Déverrouiller",
            "shell.lockPromptSubtitle":
                "Les conversations de vos clients sont sur ce téléphone",
            "shell.lockedCover": "Verrouillé",

            "shell.orientationInboxTitle": "Une boîte de réception, toute l'équipe",
            "shell.orientationInboxBody":
                "Chaque texto que vos clients envoient arrive ici, et toute l'équipe "
                + "peut le voir. Rien ne reste sans réponse dans le téléphone d'une "
                + "seule personne.",
            "shell.orientationNumberTitle": "Vous répondez au nom de l'entreprise",
            "shell.orientationNumberBody":
                "Vos réponses partent du numéro de l'espace de travail, alors les "
                + "clients n'obtiennent jamais votre numéro personnel. Si un numéro "
                + "n'est pas partagé avec vous, les paramètres vous disent lequel et "
                + "pourquoi.",
            "shell.orientationNotesTitle": "Les notes restent à l'interne",
            "shell.orientationNotesBody":
                "Basculez le rédacteur en mode Note et seule l'équipe la voit — "
                + "jamais le client. Mentionnez un coéquipier dans une note et elle "
                + "arrive dans son Pour vous.",
            "shell.orientationNotificationsTitle":
                "Vous choisissez quand nous vous avertissons",
            "shell.orientationNotificationsBody":
                "Vous joignez un espace de travail qui a déjà du trafic. Activez les "
                + "notifications pour le travail qui vous est destiné, et modifiez-les "
                + "quand vous voulez dans les paramètres.",
            "shell.orientationSays": "{name} dit",
            "shell.orientationTheySaid": "On a écrit",
            "shell.orientationSkip": "Passer",
            "shell.orientationNext": "Suivant",
            "shell.orientationStartWorking": "Commencer à travailler",
            "shell.orientationStepOf": "Étape {index} sur {total}",

            "shell.notificationsTurnOn": "Activer les notifications",
            "shell.notificationsNotNow": "Pas maintenant",
            "shell.primerTitle": "Voulez-vous être averti quand du travail arrive ?",
            "shell.primerBody":
                "Nous vous avertirons pour les nouveaux textos de clients, les appels "
                + "manqués et le travail qui vous est attribué — rien d'autre. Vous "
                + "pouvez changer ce qui vous parvient, et quand, dans les paramètres.",

            "shell.languageTitle": "Votre langue",
            "shell.languageDescription":
                "La langue dans laquelle cette application vous est présentée. Chaque "
                + "membre de l'équipe choisit la sienne, alors la changer ici ne change "
                + "rien pour les autres.",
            "shell.languageSameAsPhone": "Comme mon téléphone",
            "shell.languageFollowingDevice": "En ce moment, c'est {language}.",
            "shell.languageNotCustomers":
                "Ce n'est pas la langue des textos envoyés à vos clients. Celle-là "
                + "appartient à l'espace de travail, sous Espace de travail.",
            "shell.languageSaved": "Langue mise à jour.",

            "shell.country": "Pays",
            "shell.countryNotSet": "Non défini",
            "shell.countrySearch": "Rechercher un pays",
            "shell.countryNoMatch": "Aucun pays ne correspond à « {query} ».",

            // ── When calling itself refuses ───────────────────────────────────
            "shell.ringing": "Sonnerie…",
            "shell.withMember": "Avec {who}",
            "shell.onTheLine": "En ligne",
            "shell.leavingVoicemail": "Laisse un message vocal",
            "shell.callingTemporarilyUnavailable":
                "Les appels sont temporairement indisponibles.",
            "shell.callingNotReady":
                "Les appels ne sont pas encore prêts. Réessayez dans un moment.",
            "shell.tooManyCalls": "Vous avez déjà deux appels en cours.",
            "shell.callStartFailedPleaseRetry":
                "Impossible de lancer l'appel. Veuillez réessayer.",
            "shell.lineUnreachable": "Impossible de joindre la ligne. Veuillez réessayer.",
            "shell.phoneConnectFailed":
                "Impossible de connecter votre téléphone. Vérifiez votre connexion "
                + "et réessayez.",

            "shell.pushCallTitle": "Appel entrant",
            "shell.pushCallBody": "Quelqu'un appelle le numéro de votre entreprise.",
            "shell.pushGenericBody": "Vous avez une nouvelle notification.",

            "shell.copyTranscript": "Copier la transcription",

            "shell.diagTitle": "Diagnostics",
            "shell.diagDevice": "Appareil",
            "shell.diagRecentEvents": "Événements récents",
            "shell.diagNoEvents": "Rien n'a été enregistré sur ce téléphone.",
            "shell.diagCrashes": "Plantages",
            "shell.diagNoCrashes":
                "Aucun rapport capturé. iOS transmet les rapports de plantage selon "
                + "son propre calendrier, généralement en moins d'une journée : un "
                + "plantage tout juste survenu peut ne pas encore figurer ici.",
            "shell.diagShareEverything": "Tout partager",
            "shell.diagShareCaption":
                "Les données de l'appareil et les événements récents en un seul message",
            "shell.diagClearEvents": "Effacer les événements",
            "shell.diagClearTitle": "Effacer les événements enregistrés ?",
            "shell.diagClearBody":
                "C'est la seule copie. Partagez-la d'abord si quelqu'un vous l'a demandée.",
            "shell.diagClearAll": "Effacer les événements et les plantages",
            "shell.diagKeep": "Conserver",
            "shell.diagBuild": "version {version}",
            "shell.diagNoReason": "Aucune raison signalée",
        ]
    )
}
