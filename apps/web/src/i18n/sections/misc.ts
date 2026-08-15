/**
 * #228 — the words the smaller surfaces says, in both languages.
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

export const miscEn = {
  /* #228 — the AI disclosure table on /legal/subprocessors.
     Descriptive statements of fact about what leaves the product, which is why
     they are translated here while the contract pages still need a person. The
     40 and the "notes are never included" clause survive into the French on
     purpose; a test asserts both, in both languages. */
  aiInferenceLocation: "AI inference runs on Cloudflare's global network and is not restricted to any one country. Cloudflare's own data-localization compatibility list marks Workers AI as not compatible with Regional Services, the feature that confines processing to a region. So we cannot pin it to Canada or to the United States, and we will not imply otherwise.",
  aiInferenceRetention: "Cloudflare does not store what is sent for inference unless the application writes it to a storage service itself. What comes back, we store in your workspace like any other message data, and delete with it.",
  aiSuggestRepliesLabel: "Suggested replies",
  aiSuggestRepliesSends: "the recent messages in that conversation and your business description, to draft a reply for a person to edit and send",
  aiEnrichLabel: "Task details",
  aiEnrichSends: "the text of the message a task was made from, to fill in the task's details",
  aiVoicemailTranscriptLabel: "Voicemail transcripts",
  aiVoicemailTranscriptSends: "the voicemail recording, to write it down so it can be read instead of played",
  aiVoicemailIntakeLabel: "Voicemail intake",
  aiVoicemailIntakeSends: "the voicemail transcript, to pull out what the caller said the problem was and the address they gave",
  aiCallWrapupLabel: "Call wrap-ups",
  aiCallWrapupSends: "the crew member's own dictation after a call has ended, to write it down as a note. Never the call itself and never the customer's voice",
  aiThreadSummaryLabel: "Thread catch-ups",
  aiThreadSummarySends: "up to the 40 most recent messages in that conversation, to write a short catch-up for somebody on the crew who has not read it. Internal notes are never included",
  // The job-photo page a homeowner opens (#294), drawn in the crew's language.
  photoLinkUnavailableTitle: "This link isn't available",
  photoLinkUnavailableDetail:
    "It may have expired. Ask whoever sent it for a new one.",
  photosFrom: "Photos from {business}",
  photosNone: "There are no photos on this job yet.",
  photosIntro: "The work on your job, as it was photographed.",
  photosTruncated:
    "This job has more photos than fit on one page — these are the first " +
    "{count}. Ask {business} if you need the rest.",
  /* Words more than one of these surfaces says. */
  retry: "Retry",
  turnOn: "Turn on",

  /* The error boundaries and the 404 (app/error.tsx, app/global-error.tsx).
     These render OUTSIDE any LocaleProvider today — the provider is mounted
     inside CompanyProvider, which is exactly what has just failed — so they
     read English until a provider sits above them. The keys exist so that day
     is a mount and not a re-extraction. */
  homeAria: "Loonext home",
  errorHeading: "Something broke on our side.",
  errorBodyBefore:
    "It was nothing you did. Try the page again; if it keeps failing,",
  errorContactLink: "tell us what you were doing",
  errorBodyAfter: "and we will look into it.",
  globalErrorBody:
    "It was nothing you did. Try again; if it keeps failing, come back in a " +
    "few minutes.",
  errorReference: "Reference: {digest}",
  backToHome: "Back to the home page",
  notFoundTitle: "Page not found",
  notFoundHeading: "That page doesn't exist.",
  notFoundBody:
    "The link is old or mistyped. The shared inbox is real, though, and it " +
    "is one click away.",
  seePricing: "See pricing",

  /* Attachments — one row (components/attachments/attachment-item.tsx) */
  attachmentActionsAria: "Actions for {name}",
  attachmentOpenAria: "Open {name}",
  attachmentDownloadAria: "Download {name}",
  attachmentKindImage: "Image",
  attachmentKindFile: "File",
  reportFile: "Report this file",
  reportFileTitle: "Report this file?",
  reportFileBodyBefore: "Nobody on your team will be able to open",
  reportFileBodyAfter:
    "until an owner or admin releases it. Nothing is deleted.",
  reportFileAction: "Report file",
  reportingFile: "Reporting…",

  /* Attachments — the note upload area (attachments-section.tsx) */
  uploadStillRunning:
    "A file is still uploading. Drop these again when it finishes.",
  uploadFailed: "That file didn't upload. Try again.",
  fileAttached: "File attached.",
  filesAttached: "{count} files attached.",
  attachmentsLoadFailed: "Couldn't load attachments.",
  attachmentsAtCap: "Up to {count} files. Remove one to add another.",
  attaching: "Attaching…",
  attachFiles: "Attach files",
  attachHint: "Images, PDFs, and documents up to 25 MB, or drop files here.",
  noteFiles: "Files",
  dropToAttach: "Drop to attach",
  dropWhileUploading: "Uploading, wait to add more",

  /* Attachments — whose photos these are (#294, photo-group-header.tsx) */
  photosFromCustomer: "From the customer",
  photosFromCrew: "Added by the crew",

  /* Attachments — the task drawer's read view (task-attachments.tsx) */
  taskAttachmentsEmpty:
    "Files live on the messages and notes of this conversation. Attach one " +
    "in the discussion below.",
  fileDeleted: "File deleted.",
  fileDeleteFailed: "Couldn't delete that file. Try again.",
  deleteFileTitle: "Delete this file?",
  deleteFileNamedBody:
    "\"{name}\" is removed for everyone on the crew. This can't be undone.",
  deleteFileBody:
    "This file is removed for everyone on the crew. This can't be undone.",
  deleteFileAction: "Delete file",

  /* Attachments — drawing on a photo (photo-markup-dialog.tsx). The tool
     labels, the hint and the save word are shared constants: all three clients
     say them, so they live in packages/shared, not here. */
  markupTitle: "Point at something",

  /* Notifications — the bell, its feed and the push offer inside it */
  notifications: "Notifications",
  notificationsUnreadAria: "Notifications, {count} unread",
  markAllRead: "Mark all read",
  notifInboundMessage: "New message from {name}",
  notifAssigned: "{name} assigned to you",
  notifTaskAssigned: "Task assigned · {name}",
  notifMissedCall: "Missed call from {name}",
  notifMention: "You were mentioned · {name}",
  notifLoadFailed: "We couldn't load your notifications.",
  notifAllCaughtUp: "You're all caught up.",
  notifLoadingMore: "Loading…",
  notifShowOlder: "Show older",
  pushOfferInFeed: "Get these when Loonext isn’t open.",
  pushBlockedForSite:
    "Notifications are blocked for this site. Your browser’s site settings " +
    "can allow them again.",

  /* Notifications — the daily-ceiling notice (#343, pause-notice.tsx) */
  alertsPausedAll: "Notifications are paused",
  alertsPausedEmail: "Email alerts are paused",
  alertsPausedPush: "Push alerts are paused",
  alertsPausedStillPush: "You're still getting push.",
  alertsPausedBody:
    "{what} for today — this workspace hit its daily limit.{still} They resume",
  alertsPausedBodyEnd: ". Your messages are all still here.",

  /* Notifications — the permission card on /settings/notifications */
  pushOnThisDevice: "Push on this device",
  pushCheckingAria: "Checking push status",
  pushIosInstall:
    "On iPhone, push needs Loonext on your home screen: tap Share, choose " +
    "“Add to Home Screen”, then turn notifications on from there.",
  pushUnsupported:
    "This browser doesn't support push notifications. Email notifications " +
    "still work.",
  pushBlockedInBrowser: "Notifications are blocked for Loonext in this browser.",
  pushSubscribedBody:
    "This device gets a notification when a customer texts you.",
  pushOfferBody:
    "Get a notification on this device when a customer texts you, even with " +
    "Loonext closed.",
  pushTurningOn: "Turning on…",
  pushTurningOff: "Turning off…",
  pushTurnOff: "Turn off",

  /* Choosing a number (#86, components/numbers/number-picker.tsx) */
  areaCodeLabel: "Area code (optional)",
  areaCodeSearchUs: "Denver or 720, or leave blank to browse all",
  areaCodeSearchCa: "Toronto or 416",
  areaCodeNoMatchUs: "No US area codes match that.",
  areaCodeNoMatchCa: "No Canadian area codes match that.",
  areaCodeNamed: "Area code {code}",
  areaCodeChange: "Change area code",
  digitsPlaceholder: "Digits you'd like (optional)",
  digitsFilterAria: "Filter by digits",
  digitsWhereAria: "Where those digits appear",
  digitsAnywhere: "anywhere",
  digitsAtStart: "at start",
  digitsAtEnd: "at end",
  numbersLoadFailed: "Couldn't load numbers. Try Refresh in a moment.",
  numbersFinding: "Finding available numbers…",
  numbersGetInAreaCode: "Get a number in area code {code}",
  numbersMaskedInAreaCode:
    "Canadian numbers are assigned the moment you finish setup, so the exact " +
    "number isn't shown here — we'll give you a local {code} number (or a " +
    "nearby one).",
  numbersMaskedPickAreaCode:
    "Canadian numbers are assigned at setup, so pick an area code above and " +
    "we'll give you a local number in it.",
  numbersNoneMatchDigits:
    "None of the available numbers {match} {digits}. Try fewer digits, " +
    "Refresh for a new batch, or turn on nearby numbers.",
  numbersMatchStart: "start with",
  numbersMatchEnd: "end in",
  numbersMatchAnywhere: "contain",
  numbersNoneNearAreaCode:
    "No numbers available near area code {code} right now. Try a different " +
    "area code.",
  numbersNoneInAreaCode:
    "No numbers in area code {code} right now. Turn on nearby numbers, or " +
    "try a different area code.",
  numbersNoneAtAll:
    "No numbers available right now. Refresh for a new batch, or turn on " +
    "nearby numbers.",
  numbersShowNearby: "Show nearby numbers",
  numbersRefresh: "Refresh",

  /* Ownership (#515) — /ownership and the banner that points at it */
  ownershipTitle: "Ownership",
  ownershipSubtitle:
    "Who {workspace} belongs to, and anything in the middle of changing that.",
  ownershipThisWorkspace: "this workspace",
  ownershipActionFailed: "That didn't go through. Try again.",
  ownershipAccepted: "You now own this workspace.",
  ownershipStopped: "Stopped. Nothing changed hands.",
  ownershipClaimAsked: "Asked. The owner has 7 days to stop it.",
  ownershipAskTitle: "Ask to take over {workspace}?",
  ownershipAskBody:
    "The owner will be emailed straight away and can stop this with one " +
    "click for the next 7 days. Everyone on the team is told too. If nobody " +
    "stops it, you can complete the takeover after 7 days. Only do this if " +
    "the owner genuinely cannot act.",
  ownershipAskAction: "Ask to take over",
  ownershipInProgress: "A handover is in progress",
  ownershipOfferedOut: "Ownership of this workspace has been offered to a teammate.",
  ownershipClaimedByBackup: "The backup owner has asked to take over this workspace.",
  ownershipStopThis: "Stop this",
  ownershipSettled: "Nothing is changing hands",
  ownershipYouOwnIt:
    "You own this workspace. If you ever can't get in, a backup owner is the " +
    "one person who can ask to take over — name one before you need one.",
  ownershipUnchanged:
    "This workspace has the owner it has always had. If that ever needs to " +
    "change, whoever it involves will find it here.",
  ownershipManageSuccession: "Manage succession",
  ownershipNameBackup: "Name a backup owner",
  ownershipForYou: "This is for you",
  ownershipAcceptAction: "Accept ownership",
  ownershipCompleteAction: "Complete the takeover",
  ownershipReview: "Review",
  ownershipDetailAcceptOffer:
    "Accepting makes you responsible for billing, the spending cap and your " +
    "numbers; the current owner stays on the team as an admin. Everyone is " +
    "told either way. The offer expires {when}.",
  ownershipDetailCompleteClaim:
    "The waiting period is over and nobody stopped it. Completing this makes " +
    "you the owner — billing, the spending cap and your numbers — and puts " +
    "the previous owner on the team as an admin.",
  ownershipDetailClaimWaiting:
    "The owner has been emailed and can stop this until {when}. If nobody " +
    "stops it, you can complete the takeover after that.",
  ownershipDetailBackupStanding:
    "If the owner ever can't get in — they leave, they lose access to their " +
    "email, or worse — you're the one person who can ask to take over. They " +
    "get a week to say no, and everyone on the team is told. Nothing " +
    "changes until you ask.",
  ownershipDetailOfferPending:
    "Nothing changes until they accept. The offer expires {when}.",
  ownershipDetailClaimReady:
    "The waiting period is over. They can complete this at any time.",
  ownershipDetailClaimPending:
    "This completes {when} unless the owner stops it. Stopping it takes " +
    "effect immediately.",

  /* The shared controls (components/ui) */
  commandPaletteTitle: "Command Palette",
  commandPaletteDescription: "Search for a command to run...",
  copy: "Copy",
  copied: "Copied",
  copyAria: "Copy {value}",
  showPassword: "Show password",
  hidePassword: "Hide password",

  /* The workspace gate (lib/company/provider.tsx). Same note as the error
     boundaries: these three render ABOVE the LocaleProvider this file's own
     component mounts, so they read English until one sits higher. */
  workspaceLoadFailed:
    "We couldn't load your workspace. Check your connection and try again.",
  workspaceTakingYouToSetup: "Taking you to setup…",
  workspaceLoading: "Loading your workspace…",

  /* The realtime inbound-message toast (lib/realtime/provider.tsx) */
  realtimeNewMessage: "New message",
  realtimeAttachment: "Attachment",
  realtimeView: "View",

  /* ── The API client's own two sentences (lib/api/core.ts, error.ts) ───────
     Everything else a failed request says is the SERVER's sentence, rendered
     verbatim — SPEC §7 writes one per code, and a second copy here would be a
     translation that drifts from the one the phones show. These two are the
     cases where no server sentence exists: the client refused before sending,
     and the body came back unreadable. */
  apiSignedOut: "You're signed out. Log in again.",
  apiServerError: "Something went wrong on our end. Try again in a moment.",

  /* ── Un-blocking notifications, per browser (lib/push/support.ts) ─────────
     The user agent picks a SENTENCE and never a code path, so a wrong guess
     costs a reader one wrong menu name rather than a broken feature. The menu
     names are what the browser itself shows in French, which is why they are
     translated rather than left in English. Loonext is the app's name in every
     language. */
  pushRecoveryIos:
    "Open Settings → Notifications → Loonext on your phone, allow " +
    "notifications, then come back here.",
  pushRecoveryFirefox:
    "Click the permissions icon next to the address bar, remove the " +
    "notifications block, then reload this page.",
  pushRecoverySafari:
    "Open Safari → Settings → Websites → Notifications, allow this site, then " +
    "reload this page.",
  pushRecoveryChromium:
    "Click the icon next to the address bar, set Notifications to Allow, then " +
    "reload this page.",
  pushRecoveryGeneric:
    "Allow notifications for this site in your browser settings, then reload " +
    "this page.",
  /* …and when turning them on or off is what failed
     (lib/push/subscription-machine.ts, lib/push/use-push-subscription.ts). */
  pushTurnOnFailed: "We couldn't turn on notifications. Try again in a moment.",
  pushTurnOffFailed: "We couldn't turn off notifications. Try again in a moment.",
  pushNotConfigured: "Notifications aren't configured yet. Try again later.",

  /* The Map view with no tile provider configured (lib/maps/basemap.ts).
     Names the state and who fixes it, and does not apologise for a bug —
     this is a setting an owner can complete, not a fault. */
  mapNoBasemap:
    "Job pins are exact. The street background needs a map provider " +
    "configured, which an owner can do in one setting.",

  /* ── The shared formatters (lib/format/*) ─────────────────────────────────
     Every list row in the product renders through these, which is why they
     live in the section for words more than one surface says rather than in
     any one screen's. */
  /** A contact with neither a name nor a number we can render. */
  unknownContact: "Unknown",
  /** The freshest a relative timestamp gets. */
  timeNow: "now",
  /** A call row's outcome. Outbound speaks from the crew's side: a customer
      who did not pick up is "No answer", never "Missed" — nothing was missed
      by the crew. */
  callNoAnswer: "No answer",
  callMissed: "Missed",
  callVoicemail: "Voicemail",
  callYouCalled: "You called",
  callPlacedBy: "{name} called",
  callAnswered: "Answered",
  callAnsweredBy: "Answered by {name}",
  callCalling: "Calling…",
  callInProgress: "In progress",
} as const;

export const miscFr: Translated<typeof miscEn> = {
  aiInferenceLocation: "L'inférence de l'IA s'exécute sur le réseau mondial de Cloudflare et n'est restreinte à aucun pays. La liste de compatibilité de localisation des données de Cloudflare indique que Workers AI n'est pas compatible avec Regional Services, la fonction qui confine le traitement à une région. Nous ne pouvons donc pas la limiter au Canada ni aux États-Unis, et nous ne laisserons pas entendre le contraire.",
  aiInferenceRetention: "Cloudflare ne conserve pas ce qui est envoyé pour l'inférence, à moins que l'application ne l'écrive elle-même dans un service de stockage. Ce qui revient, nous le conservons dans votre espace de travail comme toute autre donnée de message, et nous le supprimons avec elle.",
  aiSuggestRepliesLabel: "Réponses suggérées",
  aiSuggestRepliesSends: "les messages récents de cette conversation et la description de votre entreprise, pour rédiger une réponse qu'une personne modifie et envoie",
  aiEnrichLabel: "Détails de la tâche",
  aiEnrichSends: "le texte du message à partir duquel la tâche a été créée, pour en remplir les détails",
  aiVoicemailTranscriptLabel: "Transcriptions des messages vocaux",
  aiVoicemailTranscriptSends: "l'enregistrement du message vocal, pour le mettre par écrit afin qu'il puisse être lu plutôt qu'écouté",
  aiVoicemailIntakeLabel: "Tri des messages vocaux",
  aiVoicemailIntakeSends: "la transcription du message vocal, pour en extraire le problème décrit par l'appelant et l'adresse qu'il a donnée",
  aiCallWrapupLabel: "Comptes rendus d'appel",
  aiCallWrapupSends: "la dictée du membre de l'équipe après la fin de l'appel, pour la mettre par écrit sous forme de note. Jamais l'appel lui-même et jamais la voix du client",
  aiThreadSummaryLabel: "Récapitulatifs de conversation",
  aiThreadSummarySends: "jusqu'aux 40 messages les plus récents de cette conversation, pour rédiger un court récapitulatif à l'intention d'un membre de l'équipe qui ne l'a pas lue. Les notes internes ne sont jamais incluses",
  photoLinkUnavailableTitle: "Ce lien n'est pas disponible",
  photoLinkUnavailableDetail:
    "Il a peut-être expiré. Demandez-en un nouveau à la personne qui vous l'a envoyé.",
  photosFrom: "Photos de {business}",
  photosNone: "Il n'y a pas encore de photos pour ces travaux.",
  photosIntro: "Les travaux effectués chez vous, tels qu'ils ont été photographiés.",
  photosTruncated:
    "Ces travaux comptent plus de photos qu'une seule page peut afficher — " +
    "voici les {count} premières. Demandez le reste à {business} si vous en " +
    "avez besoin.",
  retry: "Réessayer",
  turnOn: "Activer",

  homeAria: "Accueil Loonext",
  errorHeading: "Une erreur est survenue de notre côté.",
  errorBodyBefore:
    "Ce n'est pas de votre faute. Réessayez la page ; si le problème persiste,",
  errorContactLink: "dites-nous ce que vous faisiez",
  errorBodyAfter: "et nous allons examiner la situation.",
  globalErrorBody:
    "Ce n'est pas de votre faute. Réessayez ; si le problème persiste, " +
    "revenez dans quelques minutes.",
  errorReference: "Référence : {digest}",
  backToHome: "Retour à la page d'accueil",
  notFoundTitle: "Page introuvable",
  notFoundHeading: "Cette page n'existe pas.",
  /* No em-dash and no en-dash, in either language: not-found.test.tsx pins
     that for this page, and the French has to hold the same rule the English
     is held to. */
  notFoundBody:
    "Le lien est ancien ou mal saisi. La boîte de réception partagée, elle, " +
    "existe bel et bien, à un clic d'ici.",
  seePricing: "Voir les tarifs",

  attachmentActionsAria: "Actions pour {name}",
  attachmentOpenAria: "Ouvrir {name}",
  attachmentDownloadAria: "Télécharger {name}",
  attachmentKindImage: "Image",
  attachmentKindFile: "Fichier",
  reportFile: "Signaler ce fichier",
  reportFileTitle: "Signaler ce fichier ?",
  reportFileBodyBefore: "Personne dans votre équipe ne pourra ouvrir",
  reportFileBodyAfter:
    "tant qu'un propriétaire ou un administrateur ne l'aura pas débloqué. " +
    "Rien n'est supprimé.",
  reportFileAction: "Signaler le fichier",
  reportingFile: "Signalement…",

  uploadStillRunning:
    "Un fichier est encore en cours de téléversement. Déposez ceux-ci de " +
    "nouveau une fois terminé.",
  uploadFailed: "Ce fichier n'a pas été téléversé. Réessayez.",
  fileAttached: "Fichier joint.",
  filesAttached: "{count} fichiers joints.",
  attachmentsLoadFailed: "Impossible de charger les pièces jointes.",
  attachmentsAtCap:
    "Jusqu'à {count} fichiers. Retirez-en un pour en ajouter un autre.",
  attaching: "Ajout en cours…",
  attachFiles: "Joindre des fichiers",
  attachHint:
    "Images, PDF et documents jusqu'à 25 Mo, ou déposez des fichiers ici.",
  noteFiles: "Fichiers",
  dropToAttach: "Déposez pour joindre",
  dropWhileUploading: "Téléversement en cours, attendez avant d'en ajouter",

  photosFromCustomer: "Du client",
  photosFromCrew: "Ajouté par l'équipe",

  taskAttachmentsEmpty:
    "Les fichiers vivent sur les messages et les notes de cette conversation. " +
    "Joignez-en un dans la discussion ci-dessous.",
  fileDeleted: "Fichier supprimé.",
  fileDeleteFailed: "Impossible de supprimer ce fichier. Réessayez.",
  deleteFileTitle: "Supprimer ce fichier ?",
  deleteFileNamedBody:
    "« {name} » est retiré pour toute l'équipe. Cette action est irréversible.",
  deleteFileBody:
    "Ce fichier est retiré pour toute l'équipe. Cette action est irréversible.",
  deleteFileAction: "Supprimer le fichier",

  markupTitle: "Pointez quelque chose",

  notifications: "Notifications",
  notificationsUnreadAria: "Notifications, {count} non lues",
  markAllRead: "Tout marquer comme lu",
  notifInboundMessage: "Nouveau message de {name}",
  notifAssigned: "{name} vous a été assigné",
  notifTaskAssigned: "Tâche assignée · {name}",
  notifMissedCall: "Appel manqué de {name}",
  notifMention: "Vous avez été mentionné · {name}",
  notifLoadFailed: "Impossible de charger vos notifications.",
  notifAllCaughtUp: "Vous êtes à jour.",
  notifLoadingMore: "Chargement…",
  notifShowOlder: "Afficher les plus anciennes",
  pushOfferInFeed: "Recevez-les même quand Loonext n’est pas ouvert.",
  pushBlockedForSite:
    "Les notifications sont bloquées pour ce site. Les paramètres de site de " +
    "votre navigateur peuvent les autoriser de nouveau.",

  alertsPausedAll: "Les notifications sont en pause",
  alertsPausedEmail: "Les alertes par courriel sont en pause",
  alertsPausedPush: "Les alertes push sont en pause",
  alertsPausedStillPush: "Vous recevez encore les alertes push.",
  alertsPausedBody:
    "{what} pour aujourd'hui — cet espace de travail a atteint sa limite " +
    "quotidienne.{still} Elles reprennent",
  alertsPausedBodyEnd: ". Vos messages sont tous encore là.",

  pushOnThisDevice: "Alertes push sur cet appareil",
  pushCheckingAria: "Vérification de l'état des alertes push",
  pushIosInstall:
    "Sur iPhone, les alertes push demandent Loonext sur votre écran " +
    "d'accueil : touchez Partager, choisissez « Ajouter à l'écran d'accueil », " +
    "puis activez les notifications à partir de là.",
  pushUnsupported:
    "Ce navigateur ne prend pas en charge les alertes push. Les " +
    "notifications par courriel fonctionnent toujours.",
  pushBlockedInBrowser:
    "Les notifications sont bloquées pour Loonext dans ce navigateur.",
  pushSubscribedBody:
    "Cet appareil reçoit une notification quand un client vous texte.",
  pushOfferBody:
    "Recevez une notification sur cet appareil quand un client vous texte, " +
    "même avec Loonext fermé.",
  pushTurningOn: "Activation…",
  pushTurningOff: "Désactivation…",
  pushTurnOff: "Désactiver",

  areaCodeLabel: "Indicatif régional (facultatif)",
  areaCodeSearchUs: "Denver ou 720, ou laissez vide pour tout parcourir",
  areaCodeSearchCa: "Toronto ou 416",
  areaCodeNoMatchUs: "Aucun indicatif régional américain ne correspond.",
  areaCodeNoMatchCa: "Aucun indicatif régional canadien ne correspond.",
  areaCodeNamed: "Indicatif régional {code}",
  areaCodeChange: "Changer l'indicatif régional",
  digitsPlaceholder: "Chiffres souhaités (facultatif)",
  digitsFilterAria: "Filtrer par chiffres",
  digitsWhereAria: "Où ces chiffres apparaissent",
  digitsAnywhere: "n'importe où",
  digitsAtStart: "au début",
  digitsAtEnd: "à la fin",
  numbersLoadFailed:
    "Impossible de charger les numéros. Essayez Actualiser dans un moment.",
  numbersFinding: "Recherche de numéros disponibles…",
  numbersGetInAreaCode: "Obtenir un numéro dans l'indicatif régional {code}",
  numbersMaskedInAreaCode:
    "Les numéros canadiens sont attribués dès que vous terminez la " +
    "configuration, alors le numéro exact n'est pas affiché ici — nous vous " +
    "donnerons un numéro local en {code} (ou tout près).",
  numbersMaskedPickAreaCode:
    "Les numéros canadiens sont attribués à la configuration, alors " +
    "choisissez un indicatif régional ci-dessus et nous vous donnerons un " +
    "numéro local dans celui-ci.",
  numbersNoneMatchDigits:
    "Aucun des numéros disponibles ne {match} {digits}. Essayez moins de " +
    "chiffres, faites Actualiser pour un nouveau lot, ou activez les numéros " +
    "à proximité.",
  numbersMatchStart: "commence par",
  numbersMatchEnd: "se termine par",
  numbersMatchAnywhere: "contient",
  numbersNoneNearAreaCode:
    "Aucun numéro disponible près de l'indicatif régional {code} en ce " +
    "moment. Essayez un autre indicatif régional.",
  numbersNoneInAreaCode:
    "Aucun numéro dans l'indicatif régional {code} en ce moment. Activez les " +
    "numéros à proximité, ou essayez un autre indicatif régional.",
  numbersNoneAtAll:
    "Aucun numéro disponible en ce moment. Faites Actualiser pour un nouveau " +
    "lot, ou activez les numéros à proximité.",
  numbersShowNearby: "Afficher les numéros à proximité",
  numbersRefresh: "Actualiser",

  ownershipTitle: "Propriété",
  ownershipSubtitle:
    "À qui appartient {workspace}, et tout ce qui est en train de changer " +
    "cela.",
  ownershipThisWorkspace: "cet espace de travail",
  ownershipActionFailed: "L'opération n'a pas abouti. Réessayez.",
  ownershipAccepted: "Vous êtes maintenant propriétaire de cet espace de travail.",
  ownershipStopped: "Arrêté. Rien n'a changé de mains.",
  ownershipClaimAsked:
    "Demande envoyée. Le propriétaire a 7 jours pour l'arrêter.",
  ownershipAskTitle: "Demander à reprendre {workspace} ?",
  ownershipAskBody:
    "Le propriétaire recevra un courriel immédiatement et peut arrêter cette " +
    "demande d'un seul clic pendant les 7 prochains jours. Toute l'équipe en " +
    "est informée également. Si personne ne l'arrête, vous pourrez terminer " +
    "la reprise après 7 jours. Ne faites cela que si le propriétaire est " +
    "vraiment dans l'impossibilité d'agir.",
  ownershipAskAction: "Demander à reprendre",
  ownershipInProgress: "Un transfert est en cours",
  ownershipOfferedOut:
    "La propriété de cet espace de travail a été offerte à un coéquipier.",
  ownershipClaimedByBackup:
    "Le propriétaire suppléant a demandé à reprendre cet espace de travail.",
  ownershipStopThis: "Arrêter cela",
  ownershipSettled: "Rien ne change de mains",
  ownershipYouOwnIt:
    "Vous êtes propriétaire de cet espace de travail. Si vous ne pouvez plus " +
    "y accéder un jour, un propriétaire suppléant est la seule personne qui " +
    "peut demander à reprendre — nommez-en un avant d'en avoir besoin.",
  ownershipUnchanged:
    "Cet espace de travail a le propriétaire qu'il a toujours eu. Si cela " +
    "doit changer un jour, les personnes concernées le trouveront ici.",
  ownershipManageSuccession: "Gérer la succession",
  ownershipNameBackup: "Nommer un propriétaire suppléant",
  ownershipForYou: "Ceci est pour vous",
  ownershipAcceptAction: "Accepter la propriété",
  ownershipCompleteAction: "Terminer la reprise",
  ownershipReview: "Consulter",
  ownershipDetailAcceptOffer:
    "En acceptant, vous devenez responsable de la facturation, du plafond de " +
    "dépenses et de vos numéros ; le propriétaire actuel reste dans l'équipe " +
    "comme administrateur. Tout le monde est informé dans les deux cas. " +
    "L'offre expire {when}.",
  ownershipDetailCompleteClaim:
    "Le délai d'attente est écoulé et personne ne l'a arrêté. Terminer cette " +
    "reprise fait de vous le propriétaire — la facturation, le plafond de " +
    "dépenses et vos numéros — et place l'ancien propriétaire dans l'équipe " +
    "comme administrateur.",
  ownershipDetailClaimWaiting:
    "Le propriétaire a reçu un courriel et peut arrêter cette demande " +
    "jusqu'au {when}. Si personne ne l'arrête, vous pourrez terminer la " +
    "reprise après ce moment.",
  ownershipDetailBackupStanding:
    "Si le propriétaire ne peut plus accéder au compte un jour — il quitte, " +
    "il perd l'accès à son courriel, ou pire — vous êtes la seule personne " +
    "qui peut demander à reprendre. Il a une semaine pour refuser, et toute " +
    "l'équipe en est informée. Rien ne change tant que vous ne demandez pas.",
  ownershipDetailOfferPending:
    "Rien ne change tant qu'il n'a pas accepté. L'offre expire {when}.",
  ownershipDetailClaimReady:
    "Le délai d'attente est écoulé. La reprise peut être terminée à tout " +
    "moment.",
  ownershipDetailClaimPending:
    "Cela se termine {when} à moins que le propriétaire ne l'arrête. " +
    "L'arrêter prend effet immédiatement.",

  commandPaletteTitle: "Palette de commandes",
  commandPaletteDescription: "Cherchez une commande à exécuter…",
  copy: "Copier",
  copied: "Copié",
  copyAria: "Copier {value}",
  showPassword: "Afficher le mot de passe",
  hidePassword: "Masquer le mot de passe",

  workspaceLoadFailed:
    "Impossible de charger votre espace de travail. Vérifiez votre connexion " +
    "et réessayez.",
  workspaceTakingYouToSetup: "Ouverture de la configuration…",
  workspaceLoading: "Chargement de votre espace de travail…",

  realtimeNewMessage: "Nouveau message",
  realtimeAttachment: "Pièce jointe",
  realtimeView: "Voir",

  // --- Les deux phrases du client API ---------------------------------------
  apiSignedOut: "Vous êtes déconnecté. Connectez-vous de nouveau.",
  apiServerError:
    "Une erreur s'est produite de notre côté. Réessayez dans un moment.",

  // --- Débloquer les notifications, selon le navigateur ----------------------
  pushRecoveryIos:
    "Ouvrez Réglages → Notifications → Loonext sur votre téléphone, autorisez " +
    "les notifications, puis revenez ici.",
  pushRecoveryFirefox:
    "Cliquez sur l'icône des permissions à côté de la barre d'adresse, " +
    "retirez le blocage des notifications, puis rechargez cette page.",
  pushRecoverySafari:
    "Ouvrez Safari → Réglages → Sites web → Notifications, autorisez ce site, " +
    "puis rechargez cette page.",
  pushRecoveryChromium:
    "Cliquez sur l'icône à côté de la barre d'adresse, réglez Notifications " +
    "sur Autoriser, puis rechargez cette page.",
  pushRecoveryGeneric:
    "Autorisez les notifications pour ce site dans les paramètres de votre " +
    "navigateur, puis rechargez cette page.",
  pushTurnOnFailed:
    "Impossible d'activer les notifications. Réessayez dans un moment.",
  pushTurnOffFailed:
    "Impossible de désactiver les notifications. Réessayez dans un moment.",
  pushNotConfigured:
    "Les notifications ne sont pas encore configurées. Réessayez plus tard.",

  mapNoBasemap:
    "Les épingles des travaux sont exactes. Le fond de carte exige un " +
    "fournisseur de tuiles, qu'un propriétaire peut configurer en un réglage.",

  // --- Les formateurs partagés ----------------------------------------------
  unknownContact: "Inconnu",
  timeNow: "maintenant",
  callNoAnswer: "Sans réponse",
  callMissed: "Manqué",
  callVoicemail: "Message vocal",
  callYouCalled: "Vous avez appelé",
  callPlacedBy: "{name} a appelé",
  callAnswered: "Pris",
  callAnsweredBy: "Pris par {name}",
  callCalling: "Appel en cours…",
  callInProgress: "En cours",
};
