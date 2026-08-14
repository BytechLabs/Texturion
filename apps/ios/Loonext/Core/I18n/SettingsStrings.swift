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
/// ## `SettingsLogic.swift` IS here now, and how
///
/// This paragraph used to say the opposite — that copy living outside a view
/// could not reach a locale and stayed put. It can, and the shape is the one
/// Android settled on: every function that composes a sentence takes
/// `locale: String? = nil` and looks the sentence up, so a screen hands it
/// `appLocale` and everything else keeps reading English.
///
/// The DEFAULT is what makes that safe rather than a rewrite. `SettingsLogicTests`,
/// `BillingPauseTests`, `HeldNumbersTests`, `RegistrationPauseTests`,
/// `OwnershipCopyTests`, `DevicesLogicTests` and `ParityVectorsTests` all call
/// those functions with no reader in scope and assert the PRODUCT's wording
/// against `packages/shared` and the other two clients. They still do, and they
/// still pass, because nil resolves to this file's English table.
///
/// ## What is still deliberately NOT here
///
///   `defaultVoicemailGreeting`      `inbound-ring.ts` SPEAKS this to a caller
///                                   and takes no locale, so a French preview
///                                   would show words no caller ever hears.
///                                   Extract it the day the server learns the
///                                   language.
///   `holdSentence`                  the three hold sentences on the billing
///   (BillingSection.swift)          screen, and the "Continue to cancel" label
///   the cancel exit label           beside them. Both are ANCHORS for guards
///                                   that read that file's own literals —
///                                   `SettingsLogicTests` counts every
///                                   "{days} days" on the screen and
///                                   `CancelOneActionTests` derives its whole
///                                   one-press property from finding the exit's
///                                   English. The keys exist below in both
///                                   languages; finishing this is a change to
///                                   those two test files.
///   the `HelpSection.swift` mirrors `supportTopics`, `supportFixPromise` and
///                                   `supportResponseTime` — a parity test pins
///                                   each against another client, and
///                                   `settings.offerMissingBody` interpolates
///                                   them rather than forking them.
///   `emergencySafetyLine`,          each pinned word for word elsewhere.
///   `ContactFields.Copy`
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
    settingsCoreEn,
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
    settingsCoreFr,
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

// ---------------------------------------------------------------------------
// Settings → the core screens (#228): workspace, calling, usage, billing, and
// every sentence the pure logic in SettingsLogic.swift composes
// ---------------------------------------------------------------------------

/// The words the five settings-core files say, in both languages.
///
/// ## Why one block rather than one per surface
///
/// The rest of this file is split per card, and this is not. It is the output of
/// ONE extraction pass over five source files — Workspace, Calling, Usage,
/// Billing and the pure logic under them — run alongside five other agents in
/// the same tree. A single insertion point is one merge conflict instead of
/// fifteen, and the keys are sorted so the block stays navigable. It can be cut
/// into per-surface maps once #228 is finished and nobody else is editing here.
///
/// ## Where these came from, and why the key names look borrowed
///
/// They are borrowed, deliberately. Roughly two thirds of these keys and their
/// French are Android's `SettingsStrings.kt` / `SettingsMoreStrings.kt` verbatim,
/// and most of the rest are `apps/web/src/i18n/sections/`. The same sentence has
/// to reach the same key on every client or the cross-client comparisons stop
/// meaning anything — so where a twin existed, its NAME and its FRENCH were
/// copied character for character rather than written again.
///
/// That is also why `settingsMore.*` and `misc.*` keys are defined in this file:
/// the key name belongs to the sentence, not to the file it happens to sit in.
/// `AppStringsTests` checks that no two sections claim the same key, which is
/// the property that actually matters.
///
/// ## Three keys hold iOS's English rather than Android's, and each is pinned
///
///   `settings.cancelConsequence`     iOS says "nothing changes until the end of
///   `settings.cancelOwnerOnly`       your billing period" where Android says
///                                    the plan "runs to" it. #524 rewrote this
///                                    pair so it is true for a PAUSED workspace
///                                    as well — see the docblock on
///                                    `CancelCard.consequence`.
///   `settings.enableUsStartedPaused` must OPEN with the whole unpaused receipt
///                                    and then add to it; `RegistrationPauseTests`
///                                    asserts exactly that, so the news is never
///                                    traded away for the caveat. Android's twin
///                                    rewrites the middle of the sentence.
///
/// ## The English here is the English that shipped
///
/// Most of these sentences are asserted word for word by `SettingsLogicTests`,
/// `BillingPauseTests`, `HeldNumbersTests`, `RegistrationPauseTests` and
/// `ParityVectorsTests`, which call the logic functions with no locale and read
/// the English table. Editing an English value below is editing what those
/// guards compare against `packages/shared` — do it on purpose or not at all.
private let settingsCoreEn: [String: String] = [
    "misc.ownershipDetailAcceptOffer":
        "Accepting makes you responsible for billing, the spending cap and "
            + "your numbers; the current owner stays on the team as an admin. "
            + "Everyone is told either way. The offer expires {when}.",
    "misc.ownershipDetailBackupStanding":
        "If the owner ever can't get in — they leave, they lose access to "
            + "their email, or worse — you're the one person who can ask to take "
            + "over. They get a week to say no, and everyone on the team is "
            + "told. Nothing changes until you ask.",
    "misc.ownershipDetailClaimWaiting":
        "The owner has been emailed and can stop this until {when}. If "
            + "nobody stops it, you can complete the takeover after that.",
    "misc.ownershipDetailCompleteClaim":
        "The waiting period is over and nobody stopped it. Completing this "
            + "makes you the owner — billing, the spending cap and your numbers "
            + "— and puts the previous owner on the team as an admin.",
    "settings.awayEmergencyNotMentioned":
        "Nobody has been told they can. Mention it in your away message if "
            + "you want customers to know.",
    "settings.awayEmergencyOff":
        "Your away message tells customers to reply for an emergency, but "
            + "nothing will treat that reply as one. Turn this back on, or take "
            + "the offer out of the message.",
    "settings.awayEmergencyUnknownWord":
        "Your away message tells customers to reply {word}, which nothing "
            + "watches for. Use {words} instead, add {word} to your emergency "
            + "words, or take the offer out of the message.",
    "settings.cancelConsequence":
        "Cancel anytime. Nothing changes until the end of your billing "
            + "period — if your texting is on, it stays on until then. Your "
            + "number is held for {days} days from the day you cancel — not from "
            + "the day your plan ends — so it can go back to the phone company "
            + "soon after. After that it is released for good.",
    "settings.cancelExitAction": "Continue to cancel",
    "settings.cancelExportHeading": "Take your contacts with you",
    "settings.cancelNotInPortal":
        "The payment portal above is for cards and invoices and has no "
            + "cancellation on it, so this is not something to go looking for "
            + "there.",
    "settings.cancelOwnerOnly":
        "Only the owner can cancel this plan. When they do, nothing "
            + "changes until the end of the billing period — if your texting is "
            + "on, it stays on until then. The number is held for {days} days "
            + "from the day they cancel — not from the day the plan ends — so it "
            + "can go back to the phone company soon after. After that it is "
            + "released for good.",
    "settings.cancelReasonMissingFeature": "Missing something I need",
    "settings.cancelReasonNotUsing": "Not using it",
    "settings.cancelReasonOther": "Something else",
    "settings.cancelReasonSeasonal": "Quiet season, I'll be back",
    "settings.cancelReasonSwitched": "Going with something else",
    "settings.cancelReasonTooExpensive": "Too expensive",
    "settings.capConfirmTitle": "Set the cap to {cap}?",
    "settings.capLowered":
        "Sending pauses at {next} messages this period. If you're already "
            + "past that, sends pause right away.",
    "settings.capRaised":
        "Sending pauses at {next} messages this period instead of "
            + "{current}.",
    "settings.capRaisedToCeiling":
        "Sending pauses at {next} messages this period instead of "
            + "{current}. That's the highest the cap goes. Every message over "
            + "your {included} included is billed at the overage rate until "
            + "sending pauses.",
    "settings.changePlanBackCountMany": "You're on Pro now, and {count} numbers are back.",
    "settings.changePlanBackCountOne": "You're on Pro now, and {count} number is back.",
    "settings.changePlanBackOne": "You're on Pro now, and {subject} is back.",
    "settings.changePlanOnPro": "You're on Pro now.",
    "settings.changePlanScheduled":
        "Switch to Starter scheduled for the end of this period.",
    "settings.deviceAndroid": "Android app",
    "settings.deviceCountMany": "{count} devices",
    "settings.deviceCountOne": "1 device",
    "settings.deviceIos": "iPhone or iPad",
    "settings.deviceUnknown": "Unrecognised device",
    "settings.deviceWeb": "Web browser",
    "settings.enableUsButton": "Enable US texting: {fee} one-time",
    "settings.enableUsReadOnly":
        "Ask your account owner to enable US texting; it's a one-time "
            + "{fee} carrier registration.",
    "settings.enableUsStarted":
        "US registration started. We'll email you when it's approved.",
    "settings.enableUsStartedPaused":
        "US registration started. We'll email you when it's approved; US "
            + "texts go out when you resume.",
    "settings.handoverPromptAsked": "You have asked to take over this workspace.",
    "settings.handoverPromptBackup": "You are the backup owner.",
    "settings.handoverPromptOffered": "You have been offered ownership of this workspace.",
    "settings.handoverPromptReady": "Your request to take over is ready to complete.",
    "settings.handoverWithdraw": "Withdraw my request",
    "settings.heldKept":
        "A number on hold hasn't been given up. We're still holding it, "
            + "texts and calls still reach it, and nothing in its history has "
            + "been touched — you just can't send or answer from it while it's "
            + "on hold.",
    "settings.heldLead":
        "Your plan covers {allowance} numbers, and you have more than that.",
    "settings.heldLeadOne": "Your plan covers 1 number, and you have more than that.",
    "settings.heldNoteLead": "This number is on hold.",
    "settings.heldRouteAlsoPro":
        "Or move to Pro from the plan card above: that brings back "
            + "everything that fits, with no extra number to buy.",
    "settings.heldRouteFull":
        "Starter tops out at {max} numbers, so there's no extra to buy "
            + "here. Move to Pro from the plan card above and everything that "
            + "fits comes back.",
    "settings.heldRouteHelpMany": "Get in touch and we'll bring them back.",
    "settings.heldRouteHelpOne": "Get in touch and we'll bring it back.",
    "settings.heldRoutePro":
        "Move to Pro from the plan card above and everything that fits "
            + "comes back.",
    "settings.heldRouteResumeMany":
        "Your plan is paused, so nothing can be added to it yet. Resume it "
            + "from the plan card above, then you can bring them back.",
    "settings.heldRouteResumeOne":
        "Your plan is paused, so nothing can be added to it yet. Resume it "
            + "from the plan card above, then you can bring it back.",
    "settings.heldTailFacts":
        "Texts and calls still reach it, but you can't send or answer from "
            + "it.",
    "settings.heldTailWhereMember": "Your account owner can bring it back from Billing.",
    "settings.heldTailWhereOwner": "Settings › Billing says why, and how to bring it back.",
    "settings.heldTitleMany": "{count} of your numbers are on hold",
    "settings.heldTitleOne": "One of your numbers is on hold",
    "settings.keywordAlphanumeric":
        "Letters and numbers only. Punctuation is stripped from what "
            + "customers send.",
    "settings.keywordCarrierOwned":
        "{word} is answered by the phone carrier before it reaches us, so "
            + "it can't be an emergency word.",
    "settings.keywordEmpty": "Type a word first.",
    "settings.keywordOneWord":
        "One word only — customers text a single word, so a phrase would "
            + "never match.",
    "settings.keywordTooLong": "Too long — 15 characters at most.",
    "settings.keywordTooShort": "Too short — use at least 2 characters.",
    "settings.numberAreaCodeEmpty":
        "Area code {code} is out of new numbers right now. Choose another "
            + "number to finish setup.",
    "settings.numberSetupFailed":
        "We couldn't finish setting up your number. Choose a number to try "
            + "again.",
    "settings.numberSetupSlow":
        "We're still setting up your number. This is taking a little "
            + "longer than usual.",
    "settings.numberSetupStalled":
        "Setup is taking longer than expected. Choose a number to finish — "
            + "you won't be charged again.",
    "settings.offerComeBackOnStarter": "Come back on Starter",
    "settings.offerGetHelp": "Get help",
    "settings.offerMissingBody":
        "If the thing you needed is not here, the fastest way to change "
            + "that is to tell us what it was. We answer {when}. {promise}",
    "settings.offerMissingHeading": "Tell us what was missing",
    "settings.offerPausedSeasonalBody":
        "Your number and your whole message history are held for as long "
            + "as you stay paused — nothing expires while your plan is paused, "
            + "and there is no date you have to be back by. Cancelling instead "
            + "ends the pause and starts a clock: {days} days from the day you "
            + "cancel, not from the end of your billing period, and at the end "
            + "of it the number goes back to the phone company.",
    "settings.offerPausedSeasonalHeading":
        "Your plan is already paused, and that hold has no deadline",
    "settings.offerRegistrationFeePaid":
        " You have already paid the one-time registration fee, and it is "
            + "charged at most once per workspace, ever — coming back does not "
            + "charge it again.",
    "settings.offerSeasonalBody":
        "It keeps receiving texts the whole time, so nothing a customer "
            + "sends is lost — you cannot reply until you are back, and your "
            + "message history stays put. The {days} days run from the day you "
            + "cancel, not from the end of your billing period, so a quiet "
            + "season longer than that outruns the hold and the number goes back "
            + "to the phone company.",
    "settings.offerSeasonalGraceBody":
        "It is still receiving texts, so nothing a customer sends is lost, "
            + "though you cannot reply until you are back. That date is {days} "
            + "days from the day you cancelled, not from the end of your last "
            + "billing period. Resubscribe before then and the number and your "
            + "whole message history come back with you.",
    "settings.offerSeasonalGraceHeading": "Your number is still yours until the date below",
    "settings.offerSeasonalHeading":
        "Your number is held for {days} days from the day you cancel",
    "settings.offerStarterCovers":
        "It covers {seats} people and {numbers} business numbers.",
    "settings.offerStarterCoversOne":
        "It covers {seats} people and {numbers} business number.",
    "settings.offerStarterHeading":
        "Starter is the same product, priced for a smaller crew",
    "settings.offerStarterHeadingGrace": "There is a smaller plan to come back on",
    "settings.offerStarterPrice":
        "Starter is {starter} a month instead of {pro}, with smaller "
            + "texting and calling allowances under the same fair-use policy.",
    "settings.offerStarterTail":
        "The switch takes effect at the end of your current billing "
            + "period. Your message history comes with you, and so does the "
            + "number you text from — a second number does not: the downgrade is "
            + "refused until you release it, and until the crew is back inside "
            + "{seats} seats.",
    "settings.offerStarterTailGrace":
        "Come back on Starter and your number and your whole message "
            + "history come with you.",
    "settings.offerStarterTailPaused":
        "Your plan is paused, so this takes two steps in this order: "
            + "resume first, then switch plans. The switch takes effect at the "
            + "end of your current billing period. Your message history comes "
            + "with you, and so does the number you text from — a second number "
            + "does not: the downgrade is refused until you release it, and "
            + "until the crew is back inside {seats} seats.",
    "settings.pauseComeBack": "Come back whenever the work does.",
    "settings.pauseComeBackOn": "Come back on {plan} whenever the work does.",
    "settings.pauseConfirmMessage":
        "You'll be billed {price} a month instead of your plan, starting "
            + "now. Texting and calling stop straight away. Your number, your "
            + "message history and anything you have scheduled stay exactly "
            + "where they are, and texts your customers send keep arriving. "
            + "There is no deadline on any of it — resume whenever you like.",
    "settings.pauseOfferBody":
        "{price} a month holds your number and your whole message history "
            + "for as long as the quiet lasts. There is no {days}-day clock on a "
            + "pause and nothing goes back to the phone company. Texting and "
            + "calling stop; texts your customers send still arrive and are "
            + "waiting for you, and anything you scheduled is held rather than "
            + "cancelled.",
    "settings.pauseResume": "Resume",
    "settings.pauseResumeNamed": "Resume {plan}",
    "settings.pausedConfirmPlain": "Paused. Texting is off until you resume.",
    "settings.pausedConfirmPriced":
        "Paused. You're billed {price} a month until you resume.",
    "settings.pausedLineArriving":
        "Texts your customers send still arrive, and anything you "
            + "scheduled is held until you resume — nothing is lost.",
    "settings.pausedLineNoDeadline":
        "Your number and your whole message history stay exactly where "
            + "they are, with no deadline on them.",
    "settings.pausedLineOff": "Texting and calling are off.",
    "settings.pausedLinePrice": "You're billed {price} a month while this is paused.",
    "settings.planCheckFailed":
        "We couldn't check whether this plan is paused, so anything that "
            + "depends on the answer — the price, the status and the plan switch "
            + "— is left out rather than guessed. Nothing about your plan has "
            + "changed.",
    "settings.planChecking": "Checking whether this plan is paused…",
    "settings.portedHoldLead": "The transfer finished — it's the line that's on hold.",
    "settings.prepaidConsentCredited": "End my prepaid year and credit me {credit}",
    "settings.prepaidConsentPlain": "End my prepaid year",
    "settings.prepaidEndsCredited":
        "Switching ends the prepaid year and puts {credit} back on your "
            + "account as credit, which comes off your next invoices. You then "
            + "pay the normal {plan} monthly price.",
    "settings.prepaidEndsPlain":
        "Switching ends the prepaid year. You then pay the normal {plan} "
            + "monthly price.",
    "settings.prepaidHeading": "You have a prepaid {plan} year running.",
    "settings.provisionWaitLong":
        "Your number is taking a little longer than usual. We're still on "
            + "it, you don't have to wait here.",
    "settings.provisionWaitMedium":
        "Still setting up your number, this is taking a little longer than "
            + "usual. Hang tight.",
    "settings.provisionWaitShort":
        "We're setting up your number. This usually takes under a minute.",
    "settings.reinstateAction": "Bring it back",
    "settings.reinstateAlready": "{number} was already back.",
    "settings.reinstateBody":
        "{price} is added to your plan. You're charged a prorated amount "
            + "for the rest of this period today, then the full price each "
            + "month. The number can send and answer again as soon as it goes "
            + "through.",
    "settings.reinstateDone": "{number} is back. You can send and answer from it again.",
    "settings.reinstateStuck":
        "Your plan covers {number} now, and the charge went through — but "
            + "it hasn't come back yet. Get in touch and we'll finish it; you "
            + "won't be charged again.",
    "settings.reinstateTitle": "Bring back {number}?",
    "settings.releaseBodyHeld":
        "This gives the number up for good. It's on hold, not gone — texts "
            + "and calls still reach it, and releasing ends that too. You can't "
            + "get the same number back, and bringing it back from Settings › "
            + "Billing stops being an option. Type the number to confirm.",
    "settings.releaseBodyPlain":
        "This gives the number up for good. Customers who text it won't "
            + "reach you, and you can't get the same number back. It doesn't "
            + "change your plan or what you pay — a number is included, so you "
            + "can set up a new one here afterward. Type the number to confirm.",
    "settings.textBackDefault":
        "Sorry we missed your call! This is {business_name}. Reply here "
            + "with your address and what you need, and we'll get you booked in.",
    "settings.wordListNothing": "nothing",
    "settings.wordListOr": " or ",
    "settingsMore.addressLabel": "Address",
    "settingsMore.aiNearLimit": "Close to this month's limit. It resets on the 1st.",
    "settingsMore.aiNoOutcomes": "Nothing recorded yet about whether these got used.",
    "settingsMore.askMeToConfirm": "Ask me to confirm",
    "settingsMore.askMeToConfirmSupporting":
        "Only when you start the conversation. Replying to a customer who "
            + "texted or called you is never interrupted.",
    "settingsMore.atCapBody":
        "You've reached the spending cap you set. Sending and calling are "
            + "paused until you raise the cap. Nothing bills past it.",
    "settingsMore.atCapTitle": "At your spending cap",
    "settingsMore.automatedLanguageDesc":
        "The language we write in when we text a customer for you: the "
            + "after-hours away reply, the missed-call text-back, the emergency "
            + "acknowledgment, and the rating ask after a job.",
    "settingsMore.automatedLanguageNotApp":
        "This does not change the app itself, and it never rewrites words "
            + "somebody typed. An away message you wrote is sent exactly as you "
            + "wrote it, in the language you wrote it in.",
    "settingsMore.automatedLanguagePerContact":
        "One customer who should hear from you in the other language can "
            + "be set on their own contact.",
    "settingsMore.automatedLanguageTitle": "Language for automated texts",
    "settingsMore.businessIdCard": "Business identification",
    "settingsMore.businessIdCardDesc":
        "What carriers have on file for your business. It comes from your "
            + "texting registration.",
    "settingsMore.businessIdLoading": "Loading…",
    "settingsMore.callingMinutes": "Calling minutes",
    "settingsMore.capMax": "{cap} max",
    "settingsMore.capReadOnly":
        "Spending cap: {cap} your included usage. Only the account owner "
            + "can change it.",
    "settingsMore.capSetTo": "Spending cap set to {cap}.",
    "settingsMore.changeRegistrationUnderNumbers":
        "Need to change something? Manage registration under Numbers.",
    "settingsMore.changeTimezone": "Change timezone",
    "settingsMore.commaRange": ", {range}",
    "settingsMore.contactLabel": "Contact",
    "settingsMore.countryCa": "Canada",
    "settingsMore.countryElsewhere": "Elsewhere",
    "settingsMore.countryUs": "United States",
    "settingsMore.deliveryByCountry": "{country}: {figure}",
    "settingsMore.deliveryCounts": "{delivered} of {total}",
    "settingsMore.deliveryDelivered": "{count} confirmed delivered",
    "settingsMore.deliveryDesc":
        "Carrier-reported delivery this period. A carrier confirming it "
            + "took the message is not the same as someone reading it, so this "
            + "is the most we can honestly tell you.",
    "settingsMore.deliveryFailed": " · {count} didn't get through",
    "settingsMore.deliveryFailureNote":
        "A text that doesn't get through is usually a disconnected number "
            + "or a handset that has been off for days. Open the conversation "
            + "and the message itself says what the carrier reported.",
    "settingsMore.deliveryNothingBounced": "Nothing has bounced this period.",
    "settingsMore.deliveryPending": " · {count} still on their way",
    "settingsMore.deliveryPercent": "{percent}%",
    "settingsMore.deliveryTitle": "Are your texts arriving?",
    "settingsMore.details": "Details",
    "settingsMore.detailsBlurb": "The raw numbers, month by month, if you want them.",
    "settingsMore.extraNumberCountry":
        "Extra numbers are available for US and Canadian workspaces.",
    "settingsMore.extraNumberCurrency":
        "Extra numbers are priced in US dollars and can't be added to a "
            + "subscription billed in another currency yet. Contact support and "
            + "we'll sort it out.",
    "settingsMore.extraNumberUsTexting":
        "An extra number needs US texting turned on for your workspace "
            + "first.",
    "settingsMore.headsUp": "Heads up",
    "settingsMore.hideNumbers": "Hide the numbers",
    "settingsMore.howCounted": "How messages are counted",
    "settingsMore.howCountedLine":
        "A text up to 160 characters counts as one message; longer texts "
            + "split into 160-character segments (70 with emoji or accents). A "
            + "photo message counts as three. Incoming messages are always free.",
    "settingsMore.languageUpdated": "Language updated.",
    "settingsMore.lastSixMonths": "Last 6 months",
    "settingsMore.lastSixMonthsLine": "Outbound messages by calendar month.",
    "settingsMore.legalName": "Legal name",
    "settingsMore.localTimeNow": "It's {time} in {zone} right now.",
    "settingsMore.louThisMonth": "Lou this month",
    "settingsMore.louThisMonthLine":
        "What Lou has drafted, filled in, and written down. Each resets on "
            + "the 1st.",
    "settingsMore.messages": "Messages",
    "settingsMore.messagesInbound":
        "{count} messages received this period. Inbound is always free.",
    "settingsMore.messagesNoOverage": "No overage this period. $0.00 extra so far.",
    "settingsMore.messagesOverage":
        "{over} over your included amount: {amount} in overage on your "
            + "next invoice.",
    "settingsMore.messagesPauseAt": "Sending pauses at {count} messages",
    "settingsMore.messagesPauseMax":
        ", the maximum, which is 10 times your included messages.",
    "settingsMore.messagesThisPeriod": "messages this period",
    "settingsMore.messagesUsed": "{used} of {included} included messages used{range}.",
    "settingsMore.minutesBilled":
        "Past your included minutes, extra minutes bill at 1¢ each. "
            + "Calling pauses at your spending cap, never mid-call.",
    "settingsMore.minutesNotBilled": "Extra minutes aren't billed on your plan.",
    "settingsMore.minutesOverage":
        "{extra} extra minutes so far: {amount} on your next invoice.",
    "settingsMore.minutesUsed": "{used} of {included} included minutes used.",
    "settingsMore.nameLength200": "1 to 200 characters.",
    "settingsMore.nearCapBody":
        "You've used {percent}% of the spending cap you set. At the cap, "
            + "sending and calling pause until you raise it. Nothing bills past "
            + "it.",
    "settingsMore.nearCapTitle": "Approaching your spending cap",
    "settingsMore.nightTextAutomatedNote":
        "This does not change automated texts. Reminders and anything else "
            + "we send on your behalf still wait for the customer's morning, "
            + "whatever this is set to.",
    "settingsMore.nightTextDesc":
        "Starting a brand-new conversation between 8pm and 8am the "
            + "customer's time asks you to confirm first.",
    "settingsMore.nightTextTitle": "Texting a new customer at night",
    "settingsMore.noRegistrationNeeded":
        "No registration needed. Canadian texting works without one. "
            + "Enabling US texting adds it.",
    "settingsMore.noRegistrationYet":
        "No registration details on file yet. Manage registration under "
            + "Numbers.",
    "settingsMore.noTimezoneMatch": "No timezone matches \"{query}\".",
    "settingsMore.off": "Off",
    "settingsMore.oneTimesIncluded": "1x included",
    "settingsMore.onlyAdminsLanguage": "Only owners and admins can change the language.",
    "settingsMore.onlyAdminsRename": "Only owners and admins can rename the workspace.",
    "settingsMore.onlyAdminsSigning":
        "Only owners and admins can change how texts are signed.",
    "settingsMore.onlyAdminsThis": "Only owners and admins can change this.",
    "settingsMore.onlyAdminsTimezone": "Only owners and admins can change the timezone.",
    "settingsMore.ownershipAskedToTakeOver":
        "{name} has asked to take over this workspace.",
    "settingsMore.ownershipCompletesAt":
        "This completes {when} unless the owner stops it. Stopping it "
            + "takes effect immediately.",
    "settingsMore.ownershipDecline": "Decline",
    "settingsMore.ownershipOfferExpires":
        "Nothing changes until they accept. The offer expires {when}.",
    "settingsMore.ownershipOffered": "Ownership has been offered to {name}.",
    "settingsMore.ownershipStopThis": "Stop this",
    "settingsMore.ownershipWaitOver":
        "The waiting period is over. They can complete this at any time.",
    "settingsMore.pacingBody":
        "{subject} are pacing past what your plan includes this period.",
    "settingsMore.pacingBoth": "Messages and calling minutes",
    "settingsMore.pacingMessages": "Messages",
    "settingsMore.pacingMinutes": "Calling minutes",
    "settingsMore.pacingProjection":
        " At the current pace, that adds about {amount} in overage to your "
            + "next invoice.",
    "settingsMore.pacingReassurance":
        "This is the early flag, not a surprise bill. Your spending cap "
            + "below is the backstop: sending and calling pause there, and "
            + "nothing bills past it.",
    "settingsMore.quietHoursNote":
        "Texting quiet hours use each customer's local time, not this "
            + "timezone.",
    "settingsMore.registrationApproved": "approved",
    "settingsMore.registrationBeingPrepared": "Registration details are being prepared.",
    "settingsMore.registrationIs":
        "Registration is {state}. Owners and admins can see the full "
            + "details.",
    "settingsMore.registrationOnFile": "on file",
    "settingsMore.saveCap": "Save cap",
    "settingsMore.seeFairUse": "See the fair use policy",
    "settingsMore.sendingPausesAt": "SENDING PAUSES AT",
    "settingsMore.showNumbers": "Show the numbers",
    "settingsMore.signFirstText": "Sign the first text to a new customer",
    "settingsMore.signFirstTextSupporting":
        "Once per customer. Replies and later texts are never signed.",
    "settingsMore.signTextsDesc":
        "Add your business name to the first text you send someone, so a "
            + "message from an unknown number says who it is from.",
    "settingsMore.signTextsTitle": "Sign your texts",
    "settingsMore.signatureLength":
        "That is {count} characters, so a long first text can be sent in "
            + "two parts instead of one.",
    "settingsMore.sinLast4": "SIN (last 4)",
    "settingsMore.spendingCap": "Spending cap",
    "settingsMore.spendingCapDesc":
        "Your protection against surprise bills. The cap is a multiple of "
            + "your included usage. At the cap, sending and calling pause until "
            + "you raise it. Nothing bills past it.",
    "settingsMore.ssnLast4": "SSN (last 4)",
    "settingsMore.storage": "Storage",
    "settingsMore.storageNotes": "Files on notes",
    "settingsMore.storageOther": "Other files",
    "settingsMore.storageReceived": "Attachments received",
    "settingsMore.storageSent": "Attachments sent",
    "settingsMore.storageVoicemail": "Voicemail recordings",
    "settingsMore.storedFree": "{size} stored. Free on every plan, no caps.",
    "settingsMore.timezoneDesc":
        "Dates in emails about your workspace are framed in your "
            + "business's local time.",
    "settingsMore.timezoneSaved": "Timezone saved.",
    "settingsMore.timezoneSearchHint": "Search, e.g. Toronto",
    "settingsMore.usRegPausedHeading": "You can start this while your plan is paused",
    "settingsMore.usRegPausedNote":
        "Carrier review takes days either way, and none of it needs your "
            + "plan running. Doing it now means the waiting happens in your "
            + "quiet season rather than in your first week back.",
    "settingsMore.usRegPausedTermLimit":
        "Sending stays off until you resume. Approval means US texting is "
            + "set up and waiting for you, not that a paused plan starts sending.",
    "settingsMore.usRegPausedTermMoney":
        "The {fee} is charged today, and it is charged once ever — not "
            + "again when you come back.",
    "settingsMore.usRegPausedTermWait":
        "Carriers review you while your plan is paused. The pause does not "
            + "hold the registration up.",
    "settingsMore.usRegRunningTail": "We handle it and email you when it's live.",
    "settingsMore.usRegTerms":
        "A one-time {fee} registration fee is charged to your card on "
            + "file, and we register your business with US carriers. Approval "
            + "usually takes 3 to 7 business days.",
    "settingsMore.usageNone":
        "No usage yet. Finish setup under Billing to pick a plan and get "
            + "your number.",
    "settingsMore.usageQuiet":
        "Well within fair use this month. Almost every crew stays inside "
            + "what their plan covers, and we reach out early if usage ever "
            + "paces past it.",
    "settingsMore.usageTitle": "Usage",
    "settingsMore.usedOfCap": "{used} of {cap}",
    "settingsMore.websiteLabel": "Website",
    "settingsMore.whatGetsAdded": "What gets added",
    "settingsMore.withThisOff": "With this off",
    "settingsMore.withThisOffBody":
        "You will not be asked. A text you start at 2am goes straight out, "
            + "and it is on you that the customer wanted to hear from you then.",
    "settingsMore.workspaceName": "Workspace name",
    "settingsMore.workspaceNameDesc":
        "The name your customers know you by, used on your carrier "
            + "registration and available as {business_name} in your texts.",
    "settingsMore.workspaceNameSaved": "Workspace name saved.",
]

/// The French for the block above. Same keys, same {tokens} — `AppStringsTests`
/// checks both, in both directions.
private let settingsCoreFr: [String: String] = [
    "misc.ownershipDetailAcceptOffer":
        "En acceptant, vous devenez responsable de la facturation, du "
            + "plafond de dépenses et de vos numéros ; le propriétaire actuel "
            + "reste dans l'équipe comme administrateur. Tout le monde est "
            + "informé dans les deux cas. L'offre expire {when}.",
    "misc.ownershipDetailBackupStanding":
        "Si le propriétaire ne peut plus accéder au compte un jour — il "
            + "quitte, il perd l'accès à son courriel, ou pire — vous êtes la "
            + "seule personne qui peut demander à reprendre. Il a une semaine "
            + "pour refuser, et toute l'équipe en est informée. Rien ne change "
            + "tant que vous ne demandez pas.",
    "misc.ownershipDetailClaimWaiting":
        "Le propriétaire a reçu un courriel et peut arrêter cette demande "
            + "jusqu'au {when}. Si personne ne l'arrête, vous pourrez terminer "
            + "la reprise après ce moment.",
    "misc.ownershipDetailCompleteClaim":
        "Le délai d'attente est écoulé et personne ne l'a arrêté. Terminer "
            + "cette reprise fait de vous le propriétaire — la facturation, le "
            + "plafond de dépenses et vos numéros — et place l'ancien "
            + "propriétaire dans l'équipe comme administrateur.",
    "settings.awayEmergencyNotMentioned":
        "Personne n'a été informé qu'il le pouvait. Mentionnez-le dans "
            + "votre message d'absence si vous voulez que les clients le sachent.",
    "settings.awayEmergencyOff":
        "Votre message d'absence dit aux clients de répondre en cas "
            + "d'urgence, mais rien ne traitera cette réponse comme telle. "
            + "Réactivez ce réglage, ou retirez cette offre du message.",
    "settings.awayEmergencyUnknownWord":
        "Votre message d'absence dit aux clients de répondre {word}, un "
            + "mot que rien ne surveille. Utilisez plutôt {words}, ajoutez "
            + "{word} à vos mots d'urgence, ou retirez cette offre du message.",
    "settings.cancelConsequence":
        "Annulez quand vous voulez. Rien ne change avant la fin de votre "
            + "période de facturation — si vos textos sont actifs, ils le "
            + "restent jusque-là. Votre numéro est conservé {days} jours à "
            + "compter du jour de l'annulation — et non du jour où votre forfait "
            + "se termine — il peut donc retourner à la compagnie de téléphone "
            + "peu après. Après quoi il est libéré définitivement.",
    "settings.cancelExitAction": "Continuer vers l'annulation",
    "settings.cancelExportHeading": "Partez avec vos clients",
    "settings.cancelNotInPortal":
        "Le portail de paiement ci-dessus sert aux cartes et aux factures "
            + "et ne contient aucune annulation : ce n'est donc pas là qu'il "
            + "faut la chercher.",
    "settings.cancelOwnerOnly":
        "Seul le propriétaire peut annuler ce forfait. Quand il le fait, "
            + "rien ne change avant la fin de la période de facturation — si vos "
            + "textos sont actifs, ils le restent jusque-là. Le numéro est "
            + "conservé {days} jours à compter du jour de l'annulation — et non "
            + "du jour où le forfait se termine — il peut donc retourner à la "
            + "compagnie de téléphone peu après. Après quoi il est libéré "
            + "définitivement.",
    "settings.cancelReasonMissingFeature": "Il manque quelque chose dont j'ai besoin",
    "settings.cancelReasonNotUsing": "Je ne m'en sers pas",
    "settings.cancelReasonOther": "Autre chose",
    "settings.cancelReasonSeasonal": "Saison tranquille, je reviendrai",
    "settings.cancelReasonSwitched": "Je passe à autre chose",
    "settings.cancelReasonTooExpensive": "Trop cher",
    "settings.capConfirmTitle": "Fixer le plafond à {cap} ?",
    "settings.capLowered":
        "Les envois s'arrêtent à {next} textos pour cette période. Si vous "
            + "avez déjà dépassé ce nombre, les envois s'arrêtent tout de suite.",
    "settings.capRaised":
        "Les envois s'arrêtent à {next} textos pour cette période au lieu "
            + "de {current}.",
    "settings.capRaisedToCeiling":
        "Les envois s'arrêtent à {next} textos pour cette période au lieu "
            + "de {current}. C'est le plafond le plus élevé possible. Chaque "
            + "texto au-delà des {included} compris est facturé au tarif de "
            + "dépassement jusqu'à l'arrêt des envois.",
    "settings.changePlanBackCountMany":
        "Vous êtes sur Pro maintenant, et {count} numéros sont de retour.",
    "settings.changePlanBackCountOne":
        "Vous êtes sur Pro maintenant, et {count} numéro est de retour.",
    "settings.changePlanBackOne":
        "Vous êtes sur Pro maintenant, et {subject} est de retour.",
    "settings.changePlanOnPro": "Vous êtes sur Pro maintenant.",
    "settings.changePlanScheduled": "Passage à Starter prévu pour la fin de cette période.",
    "settings.deviceAndroid": "Application Android",
    "settings.deviceCountMany": "{count} appareils",
    "settings.deviceCountOne": "1 appareil",
    "settings.deviceIos": "iPhone ou iPad",
    "settings.deviceUnknown": "Appareil non reconnu",
    "settings.deviceWeb": "Navigateur web",
    "settings.enableUsButton": "Activer les textos américains : {fee} une seule fois",
    "settings.enableUsReadOnly":
        "Demandez au propriétaire du compte d'activer les textos "
            + "américains ; c'est une inscription unique de {fee} auprès des "
            + "fournisseurs.",
    "settings.enableUsStarted":
        "Inscription américaine lancée. Nous vous écrirons quand elle sera "
            + "approuvée.",
    "settings.enableUsStartedPaused":
        "Inscription américaine lancée. Nous vous écrirons quand elle sera "
            + "approuvée ; les textos américains partiront à votre reprise.",
    "settings.handoverPromptAsked": "Vous avez demandé à reprendre cet espace de travail.",
    "settings.handoverPromptBackup": "Vous êtes le propriétaire de relève.",
    "settings.handoverPromptOffered":
        "La propriété de cet espace de travail vous a été offerte.",
    "settings.handoverPromptReady": "Votre demande de reprise est prête à être conclue.",
    "settings.handoverWithdraw": "Retirer ma demande",
    "settings.heldKept":
        "Un numéro en attente n'a pas été abandonné. Nous le conservons, "
            + "les textos et les appels s'y rendent toujours, et rien dans son "
            + "historique n'a été touché — vous ne pouvez simplement pas envoyer "
            + "ni répondre à partir de lui pendant l'attente.",
    "settings.heldLead":
        "Votre forfait couvre {allowance} numéros, et vous en avez plus "
            + "que cela.",
    "settings.heldLeadOne": "Votre forfait couvre 1 numéro, et vous en avez plus que cela.",
    "settings.heldNoteLead": "Ce numéro est en attente.",
    "settings.heldRouteAlsoPro":
        "Ou passez à Pro depuis la carte du forfait ci-dessus : cela "
            + "ramène tout ce qui entre, sans numéro supplémentaire à acheter.",
    "settings.heldRouteFull":
        "Starter plafonne à {max} numéros : il n'y a donc rien de plus à "
            + "acheter ici. Passez à Pro depuis la carte du forfait ci-dessus et "
            + "tout ce qui entre revient.",
    "settings.heldRouteHelpMany": "Écrivez-nous et nous les ramènerons.",
    "settings.heldRouteHelpOne": "Écrivez-nous et nous le ramènerons.",
    "settings.heldRoutePro":
        "Passez à Pro depuis la carte du forfait ci-dessus et tout ce qui "
            + "entre revient.",
    "settings.heldRouteResumeMany":
        "Votre forfait est en pause : rien ne peut encore y être ajouté. "
            + "Reprenez-le depuis la carte du forfait ci-dessus, puis vous "
            + "pourrez les ramener.",
    "settings.heldRouteResumeOne":
        "Votre forfait est en pause : rien ne peut encore y être ajouté. "
            + "Reprenez-le depuis la carte du forfait ci-dessus, puis vous "
            + "pourrez le ramener.",
    "settings.heldTailFacts":
        "Les textos et les appels s'y rendent toujours, mais vous ne "
            + "pouvez pas envoyer ni répondre à partir de lui.",
    "settings.heldTailWhereMember":
        "Le propriétaire du compte peut le ramener depuis Facturation.",
    "settings.heldTailWhereOwner":
        "Paramètres › Facturation explique pourquoi, et comment le ramener.",
    "settings.heldTitleMany": "{count} de vos numéros sont en attente",
    "settings.heldTitleOne": "Un de vos numéros est en attente",
    "settings.keywordAlphanumeric":
        "Lettres et chiffres seulement. La ponctuation est retirée de ce "
            + "que les clients envoient.",
    "settings.keywordCarrierOwned":
        "{word} reçoit une réponse du fournisseur avant de nous parvenir : "
            + "ce mot ne peut donc pas servir d'urgence.",
    "settings.keywordEmpty": "Tapez d'abord un mot.",
    "settings.keywordOneWord":
        "Un seul mot — les clients envoient un mot unique, alors une "
            + "expression ne correspondrait jamais.",
    "settings.keywordTooLong": "Trop long — 15 caractères au maximum.",
    "settings.keywordTooShort": "Trop court — utilisez au moins 2 caractères.",
    "settings.numberAreaCodeEmpty":
        "L'indicatif régional {code} n'a plus de nouveaux numéros pour "
            + "l'instant. Choisissez un autre numéro pour terminer la "
            + "configuration.",
    "settings.numberSetupFailed":
        "Nous n'avons pas pu terminer la configuration de votre numéro. "
            + "Choisissez un numéro pour réessayer.",
    "settings.numberSetupSlow":
        "Nous configurons encore votre numéro. Cela prend un peu plus de "
            + "temps que d'habitude.",
    "settings.numberSetupStalled":
        "La configuration prend plus de temps que prévu. Choisissez un "
            + "numéro pour terminer — vous ne serez pas facturé de nouveau.",
    "settings.offerComeBackOnStarter": "Revenir sur Starter",
    "settings.offerGetHelp": "Obtenir de l'aide",
    "settings.offerMissingBody":
        "Si ce dont vous aviez besoin n'est pas là, le plus rapide pour "
            + "que cela change est de nous dire ce que c'était. Nous répondons "
            + "{when}. {promise}",
    "settings.offerMissingHeading": "Dites-nous ce qui manquait",
    "settings.offerPausedSeasonalBody":
        "Votre numéro et tout votre historique de messages sont conservés "
            + "aussi longtemps que vous restez en pause — rien n'expire pendant "
            + "la pause, et il n'y a aucune date de retour à respecter. Annuler "
            + "plutôt met fin à la pause et démarre un compte à rebours : {days} "
            + "jours à compter du jour de l'annulation, et non de la fin de "
            + "votre période de facturation, au terme duquel le numéro retourne "
            + "à la compagnie de téléphone.",
    "settings.offerPausedSeasonalHeading":
        "Votre forfait est déjà en pause, et cette conservation n'a aucune "
            + "échéance",
    "settings.offerRegistrationFeePaid":
        " Vous avez déjà payé les frais d'inscription uniques, et ils sont "
            + "facturés au plus une fois par espace de travail, à jamais — "
            + "revenir ne les facture pas de nouveau.",
    "settings.offerSeasonalBody":
        "Il continue de recevoir les textos tout du long, alors rien de ce "
            + "qu'un client envoie n'est perdu — vous ne pouvez pas répondre "
            + "avant votre retour, et votre historique de messages reste en "
            + "place. Les {days} jours courent à compter du jour de "
            + "l'annulation, et non de la fin de votre période de facturation : "
            + "une saison tranquille plus longue dépasse donc la conservation, "
            + "et le numéro retourne à la compagnie de téléphone.",
    "settings.offerSeasonalGraceBody":
        "Il reçoit encore les textos, alors rien de ce qu'un client envoie "
            + "n'est perdu, même si vous ne pouvez pas répondre avant votre "
            + "retour. Cette date est à {days} jours du jour de l'annulation, et "
            + "non de la fin de votre dernière période de facturation. "
            + "Réabonnez-vous avant, et le numéro ainsi que tout votre "
            + "historique de messages reviennent avec vous.",
    "settings.offerSeasonalGraceHeading":
        "Votre numéro vous appartient encore jusqu'à la date ci-dessous",
    "settings.offerSeasonalHeading":
        "Votre numéro est conservé {days} jours à compter du jour de "
            + "l'annulation",
    "settings.offerStarterCovers":
        "Il couvre {seats} personnes et {numbers} numéros d'entreprise.",
    "settings.offerStarterCoversOne":
        "Il couvre {seats} personnes et {numbers} numéro d'entreprise.",
    "settings.offerStarterHeading":
        "Starter est le même produit, au prix d'une plus petite équipe",
    "settings.offerStarterHeadingGrace": "Il existe un forfait plus petit pour revenir",
    "settings.offerStarterPrice":
        "Starter coûte {starter} par mois au lieu de {pro}, avec des "
            + "quantités de textos et d'appels plus petites, sous la même "
            + "politique d'usage raisonnable.",
    "settings.offerStarterTail":
        "Le changement prend effet à la fin de votre période de "
            + "facturation en cours. Votre historique de messages vous suit, et "
            + "le numéro d'où vous textez aussi — un deuxième numéro, non : le "
            + "passage au forfait inférieur est refusé tant que vous ne l'avez "
            + "pas libéré, et tant que l'équipe n'est pas revenue sous les "
            + "{seats} places.",
    "settings.offerStarterTailGrace":
        "Revenez sur Starter et votre numéro ainsi que tout votre "
            + "historique de messages vous suivent.",
    "settings.offerStarterTailPaused":
        "Votre forfait est en pause : cela se fait donc en deux étapes, "
            + "dans cet ordre — reprenez d'abord, puis changez de forfait. Le "
            + "changement prend effet à la fin de votre période de facturation "
            + "en cours. Votre historique de messages vous suit, et le numéro "
            + "d'où vous textez aussi — un deuxième numéro, non : le passage au "
            + "forfait inférieur est refusé tant que vous ne l'avez pas libéré, "
            + "et tant que l'équipe n'est pas revenue sous les {seats} places.",
    "settings.pauseComeBack": "Revenez quand le travail revient.",
    "settings.pauseComeBackOn": "Revenez sur {plan} quand le travail revient.",
    "settings.pauseConfirmMessage":
        "Vous serez facturé {price} par mois au lieu de votre forfait, à "
            + "compter de maintenant. Les textos et les appels s'arrêtent "
            + "immédiatement. Votre numéro, votre historique de messages et tout "
            + "ce que vous aviez planifié restent exactement où ils sont, et les "
            + "textos que vos clients envoient continuent d'arriver. Rien de "
            + "tout cela n'a d'échéance — reprenez quand vous voulez.",
    "settings.pauseOfferBody":
        "{price} par mois conserve votre numéro et tout votre historique "
            + "de messages aussi longtemps que dure la période tranquille. Une "
            + "pause n'a aucun compte à rebours de {days} jours et rien ne "
            + "retourne à la compagnie de téléphone. Les textos et les appels "
            + "s'arrêtent ; les textos que vos clients envoient arrivent "
            + "toujours et vous attendent, et tout ce que vous aviez planifié "
            + "est conservé plutôt qu'annulé.",
    "settings.pauseResume": "Reprendre",
    "settings.pauseResumeNamed": "Reprendre {plan}",
    "settings.pausedConfirmPlain":
        "En pause. Les textos sont désactivés jusqu'à votre reprise.",
    "settings.pausedConfirmPriced":
        "En pause. Vous êtes facturé {price} par mois jusqu'à votre "
            + "reprise.",
    "settings.pausedLineArriving":
        "Les textos que vos clients envoient arrivent toujours, et tout ce "
            + "que vous aviez planifié est conservé jusqu'à votre reprise — rien "
            + "n'est perdu.",
    "settings.pausedLineNoDeadline":
        "Votre numéro et tout votre historique de messages restent "
            + "exactement où ils sont, sans aucune échéance.",
    "settings.pausedLineOff": "Les textos et les appels sont désactivés.",
    "settings.pausedLinePrice": "Vous êtes facturé {price} par mois pendant la pause.",
    "settings.planCheckFailed":
        "Nous n'avons pas pu vérifier si ce forfait est en pause : tout ce "
            + "qui dépend de la réponse — le prix, l'état et le changement de "
            + "forfait — est donc omis plutôt que deviné. Rien n'a changé dans "
            + "votre forfait.",
    "settings.planChecking": "Vérification : ce forfait est-il en pause…",
    "settings.portedHoldLead":
        "Le transfert est terminé — c'est la ligne qui est en attente.",
    "settings.prepaidConsentCredited":
        "Mettre fin à mon année prépayée et me créditer {credit}",
    "settings.prepaidConsentPlain": "Mettre fin à mon année prépayée",
    "settings.prepaidEndsCredited":
        "Changer met fin à l'année prépayée et remet {credit} sur votre "
            + "compte en crédit, qui est déduit de vos prochaines factures. Vous "
            + "payez ensuite le prix mensuel normal de {plan}.",
    "settings.prepaidEndsPlain":
        "Changer met fin à l'année prépayée. Vous payez ensuite le prix "
            + "mensuel normal de {plan}.",
    "settings.prepaidHeading": "Vous avez une année {plan} prépayée en cours.",
    "settings.provisionWaitLong":
        "Votre numéro prend un peu plus de temps que d'habitude. Nous nous "
            + "en occupons, vous n'avez pas à attendre ici.",
    "settings.provisionWaitMedium":
        "Nous configurons encore votre numéro, cela prend un peu plus de "
            + "temps que d'habitude. Patientez un instant.",
    "settings.provisionWaitShort":
        "Nous configurons votre numéro. Cela prend habituellement moins "
            + "d'une minute.",
    "settings.reinstateAction": "Le ramener",
    "settings.reinstateAlready": "{number} était déjà de retour.",
    "settings.reinstateBody":
        "{price} est ajouté à votre forfait. Un montant au prorata pour le "
            + "reste de cette période vous est facturé aujourd'hui, puis le "
            + "plein prix chaque mois. Le numéro pourra envoyer et répondre de "
            + "nouveau dès que ce sera traité.",
    "settings.reinstateDone":
        "{number} est de retour. Vous pouvez de nouveau envoyer et "
            + "répondre à partir de lui.",
    "settings.reinstateStuck":
        "Votre forfait couvre {number} maintenant, et le paiement a été "
            + "traité — mais le numéro n'est pas encore revenu. Écrivez-nous et "
            + "nous terminerons l'opération ; vous ne serez pas facturé de "
            + "nouveau.",
    "settings.reinstateTitle": "Ramener {number} ?",
    "settings.releaseBodyHeld":
        "Cela abandonne le numéro pour de bon. Il est en attente, pas "
            + "perdu — les textos et les appels s'y rendent toujours, et le "
            + "libérer met fin à cela aussi. Vous ne pouvez pas récupérer le "
            + "même numéro, et le ramener depuis Paramètres › Facturation cesse "
            + "d'être possible. Tapez le numéro pour confirmer.",
    "settings.releaseBodyPlain":
        "Cela abandonne le numéro pour de bon. Les clients qui le textent "
            + "ne vous joindront plus, et vous ne pouvez pas récupérer le même "
            + "numéro. Cela ne change ni votre forfait ni ce que vous payez — un "
            + "numéro est inclus, alors vous pouvez en configurer un nouveau ici "
            + "par la suite. Tapez le numéro pour confirmer.",
    "settings.textBackDefault":
        "Desole, nous avons manque votre appel. Ici {business_name}. "
            + "Repondez ici avec votre adresse et ce dont vous avez besoin, et "
            + "nous vous trouverons une place.",
    "settings.wordListNothing": "rien",
    "settings.wordListOr": " ou ",
    "settingsMore.addressLabel": "Adresse",
    "settingsMore.aiNearLimit": "Proche de la limite du mois. Elle se réinitialise le 1er.",
    "settingsMore.aiNoOutcomes":
        "Rien n'est encore enregistré sur l'utilisation qui en a été faite.",
    "settingsMore.askMeToConfirm": "Me demander de confirmer",
    "settingsMore.askMeToConfirmSupporting":
        "Seulement quand c'est vous qui démarrez la conversation. Répondre "
            + "à un client qui vous a écrit ou appelé n'est jamais interrompu.",
    "settingsMore.atCapBody":
        "Vous avez atteint le plafond de dépenses que vous avez fixé. Les "
            + "envois et les appels sont en pause tant que vous ne l'augmentez "
            + "pas. Rien n'est facturé au-delà.",
    "settingsMore.atCapTitle": "À votre plafond de dépenses",
    "settingsMore.automatedLanguageDesc":
        "La langue dans laquelle nous écrivons quand nous textons un "
            + "client pour vous : la réponse hors des heures, le texto d'appel "
            + "manqué, l'accusé de réception d'urgence et la demande "
            + "d'évaluation après un travail.",
    "settingsMore.automatedLanguageNotApp":
        "Cela ne change pas l'application elle-même, et cela ne réécrit "
            + "jamais les mots que quelqu'un a tapés. Un message d'absence que "
            + "vous avez écrit est envoyé exactement tel quel, dans la langue où "
            + "vous l'avez écrit.",
    "settingsMore.automatedLanguagePerContact":
        "Un client qui devrait recevoir vos messages dans l'autre langue "
            + "peut être réglé sur sa propre fiche.",
    "settingsMore.automatedLanguageTitle": "Langue des textos automatisés",
    "settingsMore.businessIdCard": "Identification de l'entreprise",
    "settingsMore.businessIdCardDesc":
        "Ce que les fournisseurs ont au dossier pour votre entreprise. "
            + "Cela vient de votre inscription pour les textos.",
    "settingsMore.businessIdLoading": "Chargement…",
    "settingsMore.callingMinutes": "Minutes d'appel",
    "settingsMore.capMax": "{cap} max",
    "settingsMore.capReadOnly":
        "Plafond de dépenses : {cap} l'utilisation comprise. Seul le "
            + "propriétaire du compte peut le changer.",
    "settingsMore.capSetTo": "Plafond de dépenses fixé à {cap}.",
    "settingsMore.changeRegistrationUnderNumbers":
        "Besoin de changer quelque chose ? Gérez l'inscription sous "
            + "Numéros.",
    "settingsMore.changeTimezone": "Changer le fuseau horaire",
    "settingsMore.commaRange": ", {range}",
    "settingsMore.contactLabel": "Contact",
    "settingsMore.countryCa": "Canada",
    "settingsMore.countryElsewhere": "Ailleurs",
    "settingsMore.countryUs": "États-Unis",
    "settingsMore.deliveryByCountry": "{country} : {figure}",
    "settingsMore.deliveryCounts": "{delivered} sur {total}",
    "settingsMore.deliveryDelivered": "{count} livrés avec confirmation",
    "settingsMore.deliveryDesc":
        "Livraison rapportée par les fournisseurs pour cette période. "
            + "Qu'un fournisseur confirme avoir pris le message ne veut pas dire "
            + "que quelqu'un l'a lu : c'est le plus que nous pouvons honnêtement "
            + "vous dire.",
    "settingsMore.deliveryFailed": " · {count} ne se sont pas rendus",
    "settingsMore.deliveryFailureNote":
        "Un texto qui ne se rend pas vient généralement d'un numéro "
            + "débranché ou d'un appareil éteint depuis des jours. Ouvrez la "
            + "conversation : le message lui-même dit ce que le fournisseur a "
            + "rapporté.",
    "settingsMore.deliveryNothingBounced": "Rien n'a rebondi pour cette période.",
    "settingsMore.deliveryPending": " · {count} encore en route",
    "settingsMore.deliveryPercent": "{percent} %",
    "settingsMore.deliveryTitle": "Vos textos arrivent-ils ?",
    "settingsMore.details": "Détails",
    "settingsMore.detailsBlurb": "Les chiffres bruts, mois par mois, si vous les voulez.",
    "settingsMore.extraNumberCountry":
        "Les numéros supplémentaires sont offerts aux espaces de travail "
            + "américains et canadiens.",
    "settingsMore.extraNumberCurrency":
        "Les numéros supplémentaires sont facturés en dollars américains "
            + "et ne peuvent pas encore être ajoutés à un abonnement facturé "
            + "dans une autre devise. Écrivez au soutien et nous arrangerons "
            + "cela.",
    "settingsMore.extraNumberUsTexting":
        "Un numéro supplémentaire exige d'abord que les textos américains "
            + "soient activés pour votre espace de travail.",
    "settingsMore.headsUp": "À noter",
    "settingsMore.hideNumbers": "Masquer les chiffres",
    "settingsMore.howCounted": "Comment les textos sont comptés",
    "settingsMore.howCountedLine":
        "Un texto d'au plus 160 caractères compte pour un message ; les "
            + "textos plus longs se divisent en segments de 160 caractères (70 "
            + "avec des émojis ou des accents). Un message avec photo compte "
            + "pour trois. Les messages entrants sont toujours gratuits.",
    "settingsMore.languageUpdated": "Langue mise à jour.",
    "settingsMore.lastSixMonths": "6 derniers mois",
    "settingsMore.lastSixMonthsLine": "Textos sortants par mois civil.",
    "settingsMore.legalName": "Dénomination sociale",
    "settingsMore.localTimeNow": "Il est {time} à {zone} en ce moment.",
    "settingsMore.louThisMonth": "Lou ce mois-ci",
    "settingsMore.louThisMonthLine":
        "Ce que Lou a rédigé, rempli et transcrit. Chaque compteur se "
            + "réinitialise le 1er.",
    "settingsMore.messages": "Textos",
    "settingsMore.messagesInbound":
        "{count} textos reçus pour cette période. La réception est "
            + "toujours gratuite.",
    "settingsMore.messagesNoOverage":
        "Aucun dépassement pour cette période. 0,00 $ de plus jusqu'ici.",
    "settingsMore.messagesOverage":
        "{over} au-delà de ce qui est compris : {amount} en dépassement "
            + "sur votre prochaine facture.",
    "settingsMore.messagesPauseAt": "Les envois s'arrêtent à {count} textos",
    "settingsMore.messagesPauseMax":
        ", le maximum, soit 10 fois les textos compris dans votre forfait.",
    "settingsMore.messagesThisPeriod": "textos pour cette période",
    "settingsMore.messagesUsed": "{used} des {included} textos compris utilisés{range}.",
    "settingsMore.minutesBilled":
        "Au-delà des minutes comprises, chaque minute supplémentaire coûte "
            + "1 ¢. Les appels s'arrêtent à votre plafond de dépenses, jamais en "
            + "plein appel.",
    "settingsMore.minutesNotBilled":
        "Les minutes supplémentaires ne sont pas facturées sur votre "
            + "forfait.",
    "settingsMore.minutesOverage":
        "{extra} minutes de plus jusqu'ici : {amount} sur votre prochaine "
            + "facture.",
    "settingsMore.minutesUsed": "{used} des {included} minutes comprises utilisées.",
    "settingsMore.nameLength200": "De 1 à 200 caractères.",
    "settingsMore.nearCapBody":
        "Vous avez utilisé {percent} % du plafond de dépenses que vous "
            + "avez fixé. Au plafond, les envois et les appels s'arrêtent tant "
            + "que vous ne l'augmentez pas. Rien n'est facturé au-delà.",
    "settingsMore.nearCapTitle": "Proche de votre plafond de dépenses",
    "settingsMore.nightTextAutomatedNote":
        "Cela ne change rien aux textos automatisés. Les rappels et tout "
            + "ce que nous envoyons en votre nom attendent toujours le matin du "
            + "client, quel que soit ce réglage.",
    "settingsMore.nightTextDesc":
        "Démarrer une toute nouvelle conversation entre 20 h et 8 h, heure "
            + "du client, vous demande d'abord de confirmer.",
    "settingsMore.nightTextTitle": "Écrire à un nouveau client la nuit",
    "settingsMore.noRegistrationNeeded":
        "Aucune inscription requise. Les textos au Canada fonctionnent "
            + "sans. Activer les textos vers les États-Unis en ajoute une.",
    "settingsMore.noRegistrationYet":
        "Aucun renseignement d'inscription au dossier pour l'instant. "
            + "Gérez l'inscription sous Numéros.",
    "settingsMore.noTimezoneMatch": "Aucun fuseau horaire ne correspond à « {query} ».",
    "settingsMore.off": "Désactivé",
    "settingsMore.oneTimesIncluded": "1x compris",
    "settingsMore.onlyAdminsLanguage":
        "Seuls les propriétaires et les admins peuvent changer la langue.",
    "settingsMore.onlyAdminsRename":
        "Seuls les propriétaires et les admins peuvent renommer l'espace "
            + "de travail.",
    "settingsMore.onlyAdminsSigning":
        "Seuls les propriétaires et les admins peuvent changer la "
            + "signature des textos.",
    "settingsMore.onlyAdminsThis":
        "Seuls les propriétaires et les admins peuvent changer ce réglage.",
    "settingsMore.onlyAdminsTimezone":
        "Seuls les propriétaires et les admins peuvent changer le fuseau "
            + "horaire.",
    "settingsMore.ownershipAskedToTakeOver":
        "{name} a demandé à reprendre cet espace de travail.",
    "settingsMore.ownershipCompletesAt":
        "Cela se conclut le {when} à moins que le propriétaire l'arrête. "
            + "L'arrêter prend effet immédiatement.",
    "settingsMore.ownershipDecline": "Refuser",
    "settingsMore.ownershipOfferExpires":
        "Rien ne change tant que la personne n'a pas accepté. L'offre "
            + "expire le {when}.",
    "settingsMore.ownershipOffered": "La propriété a été offerte à {name}.",
    "settingsMore.ownershipStopThis": "Arrêter",
    "settingsMore.ownershipWaitOver":
        "La période d'attente est terminée. La personne peut compléter la "
            + "reprise à tout moment.",
    "settingsMore.pacingBody":
        "{subject} dépassent le rythme de ce que votre forfait comprend "
            + "pour cette période.",
    "settingsMore.pacingBoth": "Les textos et les minutes d'appel",
    "settingsMore.pacingMessages": "Les textos",
    "settingsMore.pacingMinutes": "Les minutes d'appel",
    "settingsMore.pacingProjection":
        " À ce rythme, cela ajoute environ {amount} en dépassement à votre "
            + "prochaine facture.",
    "settingsMore.pacingReassurance":
        "C'est un avertissement précoce, pas une facture-surprise. Votre "
            + "plafond de dépenses ci-dessous est le filet : les envois et les "
            + "appels s'arrêtent là, et rien n'est facturé au-delà.",
    "settingsMore.quietHoursNote":
        "Les heures de silence des textos suivent l'heure locale de chaque "
            + "client, pas ce fuseau horaire.",
    "settingsMore.registrationApproved": "approuvée",
    "settingsMore.registrationBeingPrepared":
        "Les renseignements d'inscription sont en préparation.",
    "settingsMore.registrationIs":
        "L'inscription est {state}. Les propriétaires et les admins "
            + "peuvent voir tous les détails.",
    "settingsMore.registrationOnFile": "au dossier",
    "settingsMore.saveCap": "Enregistrer le plafond",
    "settingsMore.seeFairUse": "Voir la politique d'usage raisonnable",
    "settingsMore.sendingPausesAt": "LES ENVOIS S'ARRÊTENT À",
    "settingsMore.showNumbers": "Afficher les chiffres",
    "settingsMore.signFirstText": "Signer le premier texto à un nouveau client",
    "settingsMore.signFirstTextSupporting":
        "Une fois par client. Les réponses et les textos suivants ne sont "
            + "jamais signés.",
    "settingsMore.signTextsDesc":
        "Ajoutez le nom de votre entreprise au premier texto que vous "
            + "envoyez à quelqu'un, pour qu'un message venant d'un numéro "
            + "inconnu dise de qui il vient.",
    "settingsMore.signTextsTitle": "Signer vos textos",
    "settingsMore.signatureLength":
        "Cela fait {count} caractères : un premier texto long peut donc "
            + "être envoyé en deux parties plutôt qu'une.",
    "settingsMore.sinLast4": "NAS (4 derniers chiffres)",
    "settingsMore.spendingCap": "Plafond de dépenses",
    "settingsMore.spendingCapDesc":
        "Votre protection contre les factures-surprises. Le plafond est un "
            + "multiple de l'utilisation comprise dans votre forfait. Au "
            + "plafond, les envois et les appels s'arrêtent tant que vous ne "
            + "l'augmentez pas. Rien n'est facturé au-delà.",
    "settingsMore.ssnLast4": "SSN (4 derniers chiffres)",
    "settingsMore.storage": "Stockage",
    "settingsMore.storageNotes": "Fichiers dans les notes",
    "settingsMore.storageOther": "Autres fichiers",
    "settingsMore.storageReceived": "Pièces jointes reçues",
    "settingsMore.storageSent": "Pièces jointes envoyées",
    "settingsMore.storageVoicemail": "Enregistrements de boîte vocale",
    "settingsMore.storedFree":
        "{size} stockés. Gratuit sur tous les forfaits, sans plafond.",
    "settingsMore.timezoneDesc":
        "Les dates dans les courriels au sujet de votre espace de travail "
            + "sont exprimées dans l'heure locale de votre entreprise.",
    "settingsMore.timezoneSaved": "Fuseau horaire enregistré.",
    "settingsMore.timezoneSearchHint": "Rechercher, p. ex. Toronto",
    "settingsMore.usRegPausedHeading":
        "Vous pouvez commencer même si votre forfait est en pause",
    "settingsMore.usRegPausedNote":
        "L'examen par les fournisseurs prend des jours de toute façon, et "
            + "rien n'exige que votre forfait soit actif. Le faire maintenant, "
            + "c'est attendre pendant votre saison tranquille plutôt que pendant "
            + "votre première semaine de retour.",
    "settingsMore.usRegPausedTermLimit":
        "L'envoi reste désactivé jusqu'à votre reprise. L'approbation "
            + "signifie que les textos américains sont configurés et vous "
            + "attendent, pas qu'un forfait en pause se met à envoyer.",
    "settingsMore.usRegPausedTermMoney":
        "Les {fee} sont facturés aujourd'hui, et une seule fois — pas de "
            + "nouveau à votre retour.",
    "settingsMore.usRegPausedTermWait":
        "Les fournisseurs vous examinent pendant que votre forfait est en "
            + "pause. La pause ne retarde pas l'inscription.",
    "settingsMore.usRegRunningTail":
        "Nous nous en occupons et vous écrivons quand c'est en service.",
    "settingsMore.usRegTerms":
        "Des frais d'inscription uniques de {fee} sont portés à la carte "
            + "que nous avons au dossier, et nous inscrivons votre entreprise "
            + "auprès des fournisseurs américains. L'approbation prend "
            + "habituellement de 3 à 7 jours ouvrables.",
    "settingsMore.usageNone":
        "Aucune utilisation pour l'instant. Terminez la configuration sous "
            + "Facturation pour choisir un forfait et obtenir votre numéro.",
    "settingsMore.usageQuiet":
        "Bien à l'intérieur de l'usage raisonnable ce mois-ci. Presque "
            + "toutes les équipes restent dans ce que leur forfait couvre, et "
            + "nous communiquons avec vous tôt si l'utilisation dépasse le "
            + "rythme.",
    "settingsMore.usageTitle": "Utilisation",
    "settingsMore.usedOfCap": "{used} sur {cap}",
    "settingsMore.websiteLabel": "Site Web",
    "settingsMore.whatGetsAdded": "Ce qui est ajouté",
    "settingsMore.withThisOff": "Avec ce réglage désactivé",
    "settingsMore.withThisOffBody":
        "On ne vous demandera rien. Un texto que vous démarrez à 2 h part "
            + "directement, et c'est à vous de juger que le client voulait avoir "
            + "de vos nouvelles à ce moment-là.",
    "settingsMore.workspaceName": "Nom de l'espace de travail",
    "settingsMore.workspaceNameDesc":
        "Le nom sous lequel vos clients vous connaissent, utilisé pour "
            + "votre inscription auprès des fournisseurs et offert comme "
            + "{business_name} dans vos textos.",
    "settingsMore.workspaceNameSaved": "Nom de l'espace de travail enregistré.",
]
