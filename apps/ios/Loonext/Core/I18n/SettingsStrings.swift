import Foundation

/// #228 — the settings screens, A–M.
///
/// The twin of `SettingsStrings.kt`, key for key: Lou and the task enrichments,
/// closed dates, the workspace's own contact fields, leaving a workspace, help,
/// deleting an account, the emergency words, signed-in devices, business hours
/// and the away reply, calling, a held number, and billing.
///
/// The register is `CommonStrings`': Quebec French, VOUVOIEMENT, accents spelled
/// normally, a normal space before the high punctuation. Product names (Loonext,
/// Stripe, Telnyx, Lou) and the carrier keywords (STOP / HELP / START / URGENT)
/// are never translated — a carrier matches on the keyword literally, and a name
/// somebody has to quote in a support email must be the name we shipped.
///
/// ## Why the maps are assembled from per-surface pieces
///
/// One dictionary literal of three hundred pairs is a type-checking bill Swift
/// sends at build time and a merge conflict for every agent working on a
/// settings screen. Each surface is its own `private let` with an explicit type,
/// and the two public maps are their sum — so a section reads like the screen it
/// describes and the compiler never has to infer anything.
///
/// ## Where iOS deliberately says something Android does not
///
/// Three keys hold a different English from their Android twin, each for a
/// reason written down in the file it came from rather than as a preference:
///
///   `settings.devicesAppLockHelp`   names Face ID and Touch ID. Android names
///                                   a fingerprint and a screen lock. Neither
///                                   phone has the other's hardware.
///   `settings.holdEndedOn`          may not say "resubscribing now sets you up
///                                   with a new number" — see the docblock on
///                                   `holdSentence` in BillingSection.swift. The
///                                   release is a once-daily cron, so for up to
///                                   a day after the deadline the number is
///                                   still ours, and that sentence is a promise
///                                   in the wrong direction. Android's copy
///                                   still carries it.
///   `settings.cancelExportIntro`    names AirDrop and Files, because the iOS
///                                   card hands the CSV to the system share
///                                   sheet rather than to a downloads folder.
///
/// ## What is deliberately NOT here
///
/// Copy that lives outside a view and cannot reach a locale stays where it is:
/// everything in `SettingsLogic.swift` (`pausedStateLines`, `cancellationOffer`,
/// `planFacts`, `pauseOfferBody`, `deviceCountLabel`, `emergencyWordList`, …),
/// the shared mirrors in `HelpSection.swift` (`supportTopics`,
/// `supportFixPromise`, `supportResponseTime`), `emergencySafetyLine`,
/// `defaultMctbMessage` and `ContactFields.Copy`. Each has a parity test pinning
/// its English against another client, and threading a locale through to reach
/// one of them is a bigger change than the extraction it would serve. They are
/// named in the extraction report instead of being half-moved.
enum SettingsStrings {
    static let section = AppStrings.Section(
        name: "SettingsStrings",
        en: settingsStringsEnglish,
        frCA: settingsStringsFrench
    )
}

/// Fold the per-surface maps into one.
///
/// A loop rather than a chain of `merging(_:uniquingKeysWith:)`, for the reason
/// `AppStrings` gives about its own fold: this file cannot be compiled on the
/// machine it was written on, so nothing is left to inference that can be
/// spelled out. Uniquely named because a `private` top-level function is
/// file-scoped and a second one elsewhere with the same name is fine, but a
/// distinctive name costs nothing and reads better in a crash log.
private func settingsStringsFolded(_ parts: [[String: String]]) -> [String: String] {
    var out: [String: String] = [:]
    for part in parts {
        for (key, value) in part { out[key] = value }
    }
    return out
}

private let settingsStringsEnglish: [String: String] = settingsStringsFolded([
    settingsAiEn,
    settingsClosedDatesEn,
    settingsContactFieldsEn,
    settingsLeaveEn,
    settingsHelpEn,
    settingsDeleteAccountEn,
    settingsEmergencyEn,
    settingsDevicesEn,
    settingsHoursEn,
    settingsCallingEn,
    settingsHeldEn,
    settingsBillingEn,
])

private let settingsStringsFrench: [String: String] = settingsStringsFolded([
    settingsAiFr,
    settingsClosedDatesFr,
    settingsContactFieldsFr,
    settingsLeaveFr,
    settingsHelpFr,
    settingsDeleteAccountFr,
    settingsEmergencyFr,
    settingsDevicesFr,
    settingsHoursFr,
    settingsCallingFr,
    settingsHeldFr,
    settingsBillingFr,
])

// ---------------------------------------------------------------------------
// Settings → AI (#214, #247, #367, #507)
// ---------------------------------------------------------------------------

/// The thresholds ride in as `{messages}` and `{days}` rather than being spelled
/// out: a number in settings copy that disagrees with the rule is how somebody
/// learns not to trust the settings screen. The French has to interpolate the
/// same two or the sentence promises a rule with no number in it, which
/// `AppStringsTests` checks in both languages.
private let settingsAiEn: [String: String] = [
    "settings.aiIntro":
        "Let the app pre-fill task details from a message. Every suggestion is "
        + "yours to review and edit before you save — nothing is sent or applied "
        + "on its own.",
    "settings.aiTaskCard": "When you make a task from a message",
    "settings.aiSuggestAddress": "Suggest an address",
    "settings.aiSuggestAddressHelp":
        "Read a job location out of the message (or fall back to the contact's "
        + "address) and pre-fill the task's address. It shows where each part came "
        + "from; you can edit or clear it before saving.",
    "settings.aiSuggestDue": "Suggest a due date & time",
    "settings.aiSuggestDueHelp":
        "Turn phrases like \"tomorrow at 2pm\" or \"next Tuesday\" into a due date "
        + "in your workspace's timezone. Always editable before you save.",
    "settings.aiBusinessCard": "What Lou knows about your business",
    "settings.aiBusinessHelp":
        "One sentence, in your words. Without it Lou will not say what your "
        + "business does, because anything it said would be guesswork. With it, "
        + "drafts can answer \"do you do X?\" honestly.",
    "settings.aiBusinessPlaceholder":
        "We paint houses and do small renovations in Calgary.",
    "settings.aiBusinessCount": "{count} / {max}",
    "settings.aiThreadCard": "When you open a long thread",
    "settings.aiCatchUp": "Let Lou catch you up",
    "settings.aiCatchUpHelp":
        "On a thread of {messages} messages or more — or a shorter one nobody has "
        + "touched in {days} days — offer a short catch-up: what they asked, what "
        + "you said, what is still open. Lou reads the conversation to write it, "
        + "and every line quotes a real message you can tap straight to. It is only "
        + "ever offered, never automatic, and it changes nothing about which "
        + "threads you see or the order they come in.",
    "settings.aiReplyCard": "When you reply to a customer",
    "settings.aiDraftReplies": "Let Lou draft replies",
    "settings.aiDraftRepliesHelp":
        "Offer a few short replies you can edit before sending, drawn from the "
        + "conversation so far. Start typing and they finish what you started instead.",
    "settings.aiWrapUpCard": "After you hang up",
    "settings.aiWrapUp": "Let Lou write down your wrap-up",
    "settings.aiWrapUpHelp":
        "Hold the microphone in the note box and say what was agreed — the quote, "
        + "the promise, the next step. Lou writes your words down for you to check "
        + "and post as an internal note. It hears only you, on your own phone, "
        + "after the call has ended: never the call and never the customer. The "
        + "recording is deleted as soon as the words come back, and nothing is "
        + "posted until you post it.",
    "settings.aiVoicemailCard": "When someone leaves a voicemail",
    "settings.aiTranscribe": "Let Lou write voicemails down",
    "settings.aiTranscribeHelp":
        "Show what a voicemail says next to the recording, so you can read it "
        + "when playing it isn't an option. The recording is always kept either way.",
    "settings.aiVoicemailIntake": "Pull the job out of a voicemail",
    "settings.aiVoicemailIntakeHelp":
        "Lou reads the transcript and shows what the caller wanted and where, "
        + "above the recording. Your greeting is untouched — if you want callers to "
        + "say the address, ask them for it in your own greeting. Nothing books "
        + "anything and nobody is put through a menu.",
    "settings.aiReadOnly": "Only owners and admins can change these.",
]

private let settingsAiFr: [String: String] = [
    "settings.aiIntro":
        "Laissez l'application pré-remplir les détails d'une tâche à partir d'un "
        + "texto. Chaque suggestion vous revient : vous la vérifiez et la modifiez "
        + "avant d'enregistrer — rien n'est envoyé ni appliqué tout seul.",
    "settings.aiTaskCard": "Quand vous créez une tâche à partir d'un texto",
    "settings.aiSuggestAddress": "Suggérer une adresse",
    "settings.aiSuggestAddressHelp":
        "Repère le lieu des travaux dans le texto (ou reprend l'adresse du client) "
        + "et pré-remplit l'adresse de la tâche. L'application indique d'où vient "
        + "chaque élément ; vous pouvez le modifier ou l'effacer avant d'enregistrer.",
    "settings.aiSuggestDue": "Suggérer une date et une heure d'échéance",
    "settings.aiSuggestDueHelp":
        "Transforme des formules comme « demain à 14 h » ou « mardi prochain » en "
        + "date d'échéance, dans le fuseau horaire de votre espace de travail. "
        + "Toujours modifiable avant d'enregistrer.",
    "settings.aiBusinessCard": "Ce que Lou sait de votre entreprise",
    "settings.aiBusinessHelp":
        "Une phrase, dans vos mots. Sans elle, Lou ne dira pas ce que votre "
        + "entreprise fait, parce que tout ce qu'il en dirait serait une "
        + "supposition. Avec elle, les brouillons peuvent répondre honnêtement à "
        + "« faites-vous ceci ? ».",
    "settings.aiBusinessPlaceholder":
        "Nous peignons des maisons et faisons de petites rénovations à Calgary.",
    "settings.aiBusinessCount": "{count} / {max}",
    "settings.aiThreadCard": "Quand vous ouvrez une longue conversation",
    "settings.aiCatchUp": "Laisser Lou vous résumer la conversation",
    "settings.aiCatchUpHelp":
        "Dans une conversation de {messages} textos ou plus — ou une plus courte à "
        + "laquelle personne n'a touché depuis {days} jours — propose un court "
        + "résumé : ce que le client a demandé, ce que vous avez répondu, ce qui "
        + "reste en suspens. Lou lit la conversation pour l'écrire, et chaque ligne "
        + "cite un vrai texto que vous pouvez ouvrir d'une touche. Ce n'est jamais "
        + "qu'une proposition, jamais automatique, et cela ne change rien aux "
        + "conversations que vous voyez ni à leur ordre.",
    "settings.aiReplyCard": "Quand vous répondez à un client",
    "settings.aiDraftReplies": "Laisser Lou rédiger des réponses",
    "settings.aiDraftRepliesHelp":
        "Propose quelques réponses courtes que vous pouvez modifier avant "
        + "l'envoi, tirées de la conversation jusqu'ici. Commencez à écrire et "
        + "elles termineront plutôt ce que vous avez commencé.",
    "settings.aiWrapUpCard": "Après avoir raccroché",
    "settings.aiWrapUp": "Laisser Lou écrire votre compte rendu",
    "settings.aiWrapUpHelp":
        "Maintenez le microphone dans la boîte de note et dites ce qui a été "
        + "convenu : le devis, la promesse, la prochaine étape. Lou met vos mots par "
        + "écrit pour que vous les vérifiiez et les publiiez en note interne. Il "
        + "n'entend que vous, sur votre propre téléphone, une fois l'appel terminé : "
        + "jamais l'appel et jamais le client. L'enregistrement est supprimé dès que "
        + "les mots reviennent, et rien n'est publié tant que vous ne le publiez pas.",
    "settings.aiVoicemailCard": "Quand quelqu'un laisse un message vocal",
    "settings.aiTranscribe": "Laisser Lou mettre les messages vocaux par écrit",
    "settings.aiTranscribeHelp":
        "Affiche le contenu d'un message vocal à côté de l'enregistrement, pour "
        + "que vous puissiez le lire quand l'écouter n'est pas possible. "
        + "L'enregistrement est conservé dans tous les cas.",
    "settings.aiVoicemailIntake": "Dégager le travail demandé d'un message vocal",
    "settings.aiVoicemailIntakeHelp":
        "Lou lit la transcription et affiche ce que l'appelant voulait et où, "
        + "au-dessus de l'enregistrement. Votre message d'accueil reste intact — si "
        + "vous voulez que les appelants donnent l'adresse, demandez-la dans votre "
        + "propre message d'accueil. Rien n'est réservé et personne n'est renvoyé à "
        + "un menu.",
    "settings.aiReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier ces réglages.",
]

// ---------------------------------------------------------------------------
// Settings → Hours → closed dates (#402)
// ---------------------------------------------------------------------------

private let settingsClosedDatesEn: [String: String] = [
    "settings.closedDatesTitle": "Closed dates",
    "settings.widgetTitle": "Text us button for your website",
    "settings.widgetBlurb": "A button on your own site that turns a visitor into a conversation here. They type their number, we text them a code, and their message lands in your inbox like any other text.",
    "settings.widgetShow": "Get the snippet",
    "settings.widgetLoading": "Loading…",
    "settings.widgetStepCopy": "Copy the line below.",
    "settings.widgetStepPaste": "Paste it into your website, just before </body>.",
    "settings.widgetStepSave": "Save and reload your site — the button appears bottom right.",
    "settings.widgetCopy": "Copy",
    "settings.widgetCopied": "Copied.",
    "settings.widgetLoadFailed": "Couldn't load your snippet. Try again.",
    "settings.widgetRotate": "Replace the key",
    "settings.widgetRotateWarning": "The button stops working on every site using the old snippet, immediately. You'll need to paste the new one everywhere you installed it.",
    "settings.widgetRotateConfirm": "Replace it",
    "settings.widgetRotated": "Replaced. Paste the new snippet on your site.",
    "settings.widgetLineLabel": "Which number website messages land on",
    "settings.widgetLineHelp": "Replies from your crew come from this number, so pick the line you watch.",
    "settings.widgetLineDefault": "Your first number",
    "settings.widgetLineSaved": "Website messages will land on that number.",
    "settings.closedDatesIntro":
        "Holidays, a week off, a day for a funeral. On these dates your away reply "
        + "goes out even if the weekly schedule says you're open — so a customer "
        + "texting on Christmas morning hears something back instead of nothing.",
    "settings.closedDatesEmpty":
        "No closed dates yet. Your weekly hours apply every week.",
    "settings.closedDatesRemove": "Remove",
    "settings.closedDatesRemoved": "Closed date removed.",
    "settings.closedDatesAdded": "Closed date added.",
    "settings.closedDatesFirstDay": "First day",
    "settings.closedDatesLastDay": "Last day",
    "settings.closedDatesNotePlaceholder": "Closed for the holiday, back Monday",
    "settings.closedDatesAdd": "Add closed date",
    "settings.closedDatesNeedDate": "Pick the date you're closed.",
    "settings.closedDatesBackwards": "The last day can't be before the first day.",
    "settings.closedDatesReadOnly": "Only owners and admins can change closed dates.",
]

private let settingsClosedDatesFr: [String: String] = [
    "settings.closedDatesTitle": "Jours de fermeture",
    "settings.widgetTitle": "Bouton « Écrivez-nous » pour votre site Web",
    "settings.widgetBlurb": "Un bouton sur votre propre site qui transforme un visiteur en conversation ici. Il entre son numéro, nous lui envoyons un code, et son message arrive dans votre boîte comme n'importe quel texto.",
    "settings.widgetShow": "Obtenir le code à coller",
    "settings.widgetLoading": "Chargement…",
    "settings.widgetStepCopy": "Copiez la ligne ci-dessous.",
    "settings.widgetStepPaste": "Collez-la dans votre site, juste avant </body>.",
    "settings.widgetStepSave": "Enregistrez et rechargez votre site — le bouton apparaît en bas à droite.",
    "settings.widgetCopy": "Copier",
    "settings.widgetCopied": "Copié.",
    "settings.widgetLoadFailed": "Impossible de charger votre code. Réessayez.",
    "settings.widgetRotate": "Remplacer la clé",
    "settings.widgetRotateWarning": "Le bouton cessera de fonctionner sur tous les sites utilisant l'ancien code, immédiatement. Vous devrez coller le nouveau partout où vous l'avez installé.",
    "settings.widgetRotateConfirm": "Remplacer",
    "settings.widgetRotated": "Remplacée. Collez le nouveau code sur votre site.",
    "settings.widgetLineLabel": "Le numéro qui reçoit les messages du site web",
    "settings.widgetLineHelp": "Les réponses de votre équipe partent de ce numéro : choisissez la ligne que vous surveillez.",
    "settings.widgetLineDefault": "Votre premier numéro",
    "settings.widgetLineSaved": "Les messages du site web arriveront sur ce numéro.",
    "settings.closedDatesIntro":
        "Les jours fériés, une semaine de congé, une journée pour des funérailles. "
        + "Ces jours-là, votre réponse d'absence part même si l'horaire hebdomadaire "
        + "vous dit ouvert — ainsi, le client qui écrit le matin de Noël reçoit "
        + "quelque chose plutôt que rien.",
    "settings.closedDatesEmpty":
        "Aucun jour de fermeture. Vos heures hebdomadaires s'appliquent chaque semaine.",
    "settings.closedDatesRemove": "Retirer",
    "settings.closedDatesRemoved": "Jour de fermeture retiré.",
    "settings.closedDatesAdded": "Jour de fermeture ajouté.",
    "settings.closedDatesFirstDay": "Premier jour",
    "settings.closedDatesLastDay": "Dernier jour",
    "settings.closedDatesNotePlaceholder": "Fermé pour le congé, de retour lundi",
    "settings.closedDatesAdd": "Ajouter un jour de fermeture",
    "settings.closedDatesNeedDate": "Choisissez la date de fermeture.",
    "settings.closedDatesBackwards":
        "Le dernier jour ne peut pas précéder le premier jour.",
    "settings.closedDatesReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier les jours "
        + "de fermeture.",
]

// ---------------------------------------------------------------------------
// Settings → Workspace → the fields a workspace defines for itself (#291)
// ---------------------------------------------------------------------------

/// The card's HEADING, INTRO, CAP_REACHED, PRIVACY and DELETE_WARNING are not
/// here: they live in `ContactFields.Copy`, which `ContactFieldsCopyTests` pins
/// word-for-word against the web and Android cards. Copying them into this
/// catalogue would fork the thing that test exists to keep single.
private let settingsContactFieldsEn: [String: String] = [
    "settings.contactFieldsLoading": "Loading…",
    "settings.contactFieldsEmpty":
        "You have not added any yet. Your contacts show the standard fields — "
        + "name, phone, email, address and notes.",
    "settings.contactFieldsNameLabel": "Field name",
    "settings.contactFieldsNamePlaceholder": "Boiler model",
    "settings.contactFieldsTypeLabel": "Type",
    "settings.contactFieldsRemove": "Remove",
    "settings.contactFieldsChoices": "The choices, one per line",
    "settings.contactFieldsChoicesPlaceholder": "Combi\nSystem\nHeat only",
    "settings.contactFieldsExportsAs": "Exports as {key}",
    "settings.contactFieldsExportsAsFrozen":
        "Exports as {key} · the name can change, the type cannot",
    "settings.contactFieldsAdd": "Add a field",
    "settings.contactFieldsSave": "Save fields",
    "settings.contactFieldsDiscard": "Discard",
    "settings.contactFieldsNeedName": "Give every field a name first.",
    "settings.contactFieldsSavedEmpty":
        "Saved. Your contacts are back to the standard fields.",
    "settings.contactFieldsSaved": "Saved. These show on every customer.",
]

private let settingsContactFieldsFr: [String: String] = [
    "settings.contactFieldsLoading": "Chargement…",
    "settings.contactFieldsEmpty":
        "Vous n'en avez pas encore ajouté. Vos clients affichent les champs "
        + "standards : nom, téléphone, courriel, adresse et notes.",
    "settings.contactFieldsNameLabel": "Nom du champ",
    "settings.contactFieldsNamePlaceholder": "Modèle de chaudière",
    "settings.contactFieldsTypeLabel": "Type",
    "settings.contactFieldsRemove": "Retirer",
    "settings.contactFieldsChoices": "Les choix, un par ligne",
    "settings.contactFieldsChoicesPlaceholder": "Mixte\nSystème\nChauffage seulement",
    "settings.contactFieldsExportsAs": "Exporté sous {key}",
    "settings.contactFieldsExportsAsFrozen":
        "Exporté sous {key} · le nom peut changer, le type non",
    "settings.contactFieldsAdd": "Ajouter un champ",
    "settings.contactFieldsSave": "Enregistrer les champs",
    "settings.contactFieldsDiscard": "Abandonner",
    "settings.contactFieldsNeedName": "Donnez d'abord un nom à chaque champ.",
    "settings.contactFieldsSavedEmpty":
        "Enregistré. Vos clients affichent de nouveau les champs standards.",
    "settings.contactFieldsSaved":
        "Enregistré. Ces champs apparaissent sur chaque client.",
]

// ---------------------------------------------------------------------------
// Settings → leaving a workspace yourself (#406)
// ---------------------------------------------------------------------------

private let settingsLeaveEn: [String: String] = [
    "settings.leaveTitle": "Leave this workspace",
    "settings.leaveIntro":
        "End your own access to this workspace. You can do this yourself — you "
        + "don't need to ask an owner.",
    "settings.leaveAccessEnds":
        "Your access ends straight away, on every device you're signed in on.",
    "settings.leaveWorkReturns":
        "Anything you were working on goes back to the team, so nothing is left "
        + "pointing at someone who has gone.",
    "settings.leaveHistoryStays":
        "Messages you sent stay on the record under your name. Leaving doesn't "
        + "erase your work, and isn't meant to.",
    "settings.leaveComeBack":
        "To come back, someone in the workspace has to invite you again.",
    "settings.leaveAction": "Leave workspace",
    "settings.leavePending": "Leaving…",
    "settings.leaveConfirmTitle": "Leave {workspace}?",
    "settings.leaveConfirmBody":
        "Your access ends now and your open work goes back to the team. To come "
        + "back, someone will need to invite you again.",
    "settings.leaveStay": "Stay",
]

private let settingsLeaveFr: [String: String] = [
    "settings.leaveTitle": "Quitter cet espace de travail",
    "settings.leaveIntro":
        "Mettez fin vous-même à votre accès à cet espace de travail. Vous pouvez "
        + "le faire vous-même — vous n'avez pas à le demander à un propriétaire.",
    "settings.leaveAccessEnds":
        "Votre accès prend fin immédiatement, sur chaque appareil où vous êtes "
        + "connecté.",
    "settings.leaveWorkReturns":
        "Tout ce sur quoi vous travailliez retourne à l'équipe : rien ne reste "
        + "rattaché à quelqu'un qui est parti.",
    "settings.leaveHistoryStays":
        "Les textos que vous avez envoyés restent au dossier sous votre nom. "
        + "Partir n'efface pas votre travail, et ce n'est pas le but.",
    "settings.leaveComeBack":
        "Pour revenir, quelqu'un de l'espace de travail doit vous réinviter.",
    "settings.leaveAction": "Quitter l'espace de travail",
    "settings.leavePending": "Départ en cours…",
    "settings.leaveConfirmTitle": "Quitter {workspace} ?",
    "settings.leaveConfirmBody":
        "Votre accès prend fin maintenant et votre travail en cours retourne à "
        + "l'équipe. Pour revenir, quelqu'un devra vous réinviter.",
    "settings.leaveStay": "Rester",
]

// ---------------------------------------------------------------------------
// Settings → Help (#382, #253, #321, #555)
// ---------------------------------------------------------------------------

/// `supportTopics`, `supportFixPromise` and the response-time sentence are NOT
/// here. All three are hand-ported MIRRORS of `packages/shared/src/support.ts`
/// pinned by content, and a French copy in this catalogue would be a second
/// original for a string whose whole point is that three clients say it
/// identically. They are named in the extraction report rather than half-moved.
private let settingsHelpEn: [String: String] = [
    "settings.helpEmailTitle": "Email us",
    "settings.helpEmailIntro":
        "Opens your mail app with your workspace details already filled in, so we "
        + "can look it up without asking you first.",
    "settings.helpEmailAction": "Email {email}",
    "settings.helpWhatToSay":
        "Say what you expected and what happened instead. If it's about a specific "
        + "text or call, the customer's number and roughly when it happened is "
        + "usually all we need.",
    "settings.helpNoMailAppTitle": "If that button doesn't open anything",
    "settings.helpNoMailAppIntro":
        "Write to {email} from any email app and paste this in.",
    "settings.helpIdeaTitle": "Got an idea?",
    "settings.helpIdeaIntro":
        "Something we don't do yet, or do in a way that doesn't fit how you work.",
    "settings.helpIdeaAction": "Send an idea",
    "settings.helpIdeaNote":
        "This goes to the same place, under its own subject so it doesn't get "
        + "triaged as a fault. Half of what's in the product came from someone "
        + "describing their day.",
    "settings.helpFaqTitle": "Common questions",
    "settings.helpFaqIntro": "The things that confuse people most, answered straight.",
    "settings.helpExpectTitle": "What to expect",
    "settings.helpExpectIntro":
        "An honest answer rather than a promise we'd have to break.",
]

private let settingsHelpFr: [String: String] = [
    "settings.helpEmailTitle": "Écrivez-nous",
    "settings.helpEmailIntro":
        "Ouvre votre application de courriel avec les détails de votre espace de "
        + "travail déjà remplis, pour que nous puissions le retrouver sans vous le "
        + "demander.",
    "settings.helpEmailAction": "Écrire à {email}",
    "settings.helpWhatToSay":
        "Dites ce que vous attendiez et ce qui s'est passé à la place. S'il s'agit "
        + "d'un texto ou d'un appel précis, le numéro du client et le moment "
        + "approximatif nous suffisent en général.",
    "settings.helpNoMailAppTitle": "Si ce bouton n'ouvre rien",
    "settings.helpNoMailAppIntro":
        "Écrivez à {email} depuis n'importe quelle application de courriel et "
        + "collez ceci.",
    "settings.helpIdeaTitle": "Une idée ?",
    "settings.helpIdeaIntro":
        "Quelque chose que nous ne faisons pas encore, ou que nous faisons d'une "
        + "façon qui ne convient pas à votre travail.",
    "settings.helpIdeaAction": "Envoyer une idée",
    "settings.helpIdeaNote":
        "Cela arrive au même endroit, sous son propre objet, pour ne pas être "
        + "traité comme une panne. La moitié de ce qui est dans le produit vient de "
        + "quelqu'un qui nous a décrit sa journée.",
    "settings.helpFaqTitle": "Questions fréquentes",
    "settings.helpFaqIntro":
        "Ce qui déroute le plus les gens, expliqué franchement.",
    "settings.helpExpectTitle": "À quoi vous attendre",
    "settings.helpExpectIntro":
        "Une réponse honnête plutôt qu'une promesse que nous devrions rompre.",
]

// ---------------------------------------------------------------------------
// Settings → deleting your own account (#346, #371)
// ---------------------------------------------------------------------------

/// `{word}` is the word that has to be typed, and it is NOT translated: the
/// comparison in `DeleteAccountCard` is against the literal `delete`, so a French
/// label naming a French word would ask for a word the check refuses.
private let settingsDeleteAccountEn: [String: String] = [
    "settings.deleteTitle": "Delete your account",
    "settings.deleteIntro":
        "Removes you from Loonext entirely. This cannot be undone.",
    "settings.deleteAction": "Delete my account",
    "settings.deleteChecking": "Checking your account…",
    "settings.deletePreviewFailed":
        "Couldn't check your account. Try again in a moment.",
    "settings.deleteFailed": "Couldn't delete your account. Try again in a moment.",
    "settings.deleteOwnedFallback": "a workspace",
    "settings.deleteBlockedByOwnership":
        "You own {workspaces}. A workspace cannot be left without an owner, so hand "
        + "it to someone else or close it first — then you can delete your account.",
    "settings.deleteClosingIsElsewhere":
        "Closing a workspace is on the workspace settings screen.",
    "settings.deleteSignedOut":
        "You are signed out everywhere and cannot sign back in. Your name comes off "
        + "the app, and notifications stop.",
    "settings.deleteLeaveOne": "You leave your workspace.",
    "settings.deleteLeaveOneOpenWork":
        "You leave your workspace, and anything you are still working on goes back "
        + "to the crew so nothing is lost.",
    "settings.deleteLeaveMany": "You leave all {count} of your workspaces.",
    "settings.deleteLeaveManyOpenWork":
        "You leave all {count} of your workspaces, and anything you are still "
        + "working on goes back to the crew so nothing is lost.",
    "settings.deleteRecordStays":
        "Texts you sent to customers, jobs you logged and notes you wrote stay with "
        + "the business. They have to — that record is theirs, and some of it we are "
        + "required by law to keep. They will no longer carry your name.",
    "settings.deleteConfirmationEmail":
        "We email you a confirmation before your address is removed. It is the last "
        + "thing you will get from us, and it is worth keeping.",
    "settings.deleteConfirmTitle": "Delete your account?",
    "settings.deleteConfirmBody":
        "You will be signed out everywhere and will not be able to sign back in. "
        + "Your work stays with the business, without your name on it. Nobody can "
        + "undo this.",
    "settings.deleteTypeToConfirm": "Type {word} to confirm",
    "settings.deleteKeep": "Keep my account",
]

private let settingsDeleteAccountFr: [String: String] = [
    "settings.deleteTitle": "Supprimer votre compte",
    "settings.deleteIntro":
        "Vous retire entièrement de Loonext. Cette action est irréversible.",
    "settings.deleteAction": "Supprimer mon compte",
    "settings.deleteChecking": "Vérification de votre compte…",
    "settings.deletePreviewFailed":
        "Impossible de vérifier votre compte. Réessayez dans un moment.",
    "settings.deleteFailed":
        "Impossible de supprimer votre compte. Réessayez dans un moment.",
    "settings.deleteOwnedFallback": "un espace de travail",
    "settings.deleteBlockedByOwnership":
        "Vous êtes propriétaire de {workspaces}. Un espace de travail ne peut pas "
        + "rester sans propriétaire : confiez-le à quelqu'un d'autre ou fermez-le "
        + "d'abord — vous pourrez ensuite supprimer votre compte.",
    "settings.deleteClosingIsElsewhere":
        "La fermeture d'un espace de travail se fait dans les paramètres de "
        + "l'espace de travail.",
    "settings.deleteSignedOut":
        "Vous êtes déconnecté partout et ne pourrez plus vous reconnecter. Votre nom "
        + "est retiré de l'application et les notifications cessent.",
    "settings.deleteLeaveOne": "Vous quittez votre espace de travail.",
    "settings.deleteLeaveOneOpenWork":
        "Vous quittez votre espace de travail, et tout ce sur quoi vous travaillez "
        + "encore retourne à l'équipe pour que rien ne se perde.",
    "settings.deleteLeaveMany": "Vous quittez vos {count} espaces de travail.",
    "settings.deleteLeaveManyOpenWork":
        "Vous quittez vos {count} espaces de travail, et tout ce sur quoi vous "
        + "travaillez encore retourne à l'équipe pour que rien ne se perde.",
    "settings.deleteRecordStays":
        "Les textos envoyés aux clients, les travaux consignés et les notes que vous "
        + "avez écrites restent à l'entreprise. C'est obligatoire : ce dossier lui "
        + "appartient, et la loi nous oblige à en conserver une partie. Votre nom n'y "
        + "figurera plus.",
    "settings.deleteConfirmationEmail":
        "Nous vous envoyons une confirmation par courriel avant de retirer votre "
        + "adresse. C'est la dernière chose que vous recevrez de nous, et elle vaut la "
        + "peine d'être conservée.",
    "settings.deleteConfirmTitle": "Supprimer votre compte ?",
    "settings.deleteConfirmBody":
        "Vous serez déconnecté partout et ne pourrez plus vous reconnecter. Votre "
        + "travail reste à l'entreprise, sans votre nom. Personne ne peut annuler ceci.",
    "settings.deleteTypeToConfirm": "Tapez {word} pour confirmer",
    "settings.deleteKeep": "Garder mon compte",
]

// ---------------------------------------------------------------------------
// Settings → emergency words and reply (#460, #553)
// ---------------------------------------------------------------------------

/// URGENT stays URGENT in the French. It is the word a CUSTOMER texts, matched
/// on the wire against the workspace's keyword list — translating the example
/// would teach a Quebec owner to expect a word the matcher never sees.
///
/// `{line}` is `emergencySafetyLine`, likewise not translated here: it is the
/// sentence the SERVER appends to an outgoing text, mirrored from shared, and
/// this screen only quotes it back.
private let settingsEmergencyEn: [String: String] = [
    "settings.emergencyTitle": "Emergency words and reply",
    "settings.emergencyIntro":
        "Which words a customer can text to reach the whole crew straight away, and "
        + "what goes back to them automatically.",
    "settings.emergencyWordsHeading": "Words that count as an emergency",
    "settings.emergencyWordsHelp":
        "Matched on the first word a customer sends, so \"URGENT no heat\" counts. "
        + "Use the words your customers would actually reach for.",
    "settings.emergencyWordChip": "{word}  ×",
    "settings.emergencyRemoveWordLabel": "Remove {word}",
    "settings.emergencyDuplicateWord": "{word} is already on the list.",
    "settings.emergencyTooManyWords":
        "Ten words is the limit — past that it stops being an emergency.",
    "settings.emergencyKeepOneWord":
        "Keep at least one word. To stop treating replies as emergencies, turn the "
        + "switch off above.",
    "settings.emergencyAddWordPlaceholder": "LOCKEDOUT",
    "settings.emergencyAddWordAction": "Add",
    "settings.emergencyDefaults":
        "These are the defaults. Change them and only your words are watched for.",
    "settings.emergencyReplyHeading": "Automatic reply",
    "settings.emergencyTextBack": "Text the customer back",
    "settings.emergencyTextBackHelp":
        "Off means we still alert the crew and flag the thread — we just don't "
        + "message the customer for you.",
    "settings.emergencyReplyHelp":
        "Sent once per hour, at most, to a customer who texts one of these words. "
        + "Say what is true for your business.",
    "settings.emergencyCount": "{count}/1000",
    "settings.emergencyCountDefault": "{count}/1000 · using the default",
    "settings.emergencyPreviewLabel": "What the customer receives",
    "settings.emergencySafetyLineNote":
        "\"{line}\" is always added and can't be edited. You decide what is "
        + "promised; whether someone in danger is told where else to turn isn't ours "
        + "to leave out.",
    "settings.emergencySaveAction": "Save emergency settings",
    "settings.emergencySaved": "Emergency settings saved.",
    "settings.emergencyReadOnly":
        "Only owners and admins can change emergency settings.",
]

private let settingsEmergencyFr: [String: String] = [
    "settings.emergencyTitle": "Mots d'urgence et réponse",
    "settings.emergencyIntro":
        "Quels mots un client peut envoyer par texto pour joindre toute l'équipe "
        + "immédiatement, et ce qui lui est renvoyé automatiquement.",
    "settings.emergencyWordsHeading": "Les mots qui comptent comme une urgence",
    "settings.emergencyWordsHelp":
        "La correspondance se fait sur le premier mot envoyé par le client : "
        + "« URGENT pas de chauffage » compte donc. Utilisez les mots auxquels vos "
        + "clients penseraient vraiment.",
    "settings.emergencyWordChip": "{word}  ×",
    "settings.emergencyRemoveWordLabel": "Retirer {word}",
    "settings.emergencyDuplicateWord": "{word} est déjà dans la liste.",
    "settings.emergencyTooManyWords":
        "Dix mots, c'est la limite — au-delà, ce n'est plus une urgence.",
    "settings.emergencyKeepOneWord":
        "Gardez au moins un mot. Pour cesser de traiter les réponses comme des "
        + "urgences, désactivez l'interrupteur ci-dessus.",
    "settings.emergencyAddWordPlaceholder": "SANSCHAUFFAGE",
    "settings.emergencyAddWordAction": "Ajouter",
    "settings.emergencyDefaults":
        "Ce sont les mots par défaut. Modifiez-les et seuls vos mots seront surveillés.",
    "settings.emergencyReplyHeading": "Réponse automatique",
    "settings.emergencyTextBack": "Répondre au client par texto",
    "settings.emergencyTextBackHelp":
        "Désactivée, nous alertons quand même l'équipe et signalons la conversation "
        + "— nous n'écrivons simplement pas au client à votre place.",
    "settings.emergencyReplyHelp":
        "Envoyée au plus une fois par heure au client qui écrit l'un de ces mots. "
        + "Dites ce qui est vrai pour votre entreprise.",
    "settings.emergencyCount": "{count}/1000",
    "settings.emergencyCountDefault": "{count}/1000 · valeur par défaut utilisée",
    "settings.emergencyPreviewLabel": "Ce que le client reçoit",
    "settings.emergencySafetyLineNote":
        "« {line} » est toujours ajoutée et ne peut pas être modifiée. Vous décidez "
        + "de ce qui est promis ; dire à une personne en danger vers qui d'autre se "
        + "tourner n'est pas à nous de l'omettre.",
    "settings.emergencySaveAction": "Enregistrer les réglages d'urgence",
    "settings.emergencySaved": "Réglages d'urgence enregistrés.",
    "settings.emergencyReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier les "
        + "réglages d'urgence.",
]

// ---------------------------------------------------------------------------
// Settings → signed-in devices, app lock and mobile data (#236, #289, #330)
// ---------------------------------------------------------------------------

/// Every count sentence exists TWICE — one device and several — rather than
/// dropping a "3 devices" phrase into a shared stem. `deviceCountLabel` builds
/// that phrase in English only, so the shared-stem version would have printed an
/// English fragment in the middle of a French warning about somebody's phone.
///
/// `settings.devicesAppLockHelp` names Face ID and Touch ID where Android names
/// a fingerprint and a screen lock. That is the one key in this file whose
/// English is deliberately not its twin's: neither phone has the other's
/// hardware, and a Quebec tech told to use a fingerprint on an iPhone with none
/// is being sent to look for a control that is not there.
private let settingsDevicesEn: [String: String] = [
    "settings.devicesMineTitle": "Your devices",
    "settings.devicesMineIntro":
        "Anything signed in as you, in any workspace. Signing one out takes effect "
        + "on its next tap.",
    "settings.devicesNoneSignedIn":
        "Nothing is signed in — which cannot be true, since you are reading this. "
        + "Pull to refresh and check again.",
    "settings.devicesLocationUnknown": "Location not available",
    "settings.devicesThisDevice": "This device",
    "settings.devicesLastActive": "Last active {lastActive} · signed in {signedIn}",
    "settings.devicesSignOut": "Sign out",
    "settings.devicesSignedOutThatOne": "Signed that device out.",
    "settings.devicesSignOutEverywhere": "Sign out everywhere else",
    "settings.devicesSignOutEverywhereTitle": "Sign out everywhere else?",
    "settings.devicesSignOutEverywhereBodyOne":
        "1 device will stop working on the next tap, and stop receiving your "
        + "customers' messages. You stay signed in here. Anyone who should still have "
        + "access can sign back in.",
    "settings.devicesSignOutEverywhereBody":
        "{count} devices will stop working on the next tap, and stop receiving your "
        + "customers' messages. You stay signed in here. Anyone who should still have "
        + "access can sign back in.",
    "settings.devicesSignThemOut": "Sign them out",
    "settings.devicesNothingElseSignedIn": "Nothing else was signed in.",
    "settings.devicesSignedOutOne": "Signed out 1 device.",
    "settings.devicesSignedOutMany": "Signed out {count} devices.",
    "settings.devicesCrewTitle": "The crew's devices",
    "settings.devicesCrewIntro":
        "Everything signed in to this workspace. Removing someone already ends "
        + "their access — this is for a phone that went missing while they are still "
        + "on the team.",
    "settings.devicesCrewNoneSignedIn":
        "Nobody on the crew has anything signed in right now.",
    "settings.devicesCrewMemberFallback": "A crew member",
    "settings.devicesSignMemberOutTitle": "Sign {name} out?",
    "settings.devicesSignMemberOutBodyOne":
        "Every device they are signed in on — 1 device right now — stops working on "
        + "its next tap and stops receiving this workspace's messages. They keep "
        + "their seat and can sign back in; a call they are on right now is not cut off.",
    "settings.devicesSignMemberOutBody":
        "Every device they are signed in on — {count} right now — stops working on "
        + "its next tap and stops receiving this workspace's messages. They keep "
        + "their seat and can sign back in; a call they are on right now is not cut off.",
    "settings.devicesTheyHadNothing": "They had nothing signed in.",
    "settings.devicesSignedMemberOutOne": "Signed {name} out of 1 device.",
    "settings.devicesSignedMemberOutMany": "Signed {name} out of {count} devices.",
    "settings.devicesThisPhoneOnly":
        "This phone only. Your other devices keep their own answer.",
    "settings.devicesAppLockTitle": "Lock this app",
    "settings.devicesAppLockLabel": "Ask before showing the inbox",
    "settings.devicesAppLockHelp":
        "Face ID, Touch ID or your passcode, whenever the app has been away for a "
        + "minute. Worth it if this phone is ever handed to somebody else.",
    "settings.devicesMobileDataTitle": "Mobile data",
]

private let settingsDevicesFr: [String: String] = [
    "settings.devicesMineTitle": "Vos appareils",
    "settings.devicesMineIntro":
        "Tout ce qui est connecté en votre nom, dans n'importe quel espace de "
        + "travail. La déconnexion d'un appareil prend effet à sa prochaine touche.",
    "settings.devicesNoneSignedIn":
        "Rien n'est connecté — ce qui ne peut pas être vrai, puisque vous lisez "
        + "ceci. Tirez pour actualiser et vérifiez de nouveau.",
    "settings.devicesLocationUnknown": "Lieu non disponible",
    "settings.devicesThisDevice": "Cet appareil",
    "settings.devicesLastActive":
        "Dernière activité {lastActive} · connecté {signedIn}",
    "settings.devicesSignOut": "Déconnecter",
    "settings.devicesSignedOutThatOne": "Cet appareil a été déconnecté.",
    "settings.devicesSignOutEverywhere": "Déconnecter partout ailleurs",
    "settings.devicesSignOutEverywhereTitle": "Déconnecter partout ailleurs ?",
    "settings.devicesSignOutEverywhereBodyOne":
        "1 appareil cessera de fonctionner à la prochaine touche et cessera de "
        + "recevoir les textos de vos clients. Vous restez connecté ici. Quiconque "
        + "doit garder l'accès peut se reconnecter.",
    "settings.devicesSignOutEverywhereBody":
        "{count} appareils cesseront de fonctionner à la prochaine touche et "
        + "cesseront de recevoir les textos de vos clients. Vous restez connecté ici. "
        + "Quiconque doit garder l'accès peut se reconnecter.",
    "settings.devicesSignThemOut": "Les déconnecter",
    "settings.devicesNothingElseSignedIn": "Rien d'autre n'était connecté.",
    "settings.devicesSignedOutOne": "1 appareil déconnecté.",
    "settings.devicesSignedOutMany": "{count} appareils déconnectés.",
    "settings.devicesCrewTitle": "Les appareils de l'équipe",
    "settings.devicesCrewIntro":
        "Tout ce qui est connecté à cet espace de travail. Retirer quelqu'un met "
        + "déjà fin à son accès — ceci sert au téléphone égaré d'une personne "
        + "toujours dans l'équipe.",
    "settings.devicesCrewNoneSignedIn":
        "Personne dans l'équipe n'a d'appareil connecté en ce moment.",
    "settings.devicesCrewMemberFallback": "Un membre de l'équipe",
    "settings.devicesSignMemberOutTitle": "Déconnecter {name} ?",
    "settings.devicesSignMemberOutBodyOne":
        "Chaque appareil sur lequel cette personne est connectée — 1 appareil en ce "
        + "moment — cessera de fonctionner à sa prochaine touche et cessera de "
        + "recevoir les textos de cet espace de travail. Elle garde sa place et peut "
        + "se reconnecter ; un appel en cours n'est pas coupé.",
    "settings.devicesSignMemberOutBody":
        "Chaque appareil sur lequel cette personne est connectée — {count} en ce "
        + "moment — cessera de fonctionner à sa prochaine touche et cessera de "
        + "recevoir les textos de cet espace de travail. Elle garde sa place et peut "
        + "se reconnecter ; un appel en cours n'est pas coupé.",
    "settings.devicesTheyHadNothing": "Cette personne n'avait rien de connecté.",
    "settings.devicesSignedMemberOutOne": "{name} a été déconnecté de 1 appareil.",
    "settings.devicesSignedMemberOutMany":
        "{name} a été déconnecté de {count} appareils.",
    "settings.devicesThisPhoneOnly":
        "Ce téléphone seulement. Vos autres appareils gardent leur propre réglage.",
    "settings.devicesAppLockTitle": "Verrouiller cette application",
    "settings.devicesAppLockLabel": "Demander avant d'afficher la boîte de réception",
    "settings.devicesAppLockHelp":
        "Face ID, Touch ID ou votre code, dès que l'application a été mise de côté "
        + "une minute. Utile si ce téléphone est parfois remis à quelqu'un d'autre.",
    "settings.devicesMobileDataTitle": "Données mobiles",
]

// ---------------------------------------------------------------------------
// Settings → business hours and away reply (#157, #414, #453, #460)
// ---------------------------------------------------------------------------

/// `{first_name}` and `{business_name}` inside `settings.awayCount` are MERGE
/// FIELDS, not catalogue tokens: they are the literal words an owner types into
/// the away message, so they read the same in both languages and are left
/// untouched by the interpolator (an unknown token stays visible on purpose).
private let settingsHoursEn: [String: String] = [
    "settings.hoursTitle": "Business hours",
    "settings.hoursIntro":
        "When you're open, in {timezone}. Texts that arrive outside these hours can "
        + "get your away reply. This is separate from each customer's texting quiet "
        + "hours.",
    "settings.hoursInvalid":
        "Times are 24-hour HH:MM, and open and close can't match.",
    "settings.hoursSaveAction": "Save hours",
    "settings.hoursSaved": "Business hours saved.",
    "settings.hoursReadOnly": "Only owners and admins can change business hours.",
    "settings.hoursOpen": "Open",
    "settings.hoursClose": "Close",
    "settings.hoursTo": "to",
    "settings.hoursClosed": "Closed",
    "settings.awayTitle": "Away reply",
    "settings.awayIntro":
        "One automatic text back when someone reaches you outside your business "
        + "hours, in your words, so you never lose an after-hours emergency.",
    "settings.awayEnable": "Reply automatically after hours",
    "settings.awayEnableHelp":
        "Fires once per conversation when a customer first texts outside your hours.",
    "settings.awayUsTextingOff":
        "Customers with US numbers won't get this reply: US texting isn't on for "
        + "this workspace. Canadian numbers get it now.",
    "settings.awayUsPending":
        "Customers with US numbers won't get this reply until your registration is "
        + "approved. Canadian numbers get it now.",
    "settings.awayCount":
        "{count}/1000 · {first_name} and {business_name} fill in automatically.",
    "settings.awayEmergencySwitch": "Treat an emergency word as an emergency",
    "settings.awayEmergencySwitchHelp":
        "Texts back starting with {words} reach everyone on the crew straight away, "
        + "at the priority that wakes a phone — no away reply, and never held back by "
        + "your daily notification limit.",
    "settings.awayPreviewLabel": "Preview",
    "settings.awayNeedsMessage": "Write your away message before turning it on.",
    "settings.awaySaveAction": "Save away reply",
    "settings.awaySaved": "Away reply saved.",
    "settings.awayReadOnly": "Only owners and admins can change the away reply.",
]

private let settingsHoursFr: [String: String] = [
    "settings.hoursTitle": "Heures d'ouverture",
    "settings.hoursIntro":
        "Vos heures d'ouverture, selon {timezone}. Les textos qui arrivent en dehors "
        + "de ces heures peuvent recevoir votre réponse d'absence. C'est distinct des "
        + "heures de silence propres à chaque client.",
    "settings.hoursInvalid":
        "Les heures s'écrivent HH:MM sur 24 heures, et l'ouverture ne peut pas être "
        + "identique à la fermeture.",
    "settings.hoursSaveAction": "Enregistrer les heures",
    "settings.hoursSaved": "Heures d'ouverture enregistrées.",
    "settings.hoursReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier les heures "
        + "d'ouverture.",
    "settings.hoursOpen": "Ouverture",
    "settings.hoursClose": "Fermeture",
    "settings.hoursTo": "à",
    "settings.hoursClosed": "Fermé",
    "settings.awayTitle": "Réponse d'absence",
    "settings.awayIntro":
        "Un texto automatique en retour quand quelqu'un vous joint en dehors de vos "
        + "heures d'ouverture, dans vos mots, pour ne jamais perdre une urgence après "
        + "les heures.",
    "settings.awayEnable": "Répondre automatiquement après les heures",
    "settings.awayEnableHelp":
        "Part une seule fois par conversation, au premier texto d'un client en "
        + "dehors de vos heures.",
    "settings.awayUsTextingOff":
        "Les clients avec un numéro américain ne recevront pas cette réponse : les "
        + "textos vers les États-Unis ne sont pas activés pour cet espace de travail. "
        + "Les numéros canadiens la reçoivent dès maintenant.",
    "settings.awayUsPending":
        "Les clients avec un numéro américain ne recevront pas cette réponse tant "
        + "que votre inscription n'est pas approuvée. Les numéros canadiens la "
        + "reçoivent dès maintenant.",
    "settings.awayCount":
        "{count}/1000 · {first_name} et {business_name} se remplissent automatiquement.",
    "settings.awayEmergencySwitch": "Traiter un mot d'urgence comme une urgence",
    "settings.awayEmergencySwitchHelp":
        "Les textos qui commencent par {words} joignent immédiatement toute "
        + "l'équipe, à la priorité qui réveille un téléphone — sans réponse d'absence, "
        + "et jamais retenus par votre limite quotidienne de notifications.",
    "settings.awayPreviewLabel": "Aperçu",
    "settings.awayNeedsMessage":
        "Écrivez votre message d'absence avant de l'activer.",
    "settings.awaySaveAction": "Enregistrer la réponse d'absence",
    "settings.awaySaved": "Réponse d'absence enregistrée.",
    "settings.awayReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier la réponse "
        + "d'absence.",
]

// ---------------------------------------------------------------------------
// Settings → Calling (#157, #192, #193, #278, #309)
// ---------------------------------------------------------------------------

private let settingsCallingEn: [String: String] = [
    "settings.callingHostedOnly":
        "In-app calling needs a number whose calls come through Loonext. Calls to "
        + "your text-enabled landline stay with your existing carrier, so these "
        + "settings won't apply until you add or transfer a Loonext number.",

    "settings.textBackTitle": "Text back a missed call",
    "settings.textBackIntro":
        "When a call to your business number goes unanswered, we send the caller "
        + "one text so they can book by reply, instead of calling the next number on "
        + "their list.",
    "settings.textBackSwitch": "Text back missed calls",
    "settings.textBackSwitchHelp":
        "Fires once per caller when a call goes unanswered.",
    "settings.textBackUsTextingOff":
        "Callers with US numbers won't get this text: US texting isn't on for this "
        + "workspace. Canadian callers get it now.",
    "settings.textBackUsPending":
        "Callers with US numbers won't get this text until your registration is "
        + "approved. Canadian callers get it now.",
    "settings.textBackHint":
        "Leave it empty to send the default. {business_name} fills in automatically.",
    "settings.textBackStatusSaving": " · Saving…",
    "settings.textBackStatusSaved": " · Saved",
    "settings.textBackPreviewLabel": "What the caller receives",
    "settings.textBackReadOnly":
        "Only owners and admins can change the missed-call text-back.",

    "settings.voicemailTitle": "Voicemail greeting",
    "settings.voicemailIntro":
        "When nobody answers in the app, the caller hears this greeting and can "
        + "leave a message up to two minutes. Voicemails land in the call log and the "
        + "caller's conversation, ready to play.",
    "settings.voicemailCount":
        "{count}/500 · Spoken aloud to the caller. Leave it empty to use the default.",
    "settings.voicemailPreviewLabel": "What callers hear",
    "settings.voicemailSaveAction": "Save greeting",
    "settings.voicemailSaved": "Voicemail greeting saved.",
    "settings.voicemailReadOnly":
        "Only owners and admins can change the voicemail greeting.",

    "settings.screeningTitle": "Call screening",
    "settings.screeningIntro":
        "What happens when the carrier thinks an incoming call is spam.",
    "settings.screeningOff": "Off",
    "settings.screeningOffDetail": "Every call rings the team, no carrier verdict shown.",
    "settings.screeningFlag": "Label suspicious calls",
    "settings.screeningFlagDetail":
        "The carrier's verdict shows on the call as “Spam likely”, but every call "
        + "still rings the team.",
    "settings.screeningDivert": "Send suspicious calls to voicemail",
    "settings.screeningDivertDetail":
        "Flagged callers skip the ring and go straight to voicemail. A real customer "
        + "who gets misflagged can still leave a message.",
    "settings.screeningUpdated": "Call screening updated.",
    "settings.screeningReadOnly": "Only owners and admins can change call screening.",

    "settings.afterHoursTitle": "After hours",
    "settings.afterHoursIntro":
        "Outside your business hours a call can ring everyone, ring only whoever's "
        + "on call, or go straight to a message. Most small crews are best on the "
        + "first one.",
    "settings.afterHoursNoHours":
        "You haven't set business hours yet, so nothing here can happen — every hour "
        + "is a working hour until you do. Set them under Hours.",
    "settings.afterHoursRingEveryone": "Ring everyone, day or night",
    "settings.afterHoursRingEveryoneDetail":
        "What happens today. Every call rings the whole crew whatever the clock says.",
    "settings.afterHoursOnCallOnly": "Ring only whoever's on call",
    "settings.afterHoursOnCallOnlyDetail":
        "After hours, the phone rings for the person holding the on-call shift and "
        + "nobody else. With no shift set, everyone rings — we never leave a call "
        + "reaching nobody.",
    "settings.afterHoursVoicemail": "Take a message",
    "settings.afterHoursVoicemailDetail":
        "After hours, the caller goes straight to your greeting instead of ringing "
        + "out first — unless somebody is on call, who still rings.",
    "settings.afterHoursUpdated": "After-hours calling updated.",
    "settings.afterHoursReadOnly":
        "Only owners and admins can change after-hours calling.",

    "settings.callerIdTitle": "Caller ID",
    "settings.callerIdIntro":
        "What people see when you call them, and what you see when they call you.",
    "settings.callerIdOutboundHeading": "Your outbound display name",
    "settings.callerIdNone": "No display name",
    "settings.callerIdUsingCompanyName": "Using your company name",
    "settings.callerIdCustom": "Custom display name",
    "settings.callerIdChange": "Change",
    "settings.callerIdPending":
        "Caller ID update submitted. Carriers usually show the new name within 1 to "
        + "3 days.",
    "settings.callerIdNewNameHelp":
        "Shown on US caller ID when you call customers. Letters, digits, and spaces, "
        + "15 characters max. Canadian display names are set by the receiving carrier, "
        + "so this mainly helps your US calls.",
    "settings.callerIdInvalid": "1 to 15 letters, digits, or spaces.",
    "settings.callerIdInvalidError":
        "The display name must be 1 to 15 letters, digits, or spaces.",
    "settings.callerIdUseCompanyName": "Use company name instead",
    "settings.callerIdReview": "Review change",
    "settings.callerIdConfirm": "Update your caller ID to \"{name}\"?",
    "settings.callerIdConfirmCompanyName":
        "Update your caller ID to \"{name}\" (your company name)?",
    "settings.callerIdConfirmNote":
        "Carriers refresh their name databases on their own schedule, so the new "
        + "name can take a few days to show on calls.",
    "settings.callerIdSubmit": "Update caller ID",
    "settings.callerIdSubmitting": "Submitting…",
    "settings.callerIdSubmitted": "Caller ID update submitted to carriers.",
    "settings.callerIdGoBack": "Go back",
    "settings.callerIdLookup": "Look up who's calling",
    "settings.callerIdLookupHelp":
        "Shows the caller's network-registered name on incoming calls when they "
        + "aren't in your contacts yet.",
    "settings.callerIdReadOnly":
        "Only owners and admins can change caller ID settings.",

    "settings.minutesFooter":
        "Your plan includes {minutes} calling minutes a month, both directions. "
        + "Details live in Settings › Usage.",
    "settings.minutesFooterOverage":
        "Your plan includes {minutes} calling minutes a month, both directions. Past "
        + "that, extra minutes bill at 1¢ each up to your spending cap. Details live "
        + "in Settings › Usage.",
]

private let settingsCallingFr: [String: String] = [
    "settings.callingHostedOnly":
        "Les appels dans l'application exigent un numéro dont les appels passent par "
        + "Loonext. Les appels vers votre ligne fixe compatible texto restent chez "
        + "votre fournisseur actuel : ces réglages ne s'appliqueront donc pas tant que "
        + "vous n'aurez pas ajouté ou transféré un numéro Loonext.",

    "settings.textBackTitle": "Répondre par texto à un appel manqué",
    "settings.textBackIntro":
        "Quand un appel à votre numéro d'entreprise reste sans réponse, nous "
        + "envoyons un seul texto à l'appelant pour qu'il puisse réserver en "
        + "répondant, au lieu d'appeler le numéro suivant sur sa liste.",
    "settings.textBackSwitch": "Répondre par texto aux appels manqués",
    "settings.textBackSwitchHelp":
        "Part une seule fois par appelant lorsqu'un appel reste sans réponse.",
    "settings.textBackUsTextingOff":
        "Les appelants avec un numéro américain ne recevront pas ce texto : les "
        + "textos vers les États-Unis ne sont pas activés pour cet espace de travail. "
        + "Les appelants canadiens le reçoivent dès maintenant.",
    "settings.textBackUsPending":
        "Les appelants avec un numéro américain ne recevront pas ce texto tant que "
        + "votre inscription n'est pas approuvée. Les appelants canadiens le reçoivent "
        + "dès maintenant.",
    "settings.textBackHint":
        "Laissez vide pour envoyer le message par défaut. {business_name} se remplit "
        + "automatiquement.",
    "settings.textBackStatusSaving": " · Enregistrement…",
    "settings.textBackStatusSaved": " · Enregistré",
    "settings.textBackPreviewLabel": "Ce que l'appelant reçoit",
    "settings.textBackReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier la réponse "
        + "aux appels manqués.",

    "settings.voicemailTitle": "Message d'accueil de la boîte vocale",
    "settings.voicemailIntro":
        "Quand personne ne répond dans l'application, l'appelant entend ce message "
        + "d'accueil et peut laisser un message d'au plus deux minutes. Les messages "
        + "vocaux arrivent dans le journal d'appels et dans la conversation de "
        + "l'appelant, prêts à être écoutés.",
    "settings.voicemailCount":
        "{count}/500 · Lu à voix haute à l'appelant. Laissez vide pour utiliser le "
        + "message par défaut.",
    "settings.voicemailPreviewLabel": "Ce que les appelants entendent",
    "settings.voicemailSaveAction": "Enregistrer le message d'accueil",
    "settings.voicemailSaved": "Message d'accueil enregistré.",
    "settings.voicemailReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier le message "
        + "d'accueil de la boîte vocale.",

    "settings.screeningTitle": "Filtrage des appels",
    "settings.screeningIntro":
        "Ce qui se passe quand le fournisseur juge qu'un appel entrant est du "
        + "pourriel.",
    "settings.screeningOff": "Désactivé",
    "settings.screeningOffDetail":
        "Chaque appel fait sonner l'équipe, sans verdict du fournisseur.",
    "settings.screeningFlag": "Signaler les appels suspects",
    "settings.screeningFlagDetail":
        "Le verdict du fournisseur s'affiche sur l'appel comme « Pourriel probable », "
        + "mais chaque appel fait quand même sonner l'équipe.",
    "settings.screeningDivert": "Envoyer les appels suspects à la boîte vocale",
    "settings.screeningDivertDetail":
        "Les appelants signalés ne font pas sonner et vont directement à la boîte "
        + "vocale. Un vrai client signalé par erreur peut quand même laisser un message.",
    "settings.screeningUpdated": "Filtrage des appels mis à jour.",
    "settings.screeningReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier le filtrage "
        + "des appels.",

    "settings.afterHoursTitle": "Après les heures",
    "settings.afterHoursIntro":
        "En dehors de vos heures d'ouverture, un appel peut faire sonner tout le "
        + "monde, ne faire sonner que la personne de garde, ou aller directement à un "
        + "message. La première option convient à la plupart des petites équipes.",
    "settings.afterHoursNoHours":
        "Vous n'avez pas encore défini d'heures d'ouverture : rien ici ne peut donc "
        + "se produire — chaque heure est une heure de travail tant que ce n'est pas "
        + "fait. Définissez-les sous Heures d'ouverture.",
    "settings.afterHoursRingEveryone": "Faire sonner tout le monde, jour et nuit",
    "settings.afterHoursRingEveryoneDetail":
        "Ce qui se passe aujourd'hui. Chaque appel fait sonner toute l'équipe, peu "
        + "importe l'heure.",
    "settings.afterHoursOnCallOnly": "Ne faire sonner que la personne de garde",
    "settings.afterHoursOnCallOnlyDetail":
        "Après les heures, le téléphone sonne pour la personne qui assure la garde "
        + "et pour personne d'autre. Sans garde définie, tout le monde sonne — nous ne "
        + "laissons jamais un appel n'atteindre personne.",
    "settings.afterHoursVoicemail": "Prendre un message",
    "settings.afterHoursVoicemailDetail":
        "Après les heures, l'appelant entend directement votre message d'accueil au "
        + "lieu de faire sonner d'abord — sauf si quelqu'un est de garde, auquel cas "
        + "son téléphone sonne.",
    "settings.afterHoursUpdated": "Appels après les heures mis à jour.",
    "settings.afterHoursReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier les appels "
        + "après les heures.",

    "settings.callerIdTitle": "Afficheur",
    "settings.callerIdIntro":
        "Ce que les gens voient quand vous les appelez, et ce que vous voyez quand "
        + "ils vous appellent.",
    "settings.callerIdOutboundHeading": "Votre nom d'affichage sortant",
    "settings.callerIdNone": "Aucun nom d'affichage",
    "settings.callerIdUsingCompanyName": "Le nom de votre entreprise est utilisé",
    "settings.callerIdCustom": "Nom d'affichage personnalisé",
    "settings.callerIdChange": "Modifier",
    "settings.callerIdPending":
        "Mise à jour de l'afficheur soumise. Les fournisseurs affichent "
        + "habituellement le nouveau nom en 1 à 3 jours.",
    "settings.callerIdNewNameHelp":
        "Affiché sur l'afficheur américain quand vous appelez des clients. Lettres, "
        + "chiffres et espaces, 15 caractères au maximum. Les noms d'affichage "
        + "canadiens sont fixés par le fournisseur qui reçoit l'appel : ceci aide donc "
        + "surtout vos appels vers les États-Unis.",
    "settings.callerIdInvalid": "De 1 à 15 lettres, chiffres ou espaces.",
    "settings.callerIdInvalidError":
        "Le nom d'affichage doit compter de 1 à 15 lettres, chiffres ou espaces.",
    "settings.callerIdUseCompanyName": "Utiliser plutôt le nom de l'entreprise",
    "settings.callerIdReview": "Réviser la modification",
    "settings.callerIdConfirm": "Remplacer votre afficheur par « {name} » ?",
    "settings.callerIdConfirmCompanyName":
        "Remplacer votre afficheur par « {name} » (le nom de votre entreprise) ?",
    "settings.callerIdConfirmNote":
        "Les fournisseurs actualisent leurs bases de noms selon leur propre horaire : "
        + "le nouveau nom peut donc mettre quelques jours à apparaître sur les appels.",
    "settings.callerIdSubmit": "Mettre l'afficheur à jour",
    "settings.callerIdSubmitting": "Envoi…",
    "settings.callerIdSubmitted":
        "Mise à jour de l'afficheur soumise aux fournisseurs.",
    "settings.callerIdGoBack": "Revenir",
    "settings.callerIdLookup": "Chercher qui appelle",
    "settings.callerIdLookupHelp":
        "Affiche le nom enregistré au réseau de l'appelant sur les appels entrants "
        + "quand il n'est pas encore dans vos clients.",
    "settings.callerIdReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier les "
        + "réglages de l'afficheur.",

    "settings.minutesFooter":
        "Votre forfait comprend {minutes} minutes d'appel par mois, dans les deux "
        + "sens. Les détails se trouvent dans Paramètres › Utilisation.",
    "settings.minutesFooterOverage":
        "Votre forfait comprend {minutes} minutes d'appel par mois, dans les deux "
        + "sens. Au-delà, les minutes supplémentaires sont facturées 1 ¢ chacune "
        + "jusqu'à votre plafond de dépenses. Les détails se trouvent dans "
        + "Paramètres › Utilisation.",
]

// ---------------------------------------------------------------------------
// Settings → Numbers → a number the plan does not cover (#523)
// ---------------------------------------------------------------------------

/// Only the CONTROLS are here. The sentences that EXPLAIN a hold come from
/// `heldNumbersState` and `reinstateNumberCopy` in SettingsLogic.swift, which
/// `HeldNumbersTests` pins by content — threading a locale into them is its own
/// change.
private let settingsHeldEn: [String: String] = [
    "settings.heldThisNumber": "This number",
    "settings.heldOnHold": "On hold",
    "settings.heldGetInTouch": "Get in touch",
    "settings.heldBringBackPriced": "Bring it back · {price}",
]

private let settingsHeldFr: [String: String] = [
    "settings.heldThisNumber": "Ce numéro",
    "settings.heldOnHold": "En attente",
    "settings.heldGetInTouch": "Nous joindre",
    "settings.heldBringBackPriced": "Le réactiver · {price}",
]

// ---------------------------------------------------------------------------
// Settings → Billing (#163, #277, #328, #392, #481, #490, #523, #583)
// ---------------------------------------------------------------------------

/// FOUR SENTENCES ON THE CANCEL CARD ARE NOT HERE, and they are absent for a
/// reason that is not an oversight: `SettingsLogicTests` reads
/// BillingSection.swift and asserts each of them appears there as a literal —
/// "Continue to cancel", "Take your contacts with you", the two branches of
/// `consequence` ("Cancel anytime." / "Only the owner can cancel this plan."),
/// and the portal sentence under them. Moving any one into this catalogue turns
/// that suite red. Android answered the same problem by re-pointing its guard at
/// the KEY (`ExitPathGuard.EXIT_KEY`); doing that here is a change to a test
/// proven against fifteen mutations, so it is reported rather than attempted
/// under an extraction.
///
/// `settings.holdEndedOn` deliberately does NOT match its Android twin — see the
/// note at the top of this file, and the docblock on `holdSentence`.
///
/// Not here either, and named in the extraction report: `pausedStateLines`,
/// `prepaidConversionCopy`, `cancellationOffer`, `planFacts`,
/// `pauseOfferBody`, `pauseConfirmMessage`, `pausedConfirmationMessage`,
/// `pauseResumeLabel`, `planUnconfirmedLine`, `changePlanMessage` and
/// `cancellationReasons` all live in SettingsLogic.swift, which is another
/// agent's file.
private let settingsBillingEn: [String: String] = [
    "settings.billingTitle": "Billing",
    "settings.billingReadOnly": "Only owners and admins can change billing.",
    "settings.billingOpening": "Opening…",
    "settings.billingPortalTitle": "Payment & invoices",
    "settings.billingPortalIntro":
        "Cards, receipts, and billing details live in the secure Stripe portal. It "
        + "opens in your browser.",
    "settings.billingPortalAction": "Manage payment & invoices",

    "settings.noticePastDue":
        "Your last payment didn't go through. Update your payment method to keep "
        + "sending messages.",
    "settings.noticeUnpaid":
        "Sending is paused until your payment method is updated.",
    "settings.noticeUpdatePayment": "Update payment method",
    "settings.noticeCancelling":
        "Your plan is set to cancel at the end of this period. Texting stops then. "
        + "Your number is held for {days} days from the day you cancelled — not from "
        + "that date — so it can be released soon afterwards. You can undo this from "
        + "the payment portal.",
    "settings.noticeCancellingOn":
        "Your plan is set to cancel on {date}. Texting stops then. Your number is "
        + "held for {days} days from the day you cancelled — not from that date — so "
        + "it can be released soon afterwards. You can undo this from the payment "
        + "portal.",
    "settings.noticeKeepMyPlan": "Keep my plan",

    "settings.subscriptionTitle": "Subscription",
    "settings.subscriptionCanceled": "Your subscription is canceled.",
    "settings.resubscribe": "Resubscribe",
    "settings.winbackNoThanks": "No thanks",
    "settings.winbackDismissFailed": "Couldn't save that — you may see this again.",
    "settings.holdRule":
        "We hold your number for {days} days from the day you cancel. Resubscribe "
        + "before then and everything picks up where it left off.",
    "settings.holdUntil":
        "We hold your number until {date}. Resubscribe before then and everything "
        + "picks up where it left off.",
    "settings.holdEndedOn":
        "The {days}-day hold on your number ended on {date}. We can't promise it any "
        + "more — once it goes back to the phone company, resubscribing sets you up "
        + "with a new number. Your message history is still here either way.",

    "settings.planTitle": "Plan",
    "settings.planNone":
        "No plan yet. Finish setup on the web to pick one and get your number.",
    "settings.planNameAndPrice": "{name} · {price}",
    "settings.planNamePausedLine": "{name} · paused",
    "settings.planPillActive": "Active",
    "settings.planPillPaused": "Paused",
    "settings.planAllowanceLine": "· {line}",
    "settings.planLineTexting": "Texting for your crew, bound by fair use",
    "settings.planLineCalling": "Calling included on every plan — it's never an add-on",
    "settings.planLineExtraTexts":
        "Extra texts bill under fair use, up to a cap you control",
    "settings.planLineSeats": "{seats} team members",
    "settings.planLineNumberOne": "1 phone number",
    "settings.planLineNumbers": "{numbers} phone numbers",
    "settings.planFairUse": "Allowances reflect fair use. See the policy",
    "settings.planPeriodEnds": "Current period ends {date}.",
    "settings.planSwitchToStarter": "Switch to Starter",
    "settings.planUpgradeToPro": "Upgrade to Pro",
    "settings.planManageInBrowser": "Manage your plan in the browser",

    "settings.pauseResuming": "Resuming…",
    "settings.pauseResumedOn": "You're back on {name}.",
    "settings.pauseResumedPlain": "Your plan is back on.",
    "settings.pauseOfferHeading": "Pause instead — the number stays, the texting stops",
    "settings.pauseOfferAction": "Pause for {price}/mo",
    "settings.pauseConfirmTitle": "Pause your plan?",
    "settings.pauseConfirmAction": "Pause my plan",

    "settings.changePlanUpgradeTitle": "Upgrade to Pro?",
    "settings.changePlanUpgradeBody":
        "The upgrade happens right away. You're charged the prorated difference for "
        + "the rest of this period, and your allowances go up immediately.",
    "settings.changePlanUpgradeAction": "Upgrade now",
    "settings.changePlanDowngradeTitle": "Switch to Starter?",
    "settings.changePlanDowngradeBody":
        "Starter is smaller, so your workspace has to fit it first.",
    "settings.changePlanDowngradeAction": "Schedule the switch",
    "settings.downgradeNumbersOkOne": "✓ 1 phone number. You're set.",
    "settings.downgradeNumbersOk": "✓ {numbers} phone numbers. You're set.",
    "settings.downgradeNumbersBlockedOne":
        "✗ Starter includes 1 phone number; you have {have}. Release under "
        + "Settings › Numbers first.",
    "settings.downgradeNumbersBlocked":
        "✗ Starter includes {numbers} phone numbers; you have {have}. Release under "
        + "Settings › Numbers first.",
    "settings.downgradeSeatsUnknown": "✗ Couldn't check your member count. Try again.",
    "settings.downgradeSeatsChecking": "Checking your member count…",
    "settings.downgradeSeatsOk": "✓ Up to {seats} members; you have {have}.",
    "settings.downgradeSeatsBlocked":
        "✗ Starter includes {seats} members; you have {have} active. Deactivate "
        + "{excess} under Settings › Team first.",
    "settings.downgradeTiming":
        "The change happens at the end of your current period. You keep Pro until "
        + "then, and nothing is refunded mid-period.",

    "settings.prepaidPaidUpFront": "Paid up front: {amount}",
    "settings.prepaidMonthsUsed": "Months used: {months} of 12",
    "settings.prepaidCredit": "Back on your account: {amount}",

    "settings.modulesTitle": "Add-ons",
    "settings.modulesIntro": "Optional extras billed with your plan.",
    "settings.moduleRow": "{name} · {price}/mo",
    "settings.moduleAddTitle": "Add {name}?",
    "settings.moduleAddBody":
        "{price}/mo is added to your plan. You're charged a prorated amount for the "
        + "rest of this period today, then the full price each month.",
    "settings.moduleAddAction": "Add it",
    "settings.moduleAdded": "{name} added.",
    "settings.moduleRemoveTitle": "Remove {name}?",
    "settings.moduleRemoveBody":
        "{name} comes off your plan now, with a prorated credit for the unused part "
        + "of this period on your next invoice.",
    "settings.moduleRemoveAction": "Remove it",
    "settings.moduleRemoved": "{name} removed.",

    "settings.missedWhileOffOne": "1 customer called while your number was off",
    "settings.missedWhileOff": "{count} customers called while your number was off",
    "settings.missedWhileOffNote": "They heard that the number isn't taking calls.",
    "settings.missedWhileOffNoteDated":
        "They heard that the number isn't taking calls. The most recent was {day}.",
    "settings.dayToday": "today",
    "settings.dayYesterday": "yesterday",
    "settings.dayOn": "on {date}",

    "settings.offRampTitle": "Tell your customers where you went",
    "settings.offRampIntro":
        "Anyone who texts your old number gets this back, once each. It stops when "
        + "the number goes back to the phone company. After that we can't answer it, "
        + "and texts to it reach whoever gets it next.",
    "settings.offRampIntroDated":
        "Anyone who texts your old number gets this back, once each. It stops on "
        + "{date}, when the number goes back to the phone company. After that we "
        + "can't answer it, and texts to it reach whoever gets it next.",
    "settings.offRampPlaceholder":
        "We've moved to (416) 555-0123 — call or text us there and we'll pick right up.",
    "settings.offRampEmpty": "Nothing is sent until you write something here.",
    "settings.offRampCount":
        "{count} of {max} characters. Your words, sent as they are.",
    "settings.offRampStart": "Start sending this",
    "settings.offRampTurnOff": "Turn off",
    "settings.offRampTurnedOff": "Turned off.",
    "settings.offRampSaved":
        "Saved. We'll send this once to each customer who texts you.",
    "settings.offRampSaveFailed": "Couldn't save that. Try again.",

    "settings.cancelTitle": "Cancel",
    "settings.cancelWhyAsk": "If you want to say why, it helps us fix it.",
    "settings.cancelWhyAskOptional":
        "Optional, and it changes nothing about cancelling.",
    "settings.cancelDetailLabel": "Anything you want to tell us (optional)",
    "settings.cancelExportIntro":
        "Every contact in this workspace as a CSV: names, numbers, tags and when "
        + "they opted in. AirDrop it, mail it, or save it to Files. Yours either way.",
    "settings.cancelExportAction": "Export contacts",
    "settings.cancelExporting": "Exporting…",
    "settings.cancelHandoffNote":
        "Nothing above has to be filled in. This takes you to the secure Stripe "
        + "portal either way, where you finish cancelling. It opens in your browser.",
]

private let settingsBillingFr: [String: String] = [
    "settings.billingTitle": "Facturation",
    "settings.billingReadOnly":
        "Seuls les propriétaires et les administrateurs peuvent modifier la facturation.",
    "settings.billingOpening": "Ouverture…",
    "settings.billingPortalTitle": "Paiement et factures",
    "settings.billingPortalIntro":
        "Les cartes, les reçus et les coordonnées de facturation se trouvent dans le "
        + "portail sécurisé de Stripe. Il s'ouvre dans votre navigateur.",
    "settings.billingPortalAction": "Gérer le paiement et les factures",

    "settings.noticePastDue":
        "Votre dernier paiement n'a pas été accepté. Mettez votre mode de paiement à "
        + "jour pour continuer à envoyer des textos.",
    "settings.noticeUnpaid":
        "L'envoi est suspendu tant que votre mode de paiement n'est pas mis à jour.",
    "settings.noticeUpdatePayment": "Mettre le mode de paiement à jour",
    "settings.noticeCancelling":
        "Votre forfait doit être annulé à la fin de cette période. Les textos "
        + "s'arrêtent alors. Votre numéro est conservé {days} jours à compter du jour "
        + "de l'annulation — et non de cette date — il peut donc être libéré peu "
        + "après. Vous pouvez annuler cette décision depuis le portail de paiement.",
    "settings.noticeCancellingOn":
        "Votre forfait doit être annulé le {date}. Les textos s'arrêtent alors. Votre "
        + "numéro est conservé {days} jours à compter du jour de l'annulation — et non "
        + "de cette date — il peut donc être libéré peu après. Vous pouvez annuler "
        + "cette décision depuis le portail de paiement.",
    "settings.noticeKeepMyPlan": "Garder mon forfait",

    "settings.subscriptionTitle": "Abonnement",
    "settings.subscriptionCanceled": "Votre abonnement est annulé.",
    "settings.resubscribe": "Se réabonner",
    "settings.winbackNoThanks": "Non merci",
    "settings.winbackDismissFailed":
        "Impossible d'enregistrer — ceci pourrait réapparaître.",
    "settings.holdRule":
        "Nous conservons votre numéro {days} jours à compter du jour de l'annulation. "
        + "Réabonnez-vous avant la fin de ce délai et tout reprend là où vous l'avez "
        + "laissé.",
    "settings.holdUntil":
        "Nous conservons votre numéro jusqu'au {date}. Réabonnez-vous avant cette "
        + "date et tout reprend là où vous l'avez laissé.",
    "settings.holdEndedOn":
        "La conservation de {days} jours de votre numéro a pris fin le {date}. Nous "
        + "ne pouvons plus vous le promettre — une fois qu'il retourne à la compagnie "
        + "de téléphone, vous réabonner vous donne un nouveau numéro. Votre historique "
        + "de textos reste là dans tous les cas.",

    "settings.planTitle": "Forfait",
    "settings.planNone":
        "Aucun forfait pour l'instant. Terminez la configuration sur le Web pour en "
        + "choisir un et obtenir votre numéro.",
    "settings.planNameAndPrice": "{name} · {price}",
    "settings.planNamePausedLine": "{name} · en pause",
    "settings.planPillActive": "Actif",
    "settings.planPillPaused": "En pause",
    "settings.planAllowanceLine": "· {line}",
    "settings.planLineTexting":
        "Les textos pour votre équipe, dans les limites de l'usage raisonnable",
    "settings.planLineCalling":
        "Les appels inclus dans chaque forfait — jamais une option",
    "settings.planLineExtraTexts":
        "Les textos supplémentaires sont facturés selon l'usage raisonnable, jusqu'à "
        + "un plafond que vous fixez",
    "settings.planLineSeats": "{seats} membres d'équipe",
    "settings.planLineNumberOne": "1 numéro de téléphone",
    "settings.planLineNumbers": "{numbers} numéros de téléphone",
    "settings.planFairUse":
        "Les allocations respectent l'usage raisonnable. Voir la politique",
    "settings.planPeriodEnds": "La période en cours se termine le {date}.",
    "settings.planSwitchToStarter": "Passer à Starter",
    "settings.planUpgradeToPro": "Passer à Pro",
    "settings.planManageInBrowser": "Gérer votre forfait dans le navigateur",

    "settings.pauseResuming": "Reprise…",
    "settings.pauseResumedOn": "Vous êtes de retour sur {name}.",
    "settings.pauseResumedPlain": "Votre forfait est réactivé.",
    "settings.pauseOfferHeading":
        "Mettre en pause plutôt — le numéro reste, les textos s'arrêtent",
    "settings.pauseOfferAction": "Mettre en pause pour {price}/mois",
    "settings.pauseConfirmTitle": "Mettre votre forfait en pause ?",
    "settings.pauseConfirmAction": "Mettre mon forfait en pause",

    "settings.changePlanUpgradeTitle": "Passer à Pro ?",
    "settings.changePlanUpgradeBody":
        "La mise à niveau se fait immédiatement. Vous êtes facturé la différence au "
        + "prorata pour le reste de cette période, et vos allocations augmentent tout "
        + "de suite.",
    "settings.changePlanUpgradeAction": "Passer à Pro maintenant",
    "settings.changePlanDowngradeTitle": "Passer à Starter ?",
    "settings.changePlanDowngradeBody":
        "Starter est plus petit : votre espace de travail doit d'abord y entrer.",
    "settings.changePlanDowngradeAction": "Planifier le changement",
    "settings.downgradeNumbersOkOne": "✓ 1 numéro de téléphone. Tout est bon.",
    "settings.downgradeNumbersOk": "✓ {numbers} numéros de téléphone. Tout est bon.",
    "settings.downgradeNumbersBlockedOne":
        "✗ Starter comprend 1 numéro de téléphone ; vous en avez {have}. "
        + "Libérez-en d'abord sous Paramètres › Numéros.",
    "settings.downgradeNumbersBlocked":
        "✗ Starter comprend {numbers} numéros de téléphone ; vous en avez {have}. "
        + "Libérez-en d'abord sous Paramètres › Numéros.",
    "settings.downgradeSeatsUnknown":
        "✗ Impossible de vérifier votre nombre de membres. Réessayez.",
    "settings.downgradeSeatsChecking": "Vérification de votre nombre de membres…",
    "settings.downgradeSeatsOk": "✓ Jusqu'à {seats} membres ; vous en avez {have}.",
    "settings.downgradeSeatsBlocked":
        "✗ Starter comprend {seats} membres ; vous en avez {have} actifs. "
        + "Désactivez-en {excess} sous Paramètres › Équipe d'abord.",
    "settings.downgradeTiming":
        "Le changement prend effet à la fin de votre période en cours. Vous gardez "
        + "Pro jusque-là, et rien n'est remboursé en cours de période.",

    "settings.prepaidPaidUpFront": "Payé d'avance : {amount}",
    "settings.prepaidMonthsUsed": "Mois utilisés : {months} sur 12",
    "settings.prepaidCredit": "Remis à votre compte : {amount}",

    "settings.modulesTitle": "Options",
    "settings.modulesIntro": "Extras facultatifs facturés avec votre forfait.",
    "settings.moduleRow": "{name} · {price}/mois",
    "settings.moduleAddTitle": "Ajouter {name} ?",
    "settings.moduleAddBody":
        "{price}/mois s'ajoute à votre forfait. Vous êtes facturé aujourd'hui un "
        + "montant au prorata pour le reste de cette période, puis le plein prix chaque "
        + "mois.",
    "settings.moduleAddAction": "L'ajouter",
    "settings.moduleAdded": "{name} ajouté.",
    "settings.moduleRemoveTitle": "Retirer {name} ?",
    "settings.moduleRemoveBody":
        "{name} est retiré de votre forfait dès maintenant, avec un crédit au prorata "
        + "pour la partie inutilisée de cette période sur votre prochaine facture.",
    "settings.moduleRemoveAction": "Le retirer",
    "settings.moduleRemoved": "{name} retiré.",

    "settings.missedWhileOffOne":
        "1 client a appelé pendant que votre numéro était hors service",
    "settings.missedWhileOff":
        "{count} clients ont appelé pendant que votre numéro était hors service",
    "settings.missedWhileOffNote":
        "Ils ont entendu que le numéro ne prend pas les appels.",
    "settings.missedWhileOffNoteDated":
        "Ils ont entendu que le numéro ne prend pas les appels. Le plus récent "
        + "remonte à {day}.",
    "settings.dayToday": "aujourd'hui",
    "settings.dayYesterday": "hier",
    "settings.dayOn": "le {date}",

    "settings.offRampTitle": "Dites à vos clients où vous êtes allé",
    "settings.offRampIntro":
        "Quiconque écrit à votre ancien numéro reçoit ceci en retour, une seule fois "
        + "chacun. Cela s'arrête quand le numéro retourne à la compagnie de téléphone. "
        + "Après quoi nous ne pouvons plus y répondre, et les textos qui y sont envoyés "
        + "aboutissent chez la personne qui l'obtiendra ensuite.",
    "settings.offRampIntroDated":
        "Quiconque écrit à votre ancien numéro reçoit ceci en retour, une seule fois "
        + "chacun. Cela s'arrête le {date}, quand le numéro retourne à la compagnie de "
        + "téléphone. Après quoi nous ne pouvons plus y répondre, et les textos qui y "
        + "sont envoyés aboutissent chez la personne qui l'obtiendra ensuite.",
    "settings.offRampPlaceholder":
        "Nous avons déménagé au (416) 555-0123 — appelez-nous ou écrivez-nous là et "
        + "nous répondrons tout de suite.",
    "settings.offRampEmpty": "Rien n'est envoyé tant que vous n'écrivez rien ici.",
    "settings.offRampCount":
        "{count} caractères sur {max}. Vos mots, envoyés tels quels.",
    "settings.offRampStart": "Commencer à envoyer ceci",
    "settings.offRampTurnOff": "Désactiver",
    "settings.offRampTurnedOff": "Désactivé.",
    "settings.offRampSaved":
        "Enregistré. Nous l'enverrons une fois à chaque client qui vous écrit.",
    "settings.offRampSaveFailed": "Impossible d'enregistrer. Réessayez.",

    "settings.cancelTitle": "Annuler",
    "settings.cancelWhyAsk":
        "Si vous voulez nous dire pourquoi, cela nous aide à corriger le tir.",
    "settings.cancelWhyAskOptional":
        "Facultatif, et cela ne change rien à l'annulation.",
    "settings.cancelDetailLabel": "Ce que vous voulez nous dire (facultatif)",
    "settings.cancelExportIntro":
        "Tous les clients de cet espace de travail dans un fichier CSV : noms, "
        + "numéros, étiquettes et date de consentement. Envoyez-le par AirDrop ou par "
        + "courriel, ou enregistrez-le dans Fichiers. Il est à vous dans tous les cas.",
    "settings.cancelExportAction": "Exporter les clients",
    "settings.cancelExporting": "Exportation…",
    "settings.cancelHandoffNote":
        "Rien de ce qui précède n'est obligatoire. Ceci vous amène de toute façon au "
        + "portail sécurisé de Stripe, où vous terminez l'annulation. Il s'ouvre dans "
        + "votre navigateur.",
]
