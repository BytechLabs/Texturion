/**
 * #228 — the words the app shell and calling says, in both languages.
 *
 * One file per surface so the extraction can run in parallel without every
 * change colliding in one catalogue, and so a translator working through a
 * screen sees its strings adjacent rather than sorted by concept.
 *
 * `fr` is typed as `en`'s exact shape: a key added to one and forgotten in the
 * other fails `tsc`. That is the whole reason this is TypeScript rather than
 * the JSON a library would want — a missing key in a JSON message file is a
 * runtime fallback nobody sees until a French reader does.
 */
import type { Translated } from "../translated";

export const shellEn = {
  /* #228 — the Wi-Fi-only photo setting and the tap-to-load hint. */
  meteredHint: "You're on mobile data. Tap to load the full-size photo.",
  wifiOnlyLabel: "Full-size photos on Wi-Fi only",
  wifiOnlyDescription: "Threads and galleries always load. Only full-size photos and downloads wait for Wi-Fi — tap one to load it anyway.",
  /*
   * #265 — handing the phone to somebody else. Both phones have said these since #228 reached them; the web imported the shared constants and rendered whatever English came back. The unsent-message warning's singular and plural are separate keys: French agrees the noun and its verb with the count.
   */
  handOverAction: "Hand this phone to someone else",
  handOverBody: "You'll be signed out and everything from this workspace comes off this phone: the conversations, your customers' details, and the unread counts. The next person signs in as themselves.",
  handOverCancel: "Stay signed in",
  handOverConfirm: "Sign out and clear",
  handOverTitle: "Hand this phone over?",
  handOverUnsentMany: "{count} messages haven't sent yet and will be discarded. If they matter, stay signed in until you have signal.",
  handOverUnsentOne: "One message hasn't sent yet and will be discarded. If it matters, stay signed in until you have signal.",


  // ── The frame ────────────────────────────────────────────────────────────
  skipToContent: "Skip to content",
  offline:
    "You’re offline. What’s already open stays readable, and Loonext will " +
    "catch up on its own once you’re back.",
  sessionExpired: "Your session has expired. Sign in again to continue.",
  goToSignIn: "Go to sign in",
  newConversation: "New conversation",

  // ── The account, the workspace ───────────────────────────────────────────
  you: "You",
  signOut: "Sign out",
  signingOut: "Signing out…",
  signOutFailed: "Couldn't sign out. Check your connection and try again.",
  workspaces: "Workspaces",
  switchWorkspace: "Switch workspace",
  workspaceNamed: "Workspace: {name}",
  accountAndSettings: "Account and settings",
  accountAndSettingsUnread:
    "Account and settings, {count} unread notifications",
  accountSheetDescription:
    "Workspace, business numbers, notifications, theme, and sign out.",
  businessNumbers: "Business numbers",
  notifications: "Notifications",
  unreadCount: "{count} unread",

  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",

  /** Role names as a person would read them (sidebar footer tile). */
  roleOwner: "Owner",
  roleAdmin: "Admin",
  roleMember: "Member",
  roleReadOnly: "View only",
  roleBookkeeper: "Bookkeeper",

  // ── Navigation ───────────────────────────────────────────────────────────
  navForYou: "For you",
  /**
   * The bottom tab bar's own spelling of the same destination. Kept as a second
   * key rather than normalised, because #228 is an extraction: changing the
   * capital Y would be a copy change wearing a translation's clothes.
   */
  navForYouTitleCase: "For You",
  navInbox: "Inbox",
  navCalls: "Calls",
  navTasks: "Tasks",
  navContacts: "Contacts",
  navScheduled: "Scheduled",
  navSettings: "Settings",
  navBilling: "Billing",
  navCount: "{label}, {count}",
  primaryNav: "Primary",

  search: "Search",
  searchShortcut: "Search · ⌘K",
  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",

  // ── The business number strip ────────────────────────────────────────────
  numberCopied: "Number copied.",
  copyBlocked: "Couldn't copy. Your browser blocked clipboard access.",
  copyNumber: "Copy {number}",
  numberSetupFailed: "Couldn't set up — choose a number",
  numberSettingUp: "Setting up your number…",

  // ── The workspace status strip (SPEC §4.4, DESIGN.md G7) ─────────────────
  //
  // `components/registration/copy.ts` holds these as data rather than as JSX,
  // because the ambient strip, the /onboarding/setting-up checklist, the plan
  // step and the empty inbox all say them — and a workspace that is not ready
  // yet must not be described three different ways depending on which screen
  // somebody happens to be looking at.
  //
  // The timing promises are the load-bearing part. "usually under a minute"
  // belongs to a provisioned number and NEVER to a carrier review, which takes
  // days; keep the two apart in French as well.
  regNumberProvisioning: "Setting up your business number, usually under a minute.",
  regNumberDelayed:
    "We're still setting up your number. This is taking a little longer than usual.",
  regNumberActionNeededAreaCode:
    "We couldn't get a number in area code {areaCode}. Choose another to finish setup.",
  regNumberActionNeeded:
    "We couldn't finish setting up your number. Choose a number to finish setup.",
  regHostedReview:
    "Text-enabling your existing number. Carrier review usually takes a few business days. Calls keep working the whole time.",
  regPending:
    "US texting activates in ~3 to 7 business days (carrier approval). Calling, receiving texts, and texting Canadian numbers already work.",
  regOtpPending:
    "One step left: enter the verification code we sent to {phone} to finish US registration.",
  regRejected:
    "US registration needs a fix: {reason}. Update and resubmit. It takes 2 minutes.",
  regApproved: "US texting is live.",
  regApprovedToast: "You're live. US texting is on.",
  regSetupUnfinishedMember:
    "Your workspace setup isn't finished yet. Ask your account owner to complete it.",
  regSubscriptionCanceled:
    "Your subscription is canceled. Outbound texting is off. Resubscribe to turn it back on.",
  regPaymentIssue:
    "Payment didn't go through. Outbound texting is paused. Update your card to restore it.",
  /* The two later tiers of `provisioningWaitCopy`: the under-a-minute promise
     de-escalating as the clock runs, so a slow setup is never a frozen lie. */
  regWaitLonger:
    "Your number is taking a little longer than usual. We're still on it — you don't have to wait here.",
  regWaitStill:
    "Still setting up your number — this is taking a little longer than usual. Hang tight.",
  /* The honest timeline shown before payment (SPEC §4.1 step 4). */
  regHonestTimelineReceiving:
    "Receiving texts works the moment your number is ready (minutes).",
  regHonestTimelineCanada: "Texting Canadian numbers works immediately.",
  regHonestTimelineUs:
    "Texting US numbers activates after carrier approval, typically 3 to 7 business days. We'll email you the moment you're approved.",
  regHonestTimelineUsOff:
    "US texting is off for your account. You can turn it on any time in Settings.",
  /* The strip's own action links, and the two stand-ins for a fact we do not
     have: the mobile number the code went to, and the carrier's reason. */
  regBannerUpdateBilling: "Update billing",
  regBannerEnterCode: "Enter code",
  regBannerFixResubmit: "Fix and resubmit",
  regBannerChooseNumber: "Choose a number",
  regBannerDetails: "Details",
  regBannerYourMobile: "your mobile",
  regBannerReasonUnknown: "the carrier flagged a detail",

  // ── The two-factor wall ──────────────────────────────────────────────────
  mfaRequiredTitle: "This workspace needs two-factor authentication",
  mfaRequiredBody:
    "The owner turned it on, and the grace period has ended. Set it up once " +
    "and you're back in — it takes about a minute and needs an authenticator " +
    "app on your phone.",
  mfaSetUp: "Set up two-factor",
  mfaDone: "I've done it",

  // ── The update notice, and the floor ─────────────────────────────────────
  updateReadyTitle: "A newer version of Loonext is ready",
  updateReadyBody: "Reload to pick up the latest fixes.",
  updateReload: "Reload now",
  updateDismiss: "Dismiss update notice",
  updateBlockTitle: "Loonext needs an update",
  updateBlockBody:
    "This version can no longer connect safely. Reload to get the current one.",
  updateBlockAction: "Reload Loonext",
  updateVersion: "You are on {version}",
  updateUnknownVersion: "an unknown version",
  updateMinimum: " · {version} or newer is required",

  // ── The command palette ──────────────────────────────────────────────────
  paletteTitle: "Command palette",
  paletteDescription:
    "Jump to a conversation, contact, task, file, template, or page, or act " +
    "on the open conversation",
  paletteSearchPlaceholder: "Search conversations, contacts, tasks, files…",
  noMatches: "No matches.",
  searching: "Searching…",
  searchFailed: "Couldn't search — check your connection and try again.",
  thisConversation: "this conversation",
  conversationActionsContext: "{name} · actions apply to this conversation",
  actionsOnConversation: "Actions on this conversation",
  markDone: "Mark done",
  conversationClosed: "Conversation closed",
  updateFailed: "Couldn't update.",
  unassign: "Unassign",
  unassigned: "Unassigned",
  assignTo: "Assign to {name}",
  assignedTo: "Assigned to {name}",
  teammate: "Teammate",
  /** The same fallback mid-sentence, where the English does not capitalise. */
  teammateInline: "teammate",
  changeStatus: "Change status",
  statusNew: "New",
  statusOpen: "Open",
  statusWaiting: "Waiting",
  statusClosed: "Closed",
  markedStatus: "Marked {status}",
  groupConversations: "Conversations",
  groupAttachments: "Attachments",
  groupVoicemails: "Voicemails",
  groupTemplates: "Templates",
  groupActions: "Actions",
  groupGoTo: "Go to",
  chipNote: "Note",
  chipTask: "Task",
  chipDone: "Done",

  // ── Calling: shared words ────────────────────────────────────────────────
  loading: "Loading…",
  voicemail: "Voicemail",

  // ── Can this browser ring? ───────────────────────────────────────────────
  phoneReady: "Ready",
  phoneCantRing: "Can't ring",
  phoneConnecting: "Connecting…",
  phoneReadyTitle: "Your browser will ring for incoming calls",
  phoneFailedTitle:
    "This browser won't ring for incoming calls. It keeps trying, and " +
    "reloading the page retries now.",
  phoneConnectingTitle:
    "Connecting your phone — incoming calls won't ring until this is ready",

  // ── The call bar ─────────────────────────────────────────────────────────
  transferTo: "Transfer to",
  noTransferTargets: "Nobody else has their phone open right now.",
  transferring: "Transferring to {name}…",
  transferFailed: "Couldn't transfer. Try again.",
  onACall: "On a call",
  onACallEllipsis: "On a call…",
  incomingCallFrom: "Incoming call from",
  answer: "Answer",
  decline: "Decline",
  answerFailed: "Couldn't answer the call.",
  callOnHold: "{name} · on hold",
  resumeCall: "Resume call with {name}",
  hangUpHeldCall: "Hang up held call",
  callEnded: "{name} · ended",
  dismiss: "Dismiss",
  keypad: "Keypad",
  closeKeypad: "Close keypad",
  calling: "Calling…",
  openConversationForNotes: "Open the conversation to take notes",
  findingConversation: "Finding this call's conversation…",
  noConversationForCallAria:
    "This call has no conversation to take notes in",
  noConversationForCall: "No conversation for this call",
  transferThisCall: "Transfer this call",
  connectingCallToServer: "Connecting this call to the server…",
  putOnHold: "Put on hold",
  mute: "Mute",
  unmute: "Unmute",
  hangUp: "Hang up",

  // ── Starting a call ──────────────────────────────────────────────────────
  callingUnavailable:
    "Calling isn't available right now. Try reloading the app.",
  callStartFailedRetry: "Couldn't start the call. Try again.",
  callStartFailed: "Couldn't start the call.",
  callContact: "Call {name} from your business number",
  dial: "Dial",
  dialANumber: "Dial a number",
  enterANumber: "Enter a number",
  matchingContacts: "Matching contacts",
  callFrom: "Call from",
  fromNumber: "From {number}",
  call: "Call",
  textAction: "Text",
  sendMessageInstead: "Send a message instead",
  deleteLastDigit: "Delete last digit",
  openContact: "Open contact",
  addContact: "Add contact",

  // ── The call log ─────────────────────────────────────────────────────────
  filterAll: "All",
  filterMissed: "Missed",
  filterVoicemail: "Voicemail",
  filterCalls: "Filter calls",
  recentCalls: "Recent calls",
  callsLoadFailed: "Couldn't load your calls.",
  checkConnection: "Check your connection and try again.",
  emptyMissed: "No missed calls. Nice.",
  emptyVoicemail: "No voicemails.",
  emptyCalls: "Calls to your business number will show up here.",
  emptyCallsDescription:
    "Calls ring right here in the app; unanswered ones go to your voicemail " +
    "and land in this log. Your greeting, call screening, and the missed-call " +
    "text-back live in Settings › Calling.",
  setUpCalls: "Set up calls",
  loadMore: "Load more",

  // ── Who is holding the line ──────────────────────────────────────────────
  ringing: "Ringing…",
  goingToVoicemail: "Going to voicemail",
  outgoingCall: "Outgoing call",
  withMember: "With {name}",
  aTeammate: "a teammate",
  onLine: "on {number}",
  ongoing: "Ongoing",
  ongoingCalls: "Ongoing calls",

  // ── One call, in a row and on its own page ───────────────────────────────
  unknownCaller: "Unknown caller",
  notLinkedToConversation: "Not linked to a conversation",
  callFromAria: "Call from {name}, {outcome}",
  loadingCall: "Loading call",
  allCalls: "All calls",
  directionLabel: "Direction",
  directionOutgoing: "Outgoing",
  directionIncoming: "Incoming",
  numberLabel: "Number",
  placedBy: "Placed by",
  answeredBy: "Answered by",
  startedLabel: "Started",
  endedLabel: "Ended",
  callerVerified: "Caller verified",
  callerVerifiedYes: "Yes",
  callerVerifiedPartly: "Partly ({attestation})",
  openConversation: "Open the conversation",
  viewContact: "View contact",

  /** What happened, in the words an owner would use (call-detail-copy.ts). */
  outcomeInProgress: "In progress",
  outcomeAnswered: "Answered",
  outcomeNoAnswer: "No answer",
  outcomeLeftVoicemail: "Left a voicemail",
  outcomeMissed: "Missed",
  /** The four honest not-transcribed states. */
  transcriptRecordingLost:
    "They started leaving a voicemail, but the recording didn't save.",
  transcriptNoVoicemail: "No voicemail was left on this call.",
  transcriptNoWords:
    "We couldn't make out any words in this one. The recording still plays.",
  transcriptNotYet:
    "This voicemail hasn't been written down yet. Playing it will do that.",

  // ── The recording, and its words ─────────────────────────────────────────
  voicemailRecording: "Voicemail recording",
  voicemailLoadFailed: "Couldn't load — retry",
  playVoicemail: "Play voicemail",
  playVoicemailWithLength: "Play voicemail ({duration})",
  spamLikely: "Spam likely",
  copyTranscript: "Copy transcript",
  transcriptCopied: "Transcript copied.",

  // ── The softphone itself ─────────────────────────────────────────────────
  micNoBrowserSupport:
    "This browser can't access a microphone. Try a recent Chrome, Edge, or " +
    "Safari.",
  micNotFound:
    "No microphone found. Connect or enable a mic, then try the call again.",
  micBlocked:
    "Microphone access is blocked. Click the 🎤 or 🔒 icon in your browser's " +
    "address bar, choose Allow, then try the call again.",
  micFailed:
    "Couldn't access your microphone. Check your browser's mic permission and " +
    "try again.",
  incomingCall: "Incoming call",
  registrationFailed: "Your browser can't receive calls right now.",
  callingTemporarilyUnavailable: "Calling is temporarily unavailable.",
  tooManyCalls: "You're already on two calls. Hang up one first.",
  callStartFailedPleaseRetry: "Couldn't start the call. Please try again.",
  lineUnreachable: "Couldn't reach the line. Please try again.",
} as const;

/**
 * Quebec French, vouvoiement throughout — the product speaks to the crew the
 * way a business speaks to a professional. Accents spelled normally: the GSM-7
 * restriction in `packages/shared/src/locale.ts` governs SMS bodies, which are
 * billed by the segment, and nothing on a web page is.
 *
 * Product names (Loonext, Telnyx, Stripe) and the ⌘K accelerator are left
 * alone, as are the browser's own button names quoted inside `micBlocked` —
 * "Allow" is what the reader will actually see in an English-locale Chrome, so
 * the French sentence names it as a quoted foreign word rather than
 * translating a label the browser will not use.
 */
export const shellFr: Translated<typeof shellEn> = {
  meteredHint: "Vous êtes sur les données mobiles. Touchez pour charger la photo en pleine résolution.",
  wifiOnlyLabel: "Photos en pleine résolution sur Wi-Fi seulement",
  wifiOnlyDescription: "Les conversations et les galeries se chargent toujours. Seules les photos en pleine résolution et les téléchargements attendent le Wi-Fi — touchez-en une pour la charger quand même.",
  handOverAction: "Confier ce téléphone à quelqu'un d'autre",
  handOverBody: "Vous serez déconnecté et tout ce qui vient de cet espace de travail quittera ce téléphone : les conversations, les coordonnées de vos clients et les compteurs de messages non lus. La prochaine personne se connectera en son propre nom.",
  handOverCancel: "Rester connecté",
  handOverConfirm: "Se déconnecter et tout effacer",
  handOverTitle: "Confier ce téléphone ?",
  handOverUnsentMany: "{count} messages ne sont pas encore envoyés et seront supprimés. Si c'est important, restez connecté jusqu'à ce que vous ayez du signal.",
  handOverUnsentOne: "Un message n'est pas encore envoyé et sera supprimé. Si c'est important, restez connecté jusqu'à ce que vous ayez du signal.",


  skipToContent: "Aller au contenu",
  offline:
    "Vous êtes hors ligne. Ce qui est déjà ouvert reste lisible, et Loonext " +
    "se remettra à jour tout seul dès votre retour.",
  sessionExpired: "Votre session a expiré. Reconnectez-vous pour continuer.",
  goToSignIn: "Aller à la connexion",
  newConversation: "Nouvelle conversation",

  you: "Vous",
  signOut: "Se déconnecter",
  signingOut: "Déconnexion…",
  signOutFailed:
    "Impossible de vous déconnecter. Vérifiez votre connexion et réessayez.",
  workspaces: "Espaces de travail",
  switchWorkspace: "Changer d'espace de travail",
  workspaceNamed: "Espace de travail : {name}",
  accountAndSettings: "Compte et paramètres",
  accountAndSettingsUnread:
    "Compte et paramètres, {count} notifications non lues",
  accountSheetDescription:
    "Espace de travail, numéros d'entreprise, notifications, thème et " +
    "déconnexion.",
  businessNumbers: "Numéros d'entreprise",
  notifications: "Notifications",
  unreadCount: "{count} non lues",

  theme: "Thème",
  themeSystem: "Système",
  themeLight: "Clair",
  themeDark: "Sombre",

  roleOwner: "Propriétaire",
  roleAdmin: "Administrateur",
  roleMember: "Membre",
  roleReadOnly: "Consultation seulement",
  roleBookkeeper: "Comptable",

  navForYou: "Pour vous",
  navForYouTitleCase: "Pour vous",
  navInbox: "Boîte de réception",
  navCalls: "Appels",
  navTasks: "Tâches",
  navContacts: "Contacts",
  navScheduled: "Programmés",
  navSettings: "Paramètres",
  navBilling: "Facturation",
  navCount: "{label}, {count}",
  primaryNav: "Navigation principale",

  search: "Rechercher",
  searchShortcut: "Rechercher · ⌘K",
  collapseSidebar: "Réduire la barre latérale",
  expandSidebar: "Agrandir la barre latérale",

  numberCopied: "Numéro copié.",
  copyBlocked:
    "Impossible de copier. Votre navigateur a bloqué l'accès au presse-papiers.",
  copyNumber: "Copier {number}",
  numberSetupFailed: "Configuration impossible — choisissez un numéro",
  regNumberProvisioning:
    "Configuration de votre numéro d'entreprise, généralement en moins d'une minute.",
  regNumberDelayed:
    "Nous configurons encore votre numéro. Cela prend un peu plus de temps que d'habitude.",
  regNumberActionNeededAreaCode:
    "Nous n'avons pas pu obtenir de numéro dans l'indicatif régional {areaCode}. Choisissez-en un autre pour terminer la configuration.",
  regNumberActionNeeded:
    "Nous n'avons pas pu terminer la configuration de votre numéro. Choisissez un numéro pour terminer.",
  regHostedReview:
    "Activation des textos sur votre numéro actuel. L'examen par le fournisseur prend habituellement quelques jours ouvrables. Les appels continuent de fonctionner pendant tout ce temps.",
  regPending:
    "Les textos vers les États-Unis s'activent en environ 3 à 7 jours ouvrables (approbation du fournisseur). Les appels, la réception de textos et les textos vers les numéros canadiens fonctionnent déjà.",
  regOtpPending:
    "Une dernière étape : entrez le code de vérification envoyé au {phone} pour terminer l'inscription américaine.",
  regRejected:
    "L'inscription américaine demande une correction : {reason}. Corrigez et renvoyez la demande. Cela prend 2 minutes.",
  regApproved: "Les textos vers les États-Unis sont en service.",
  regApprovedToast:
    "Tout est prêt. Les textos vers les États-Unis sont activés.",
  regSetupUnfinishedMember:
    "La configuration de votre espace de travail n'est pas terminée. Demandez au propriétaire du compte de la compléter.",
  regSubscriptionCanceled:
    "Votre abonnement est annulé. L'envoi de textos est désactivé. Réabonnez-vous pour le réactiver.",
  regPaymentIssue:
    "Le paiement n'a pas été accepté. L'envoi de textos est suspendu. Mettez votre carte à jour pour le rétablir.",
  regWaitLonger:
    "Votre numéro prend un peu plus de temps que d'habitude. Nous nous en occupons — vous n'avez pas à attendre ici.",
  regWaitStill:
    "Configuration de votre numéro en cours — cela prend un peu plus de temps que d'habitude. Patientez un instant.",
  regHonestTimelineReceiving:
    "La réception de textos fonctionne dès que votre numéro est prêt (quelques minutes).",
  regHonestTimelineCanada:
    "Les textos vers les numéros canadiens fonctionnent immédiatement.",
  regHonestTimelineUs:
    "Les textos vers les numéros américains s'activent après l'approbation du fournisseur, généralement de 3 à 7 jours ouvrables. Nous vous écrirons dès que vous serez approuvé.",
  regHonestTimelineUsOff:
    "Les textos vers les États-Unis sont désactivés pour votre compte. Vous pouvez les activer à tout moment dans les Paramètres.",
  regBannerUpdateBilling: "Mettre la facturation à jour",
  regBannerEnterCode: "Entrer le code",
  regBannerFixResubmit: "Corriger et renvoyer",
  regBannerChooseNumber: "Choisir un numéro",
  regBannerDetails: "Détails",
  regBannerYourMobile: "votre mobile",
  regBannerReasonUnknown: "le fournisseur a signalé un détail",
  numberSettingUp: "Configuration de votre numéro…",

  mfaRequiredTitle:
    "Cet espace de travail exige l'authentification à deux facteurs",
  mfaRequiredBody:
    "Le propriétaire l'a activée et la période de grâce est terminée. " +
    "Configurez-la une seule fois et vous reprenez le travail — cela prend " +
    "environ une minute et demande une application d'authentification sur " +
    "votre téléphone.",
  mfaSetUp: "Configurer l'authentification à deux facteurs",
  mfaDone: "C'est fait",

  updateReadyTitle: "Une nouvelle version de Loonext est prête",
  updateReadyBody: "Rechargez pour obtenir les derniers correctifs.",
  updateReload: "Recharger maintenant",
  updateDismiss: "Masquer l'avis de mise à jour",
  updateBlockTitle: "Loonext a besoin d'une mise à jour",
  updateBlockBody:
    "Cette version ne peut plus se connecter en toute sécurité. Rechargez " +
    "pour obtenir la version actuelle.",
  updateBlockAction: "Recharger Loonext",
  updateVersion: "Vous utilisez {version}",
  updateUnknownVersion: "une version inconnue",
  updateMinimum: " · {version} ou plus récente est requise",

  paletteTitle: "Palette de commandes",
  paletteDescription:
    "Accédez à une conversation, un contact, une tâche, un fichier, un " +
    "modèle ou une page, ou agissez sur la conversation ouverte",
  paletteSearchPlaceholder:
    "Rechercher conversations, contacts, tâches, fichiers…",
  noMatches: "Aucun résultat.",
  searching: "Recherche…",
  searchFailed:
    "Recherche impossible — vérifiez votre connexion et réessayez.",
  thisConversation: "cette conversation",
  conversationActionsContext:
    "{name} · les actions s'appliquent à cette conversation",
  actionsOnConversation: "Actions sur cette conversation",
  markDone: "Marquer comme terminée",
  conversationClosed: "Conversation fermée",
  updateFailed: "Mise à jour impossible.",
  unassign: "Retirer l'attribution",
  unassigned: "Attribution retirée",
  assignTo: "Attribuer à {name}",
  assignedTo: "Attribuée à {name}",
  teammate: "Coéquipier",
  teammateInline: "coéquipier",
  changeStatus: "Changer le statut",
  statusNew: "Nouvelle",
  statusOpen: "Ouverte",
  statusWaiting: "En attente",
  statusClosed: "Fermée",
  markedStatus: "Marquée {status}",
  groupConversations: "Conversations",
  groupAttachments: "Pièces jointes",
  groupVoicemails: "Messages vocaux",
  groupTemplates: "Modèles",
  groupActions: "Actions",
  groupGoTo: "Aller à",
  chipNote: "Note",
  chipTask: "Tâche",
  chipDone: "Terminée",

  loading: "Chargement…",
  voicemail: "Message vocal",

  phoneReady: "Prêt",
  phoneCantRing: "Ne sonne pas",
  phoneConnecting: "Connexion…",
  phoneReadyTitle: "Votre navigateur sonnera pour les appels entrants",
  phoneFailedTitle:
    "Ce navigateur ne sonnera pas pour les appels entrants. Il continue " +
    "d'essayer, et recharger la page relance la tentative tout de suite.",
  phoneConnectingTitle:
    "Connexion de votre téléphone — les appels entrants ne sonneront pas " +
    "tant que ce n'est pas prêt",

  transferTo: "Transférer à",
  noTransferTargets: "Personne d'autre n'a son téléphone ouvert en ce moment.",
  transferring: "Transfert à {name}…",
  transferFailed: "Le transfert a échoué. Réessayez.",
  onACall: "En appel",
  onACallEllipsis: "En appel…",
  incomingCallFrom: "Appel entrant de",
  answer: "Répondre",
  decline: "Refuser",
  answerFailed: "Impossible de répondre à l'appel.",
  callOnHold: "{name} · en attente",
  resumeCall: "Reprendre l'appel avec {name}",
  hangUpHeldCall: "Raccrocher l'appel en attente",
  callEnded: "{name} · terminé",
  dismiss: "Masquer",
  keypad: "Clavier",
  closeKeypad: "Fermer le clavier",
  calling: "Appel en cours…",
  openConversationForNotes: "Ouvrir la conversation pour prendre des notes",
  findingConversation: "Recherche de la conversation de cet appel…",
  noConversationForCallAria:
    "Cet appel n'a aucune conversation où prendre des notes",
  noConversationForCall: "Aucune conversation pour cet appel",
  transferThisCall: "Transférer cet appel",
  connectingCallToServer: "Connexion de cet appel au serveur…",
  putOnHold: "Mettre en attente",
  mute: "Couper le micro",
  unmute: "Réactiver le micro",
  hangUp: "Raccrocher",

  callingUnavailable:
    "Les appels ne sont pas disponibles en ce moment. Essayez de recharger " +
    "l'application.",
  callStartFailedRetry: "Impossible de lancer l'appel. Réessayez.",
  callStartFailed: "Impossible de lancer l'appel.",
  callContact: "Appeler {name} depuis votre numéro d'entreprise",
  dial: "Composer",
  dialANumber: "Composer un numéro",
  enterANumber: "Entrez un numéro",
  matchingContacts: "Contacts correspondants",
  callFrom: "Appeler depuis",
  fromNumber: "Depuis {number}",
  call: "Appeler",
  textAction: "Texter",
  sendMessageInstead: "Envoyer un texto à la place",
  deleteLastDigit: "Effacer le dernier chiffre",
  openContact: "Ouvrir le contact",
  addContact: "Ajouter un contact",

  filterAll: "Tous",
  filterMissed: "Manqués",
  filterVoicemail: "Messages vocaux",
  filterCalls: "Filtrer les appels",
  recentCalls: "Appels récents",
  callsLoadFailed: "Impossible de charger vos appels.",
  checkConnection: "Vérifiez votre connexion et réessayez.",
  emptyMissed: "Aucun appel manqué. Parfait.",
  emptyVoicemail: "Aucun message vocal.",
  emptyCalls: "Les appels à votre numéro d'entreprise apparaîtront ici.",
  emptyCallsDescription:
    "Les appels sonnent ici même dans l'application ; ceux qui restent sans " +
    "réponse vont à votre boîte vocale et se retrouvent dans ce journal. " +
    "Votre message d'accueil, le filtrage des appels et le texto de rappel " +
    "automatique se trouvent dans Paramètres › Appels.",
  setUpCalls: "Configurer les appels",
  loadMore: "Afficher plus",

  ringing: "Sonnerie…",
  goingToVoicemail: "Vers la boîte vocale",
  outgoingCall: "Appel sortant",
  withMember: "Avec {name}",
  aTeammate: "un coéquipier",
  onLine: "sur {number}",
  ongoing: "En cours",
  ongoingCalls: "Appels en cours",

  unknownCaller: "Appelant inconnu",
  notLinkedToConversation: "Non lié à une conversation",
  callFromAria: "Appel de {name}, {outcome}",
  loadingCall: "Chargement de l'appel",
  allCalls: "Tous les appels",
  directionLabel: "Sens",
  directionOutgoing: "Sortant",
  directionIncoming: "Entrant",
  numberLabel: "Numéro",
  placedBy: "Placé par",
  answeredBy: "Répondu par",
  startedLabel: "Début",
  endedLabel: "Fin",
  callerVerified: "Appelant vérifié",
  callerVerifiedYes: "Oui",
  callerVerifiedPartly: "Partiellement ({attestation})",
  openConversation: "Ouvrir la conversation",
  viewContact: "Voir le contact",

  outcomeInProgress: "En cours",
  outcomeAnswered: "Répondu",
  outcomeNoAnswer: "Sans réponse",
  outcomeLeftVoicemail: "A laissé un message vocal",
  outcomeMissed: "Manqué",
  transcriptRecordingLost:
    "Le client a commencé à laisser un message vocal, mais l'enregistrement " +
    "n'a pas été conservé.",
  transcriptNoVoicemail: "Aucun message vocal n'a été laissé sur cet appel.",
  transcriptNoWords:
    "Nous n'avons distingué aucun mot dans celui-ci. L'enregistrement se lit " +
    "toujours.",
  transcriptNotYet:
    "Ce message vocal n'a pas encore été transcrit. Le lire s'en chargera.",

  voicemailRecording: "Enregistrement du message vocal",
  voicemailLoadFailed: "Chargement impossible — réessayer",
  playVoicemail: "Écouter le message vocal",
  playVoicemailWithLength: "Écouter le message vocal ({duration})",
  spamLikely: "Probablement du pourriel",
  copyTranscript: "Copier la transcription",
  transcriptCopied: "Transcription copiée.",

  micNoBrowserSupport:
    "Ce navigateur ne peut pas accéder à un microphone. Essayez une version " +
    "récente de Chrome, Edge ou Safari.",
  micNotFound:
    "Aucun microphone trouvé. Branchez ou activez un micro, puis relancez " +
    "l'appel.",
  micBlocked:
    "L'accès au microphone est bloqué. Cliquez sur l'icône 🎤 ou 🔒 dans la " +
    "barre d'adresse de votre navigateur, choisissez « Autoriser », puis " +
    "relancez l'appel.",
  micFailed:
    "Impossible d'accéder à votre microphone. Vérifiez l'autorisation du " +
    "micro dans votre navigateur et réessayez.",
  incomingCall: "Appel entrant",
  registrationFailed:
    "Votre navigateur ne peut pas recevoir d'appels en ce moment.",
  callingTemporarilyUnavailable:
    "Les appels sont temporairement indisponibles.",
  tooManyCalls: "Vous avez déjà deux appels en cours. Raccrochez-en un d'abord.",
  callStartFailedPleaseRetry:
    "Impossible de lancer l'appel. Veuillez réessayer.",
  lineUnreachable: "Impossible de joindre la ligne. Veuillez réessayer.",
};
