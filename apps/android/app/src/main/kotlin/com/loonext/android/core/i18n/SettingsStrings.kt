package com.loonext.android.core.i18n

/**
 * #228 — the settings screens, A–M.
 *
 * The register is [CommonStrings]': Quebec French, VOUVOIEMENT, accents spelled
 * normally, a normal space before the high punctuation. Product names (Loonext,
 * Stripe, Telnyx, Lou) and the carrier keywords (STOP / HELP / START / URGENT)
 * are never translated — a carrier matches on the keyword, and a name somebody
 * has to search for in a support email must be the name we shipped.
 *
 * ## Why the maps are assembled from per-surface pieces
 *
 * One `mapOf` of four hundred pairs is one merge conflict for every agent
 * working on a settings screen, and it is unreadable to the translator who only
 * needs the voicemail card. Each surface is its own private map and the two
 * public ones are their sum, so a section reads like the screen it describes.
 *
 * ## What is deliberately NOT here
 *
 * Copy that lives outside a composable and cannot reach a locale — the pure
 * functions in `HeldNumbers.kt`, `ContactFields.Copy`, `SUPPORT_TOPICS` — stays
 * where it is. Threading a locale through five layers to reach one sentence
 * would be a bigger change than the extraction it serves, and each of those has
 * a parity test pinning its English against another client. They are listed in
 * the extraction report instead of being half-moved.
 */
object SettingsStrings : AppStrings.Section {
    override val en: Map<String, String> =
        AI_EN + CLOSED_DATES_EN + CONTACT_FIELDS_EN + LEAVE_EN + HELP_EN +
            DELETE_ACCOUNT_EN + EMERGENCY_EN + DEVICES_EN + HOURS_EN +
            CALLING_EN + HELD_EN + BILLING_EN

    override val frCA: Map<String, String> =
        AI_FR + CLOSED_DATES_FR + CONTACT_FIELDS_FR + LEAVE_FR + HELP_FR +
            DELETE_ACCOUNT_FR + EMERGENCY_FR + DEVICES_FR + HOURS_FR +
            CALLING_FR + HELD_FR + BILLING_FR
}

// ---------------------------------------------------------------------------
// Settings → AI (#214, #247, #367, #507)
// ---------------------------------------------------------------------------

/**
 * The thresholds ride in as `{messages}` and `{days}` rather than being spelled
 * out, for the reason the Kotlin they came from gives: a number in settings copy
 * that disagrees with the rule is how somebody learns not to trust the settings
 * screen. The French has to interpolate the same two or the sentence promises a
 * rule with no number in it — which `AppStringsTest` checks in both languages.
 */
private val AI_EN = mapOf(
    "settings.aiIntro" to
        "Let the app pre-fill task details from a message. Every suggestion is " +
        "yours to review and edit before you save — nothing is sent or applied " +
        "on its own.",
    "settings.aiTaskCard" to "When you make a task from a message",
    "settings.aiSuggestAddress" to "Suggest an address",
    "settings.aiSuggestAddressHelp" to
        "Read a job location out of the message (or fall back to the contact's " +
        "address) and pre-fill the task's address. It shows where each part came " +
        "from; you can edit or clear it before saving.",
    "settings.aiSuggestDue" to "Suggest a due date & time",
    "settings.aiSuggestDueHelp" to
        "Turn phrases like \"tomorrow at 2pm\" or \"next Tuesday\" into a due date " +
        "in your workspace's timezone. Always editable before you save.",
    "settings.aiBusinessCard" to "What Lou knows about your business",
    "settings.aiBusinessHelp" to
        "One sentence, in your words. Without it Lou will not say what your " +
        "business does, because anything it said would be guesswork. With it, " +
        "drafts can answer \"do you do X?\" honestly.",
    "settings.aiBusinessPlaceholder" to
        "We paint houses and do small renovations in Calgary.",
    "settings.aiBusinessCount" to "{count} / {max}",
    "settings.aiThreadCard" to "When you open a long thread",
    "settings.aiCatchUp" to "Let Lou catch you up",
    "settings.aiCatchUpHelp" to
        "On a thread of {messages} messages or more — or a shorter one nobody has " +
        "touched in {days} days — offer a short catch-up: what they asked, what " +
        "you said, what is still open. Lou reads the conversation to write it, " +
        "and every line quotes a real message you can tap straight to. It is only " +
        "ever offered, never automatic, and it changes nothing about which " +
        "threads you see or the order they come in.",
    "settings.aiReplyCard" to "When you reply to a customer",
    "settings.aiDraftReplies" to "Let Lou draft replies",
    "settings.aiDraftRepliesHelp" to
        "Offer a few short replies you can edit before sending, drawn from the " +
        "conversation so far. Start typing and they finish what you started instead.",
    "settings.aiWrapUpCard" to "After you hang up",
    "settings.aiWrapUp" to "Let Lou write down your wrap-up",
    "settings.aiWrapUpHelp" to
        "Hold the microphone in the note box and say what was agreed — the quote, " +
        "the promise, the next step. Lou writes your words down for you to check " +
        "and post as an internal note. It hears only you, on your own phone, " +
        "after the call has ended: never the call and never the customer. The " +
        "recording is deleted as soon as the words come back, and nothing is " +
        "posted until you post it.",
    "settings.aiVoicemailCard" to "When someone leaves a voicemail",
    "settings.aiTranscribe" to "Let Lou write voicemails down",
    "settings.aiTranscribeHelp" to
        "Show what a voicemail says next to the recording, so you can read it " +
        "when playing it isn't an option. The recording is always kept either way.",
    "settings.aiVoicemailIntake" to "Pull the job out of a voicemail",
    "settings.aiVoicemailIntakeHelp" to
        "Lou reads the transcript and shows what the caller wanted and where, " +
        "above the recording. Your greeting is untouched — if you want callers to " +
        "say the address, ask them for it in your own greeting. Nothing books " +
        "anything and nobody is put through a menu.",
    "settings.aiReadOnly" to "Only owners and admins can change these.",
)

private val AI_FR = mapOf(
    "settings.aiIntro" to
        "Laissez l'application pré-remplir les détails d'une tâche à partir d'un " +
        "texto. Chaque suggestion vous revient : vous la vérifiez et la modifiez " +
        "avant d'enregistrer — rien n'est envoyé ni appliqué tout seul.",
    "settings.aiTaskCard" to "Quand vous créez une tâche à partir d'un texto",
    "settings.aiSuggestAddress" to "Suggérer une adresse",
    "settings.aiSuggestAddressHelp" to
        "Repère le lieu des travaux dans le texto (ou reprend l'adresse du client) " +
        "et pré-remplit l'adresse de la tâche. L'application indique d'où vient " +
        "chaque élément ; vous pouvez le modifier ou l'effacer avant d'enregistrer.",
    "settings.aiSuggestDue" to "Suggérer une date et une heure d'échéance",
    "settings.aiSuggestDueHelp" to
        "Transforme des formules comme « demain à 14 h » ou « mardi prochain » en " +
        "date d'échéance, dans le fuseau horaire de votre espace de travail. " +
        "Toujours modifiable avant d'enregistrer.",
    "settings.aiBusinessCard" to "Ce que Lou sait de votre entreprise",
    "settings.aiBusinessHelp" to
        "Une phrase, dans vos mots. Sans elle, Lou ne dira pas ce que votre " +
        "entreprise fait, parce que tout ce qu'il en dirait serait une " +
        "supposition. Avec elle, les brouillons peuvent répondre honnêtement à " +
        "« faites-vous ceci ? ».",
    "settings.aiBusinessPlaceholder" to
        "Nous peignons des maisons et faisons de petites rénovations à Calgary.",
    "settings.aiBusinessCount" to "{count} / {max}",
    "settings.aiThreadCard" to "Quand vous ouvrez une longue conversation",
    "settings.aiCatchUp" to "Laisser Lou vous résumer la conversation",
    "settings.aiCatchUpHelp" to
        "Dans une conversation de {messages} textos ou plus — ou une plus courte à " +
        "laquelle personne n'a touché depuis {days} jours — propose un court " +
        "résumé : ce que le client a demandé, ce que vous avez répondu, ce qui " +
        "reste en suspens. Lou lit la conversation pour l'écrire, et chaque ligne " +
        "cite un vrai texto que vous pouvez ouvrir d'une touche. Ce n'est jamais " +
        "qu'une proposition, jamais automatique, et cela ne change rien aux " +
        "conversations que vous voyez ni à leur ordre.",
    "settings.aiReplyCard" to "Quand vous répondez à un client",
    "settings.aiDraftReplies" to "Laisser Lou rédiger des réponses",
    "settings.aiDraftRepliesHelp" to
        "Propose quelques réponses courtes que vous pouvez modifier avant " +
        "l'envoi, tirées de la conversation jusqu'ici. Commencez à écrire et " +
        "elles termineront plutôt ce que vous avez commencé.",
    "settings.aiWrapUpCard" to "Après avoir raccroché",
    "settings.aiWrapUp" to "Laisser Lou écrire votre compte rendu",
    "settings.aiWrapUpHelp" to
        "Maintenez le microphone dans la boîte de note et dites ce qui a été " +
        "convenu : le devis, la promesse, la prochaine étape. Lou met vos mots par " +
        "écrit pour que vous les vérifiiez et les publiiez en note interne. Il " +
        "n'entend que vous, sur votre propre téléphone, une fois l'appel terminé : " +
        "jamais l'appel et jamais le client. L'enregistrement est supprimé dès que " +
        "les mots reviennent, et rien n'est publié tant que vous ne le publiez pas.",
    "settings.aiVoicemailCard" to "Quand quelqu'un laisse un message vocal",
    "settings.aiTranscribe" to "Laisser Lou mettre les messages vocaux par écrit",
    "settings.aiTranscribeHelp" to
        "Affiche le contenu d'un message vocal à côté de l'enregistrement, pour " +
        "que vous puissiez le lire quand l'écouter n'est pas possible. " +
        "L'enregistrement est conservé dans tous les cas.",
    "settings.aiVoicemailIntake" to "Dégager le travail demandé d'un message vocal",
    "settings.aiVoicemailIntakeHelp" to
        "Lou lit la transcription et affiche ce que l'appelant voulait et où, " +
        "au-dessus de l'enregistrement. Votre message d'accueil reste intact — si " +
        "vous voulez que les appelants donnent l'adresse, demandez-la dans votre " +
        "propre message d'accueil. Rien n'est réservé et personne n'est renvoyé à " +
        "un menu.",
    "settings.aiReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier ces réglages.",
)

// ---------------------------------------------------------------------------
// Settings → Hours → closed dates (#402)
// ---------------------------------------------------------------------------

private val CLOSED_DATES_EN = mapOf(
    "settings.closedDatesTitle" to "Closed dates",
    "settings.widgetTitle" to "Text us button for your website",
    "settings.widgetBlurb" to "A button on your own site that turns a visitor into a conversation here. They type their number, we text them a code, and their message lands in your inbox like any other text.",
    "settings.widgetShow" to "Get the snippet",
    "settings.widgetLoading" to "Loading…",
    "settings.widgetStepCopy" to "Copy the line below.",
    "settings.widgetStepPaste" to "Paste it into your website, just before </body>.",
    "settings.widgetStepSave" to "Save and reload your site — the button appears bottom right.",
    "settings.widgetCopy" to "Copy",
    "settings.widgetCopied" to "Copied.",
    "settings.widgetLoadFailed" to "Couldn't load your snippet. Try again.",
    "settings.widgetRotate" to "Replace the key",
    "settings.widgetRotateWarning" to "The button stops working on every site using the old snippet, immediately. You'll need to paste the new one everywhere you installed it.",
    "settings.widgetRotateConfirm" to "Replace it",
    "settings.widgetRotated" to "Replaced. Paste the new snippet on your site.",
    "settings.widgetLineLabel" to "Which number website messages land on",
    "settings.widgetLineHelp" to "Replies from your crew come from this number, so pick the line you watch.",
    "settings.widgetLineDefault" to "Your first number",
    "settings.widgetLineSaved" to "Website messages will land on that number.",
    "settings.closedDatesIntro" to
        "Holidays, a week off, a day for a funeral. On these dates your away reply " +
        "goes out even if the weekly schedule says you're open — so a customer " +
        "texting on Christmas morning hears something back instead of nothing.",
    "settings.closedDatesEmpty" to
        "No closed dates yet. Your weekly hours apply every week.",
    "settings.closedDatesRemove" to "Remove",
    "settings.closedDatesRemoved" to "Closed date removed.",
    "settings.closedDatesAdded" to "Closed date added.",
    "settings.closedDatesFirstDay" to "First day",
    "settings.closedDatesLastDay" to "Last day",
    "settings.closedDatesSameDay" to "Same day",
    "settings.closedDatesNoteLabel" to "What to tell customers (optional)",
    "settings.closedDatesNotePlaceholder" to "Closed for the holiday, back Monday",
    "settings.closedDatesAdd" to "Add closed date",
    "settings.closedDatesNeedDate" to "Pick the date you're closed.",
    "settings.closedDatesBackwards" to "The last day can't be before the first day.",
)

private val CLOSED_DATES_FR = mapOf(
    "settings.closedDatesTitle" to "Jours de fermeture",
    "settings.widgetTitle" to "Bouton « Écrivez-nous » pour votre site Web",
    "settings.widgetBlurb" to "Un bouton sur votre propre site qui transforme un visiteur en conversation ici. Il entre son numéro, nous lui envoyons un code, et son message arrive dans votre boîte comme n'importe quel texto.",
    "settings.widgetShow" to "Obtenir le code à coller",
    "settings.widgetLoading" to "Chargement…",
    "settings.widgetStepCopy" to "Copiez la ligne ci-dessous.",
    "settings.widgetStepPaste" to "Collez-la dans votre site, juste avant </body>.",
    "settings.widgetStepSave" to "Enregistrez et rechargez votre site — le bouton apparaît en bas à droite.",
    "settings.widgetCopy" to "Copier",
    "settings.widgetCopied" to "Copié.",
    "settings.widgetLoadFailed" to "Impossible de charger votre code. Réessayez.",
    "settings.widgetRotate" to "Remplacer la clé",
    "settings.widgetRotateWarning" to "Le bouton cessera de fonctionner sur tous les sites utilisant l'ancien code, immédiatement. Vous devrez coller le nouveau partout où vous l'avez installé.",
    "settings.widgetRotateConfirm" to "Remplacer",
    "settings.widgetRotated" to "Remplacée. Collez le nouveau code sur votre site.",
    "settings.widgetLineLabel" to "Le numéro qui reçoit les messages du site web",
    "settings.widgetLineHelp" to "Les réponses de votre équipe partent de ce numéro : choisissez la ligne que vous surveillez.",
    "settings.widgetLineDefault" to "Votre premier numéro",
    "settings.widgetLineSaved" to "Les messages du site web arriveront sur ce numéro.",
    "settings.closedDatesIntro" to
        "Les jours fériés, une semaine de congé, une journée pour des funérailles. " +
        "Ces jours-là, votre réponse d'absence part même si l'horaire hebdomadaire " +
        "vous dit ouvert — ainsi, le client qui écrit le matin de Noël reçoit " +
        "quelque chose plutôt que rien.",
    "settings.closedDatesEmpty" to
        "Aucun jour de fermeture. Vos heures hebdomadaires s'appliquent chaque semaine.",
    "settings.closedDatesRemove" to "Retirer",
    "settings.closedDatesRemoved" to "Jour de fermeture retiré.",
    "settings.closedDatesAdded" to "Jour de fermeture ajouté.",
    "settings.closedDatesFirstDay" to "Premier jour",
    "settings.closedDatesLastDay" to "Dernier jour",
    "settings.closedDatesSameDay" to "Même jour",
    "settings.closedDatesNoteLabel" to "Quoi dire aux clients (facultatif)",
    "settings.closedDatesNotePlaceholder" to "Fermé pour le congé, de retour lundi",
    "settings.closedDatesAdd" to "Ajouter un jour de fermeture",
    "settings.closedDatesNeedDate" to "Choisissez la date de fermeture.",
    "settings.closedDatesBackwards" to
        "Le dernier jour ne peut pas précéder le premier jour.",
)

// ---------------------------------------------------------------------------
// Settings → Workspace → the fields a workspace defines for itself (#291)
// ---------------------------------------------------------------------------

/**
 * The card's HEADING, INTRO, CAP_REACHED, PRIVACY and DELETE_WARNING are not
 * here: they live in `ContactFields.Copy`, which `ContactFieldsParityTest` pins
 * word-for-word against the web card. Copying them into this catalogue would
 * fork the thing that test exists to keep single.
 */
private val CONTACT_FIELDS_EN = mapOf(
    "settings.contactFieldsLoading" to "Loading…",
    "settings.contactFieldsEmpty" to
        "You have not added any yet. Your contacts show the standard fields — " +
        "name, phone, email, address and notes.",
    "settings.contactFieldsNameLabel" to "Field name",
    "settings.contactFieldsNamePlaceholder" to "Boiler model",
    "settings.contactFieldsRemove" to "Remove",
    "settings.contactFieldsChoices" to "The choices, one per line",
    "settings.contactFieldsExportsAs" to "Exports as {key}",
    "settings.contactFieldsExportsAsFrozen" to
        "Exports as {key} · the name can change, the type cannot",
    "settings.contactFieldsAdd" to "Add a field",
    "settings.contactFieldsSave" to "Save fields",
    "settings.contactFieldsDiscard" to "Discard",
    "settings.contactFieldsNeedName" to "Give every field a name first.",
    "settings.contactFieldsSavedEmpty" to
        "Saved. Your contacts are back to the standard fields.",
    "settings.contactFieldsSaved" to "Saved. These show on every customer.",
)

private val CONTACT_FIELDS_FR = mapOf(
    "settings.contactFieldsLoading" to "Chargement…",
    "settings.contactFieldsEmpty" to
        "Vous n'en avez pas encore ajouté. Vos clients affichent les champs " +
        "standards : nom, téléphone, courriel, adresse et notes.",
    "settings.contactFieldsNameLabel" to "Nom du champ",
    "settings.contactFieldsNamePlaceholder" to "Modèle de chaudière",
    "settings.contactFieldsRemove" to "Retirer",
    "settings.contactFieldsChoices" to "Les choix, un par ligne",
    "settings.contactFieldsExportsAs" to "Exporté sous {key}",
    "settings.contactFieldsExportsAsFrozen" to
        "Exporté sous {key} · le nom peut changer, le type non",
    "settings.contactFieldsAdd" to "Ajouter un champ",
    "settings.contactFieldsSave" to "Enregistrer les champs",
    "settings.contactFieldsDiscard" to "Abandonner",
    "settings.contactFieldsNeedName" to "Donnez d'abord un nom à chaque champ.",
    "settings.contactFieldsSavedEmpty" to
        "Enregistré. Vos clients affichent de nouveau les champs standards.",
    "settings.contactFieldsSaved" to
        "Enregistré. Ces champs apparaissent sur chaque client.",
)

// ---------------------------------------------------------------------------
// Settings → leaving a workspace yourself (#406)
// ---------------------------------------------------------------------------

private val LEAVE_EN = mapOf(
    "settings.leaveTitle" to "Leave this workspace",
    "settings.leaveIntro" to
        "End your own access to this workspace. You can do this yourself — you " +
        "don't need to ask an owner.",
    "settings.leaveAccessEnds" to
        "Your access ends straight away, on every device you're signed in on.",
    "settings.leaveWorkReturns" to
        "Anything you were working on goes back to the team, so nothing is left " +
        "pointing at someone who has gone.",
    "settings.leaveHistoryStays" to
        "Messages you sent stay on the record under your name. Leaving doesn't " +
        "erase your work, and isn't meant to.",
    "settings.leaveComeBack" to
        "To come back, someone in the workspace has to invite you again.",
    "settings.leaveAction" to "Leave workspace",
    "settings.leavePending" to "Leaving…",
    "settings.leaveConfirmTitle" to "Leave {workspace}?",
    "settings.leaveConfirmBody" to
        "Your access ends now and your open work goes back to the team. To come " +
        "back, someone will need to invite you again.",
    "settings.leaveStay" to "Stay",
)

private val LEAVE_FR = mapOf(
    "settings.leaveTitle" to "Quitter cet espace de travail",
    "settings.leaveIntro" to
        "Mettez fin vous-même à votre accès à cet espace de travail. Vous pouvez " +
        "le faire vous-même — vous n'avez pas à le demander à un propriétaire.",
    "settings.leaveAccessEnds" to
        "Votre accès prend fin immédiatement, sur chaque appareil où vous êtes " +
        "connecté.",
    "settings.leaveWorkReturns" to
        "Tout ce sur quoi vous travailliez retourne à l'équipe : rien ne reste " +
        "rattaché à quelqu'un qui est parti.",
    "settings.leaveHistoryStays" to
        "Les textos que vous avez envoyés restent au dossier sous votre nom. " +
        "Partir n'efface pas votre travail, et ce n'est pas le but.",
    "settings.leaveComeBack" to
        "Pour revenir, quelqu'un de l'espace de travail doit vous réinviter.",
    "settings.leaveAction" to "Quitter l'espace de travail",
    "settings.leavePending" to "Départ en cours…",
    "settings.leaveConfirmTitle" to "Quitter {workspace} ?",
    "settings.leaveConfirmBody" to
        "Votre accès prend fin maintenant et votre travail en cours retourne à " +
        "l'équipe. Pour revenir, quelqu'un devra vous réinviter.",
    "settings.leaveStay" to "Rester",
)

// ---------------------------------------------------------------------------
// Settings → Help (#382, #253, #321, #555)
// ---------------------------------------------------------------------------

/**
 * `SUPPORT_TOPICS`, `SUPPORT_FIX_PROMISE` and the response-time clause are NOT
 * here. All three are hand-ported MIRRORS of `packages/shared/src/support.ts`
 * that `SupportPortTest` pins by content, and a French copy in this catalogue
 * would be a second original for a string whose whole point is that three
 * clients say it identically. They are named in the extraction report rather
 * than half-moved.
 */
private val HELP_EN = mapOf(
    "settings.helpEmailTitle" to "Email us",
    "settings.helpEmailIntro" to
        "Opens your mail app with your workspace details already filled in, so we " +
        "can look it up without asking you first.",
    "settings.helpEmailAction" to "Email {email}",
    "settings.helpWhatToSay" to
        "Say what you expected and what happened instead. If it's about a specific " +
        "text or call, the customer's number and roughly when it happened is " +
        "usually all we need.",
    "settings.helpNoMailAppTitle" to "If that button doesn't open anything",
    "settings.helpNoMailAppIntro" to
        "Write to {email} from any email app and paste this in.",
    "settings.helpIdeaTitle" to "Got an idea?",
    "settings.helpIdeaIntro" to
        "Something we don't do yet, or do in a way that doesn't fit how you work.",
    "settings.helpIdeaAction" to "Send an idea",
    "settings.helpIdeaNote" to
        "This goes to the same place, under its own subject so it doesn't get " +
        "triaged as a fault. Half of what's in the product came from someone " +
        "describing their day.",
    "settings.helpFaqTitle" to "Common questions",
    "settings.helpFaqIntro" to "The things that confuse people most, answered straight.",
    "settings.helpExpectTitle" to "What to expect",
    "settings.helpExpectIntro" to
        "An honest answer rather than a promise we'd have to break.",
)

private val HELP_FR = mapOf(
    "settings.helpEmailTitle" to "Écrivez-nous",
    "settings.helpEmailIntro" to
        "Ouvre votre application de courriel avec les détails de votre espace de " +
        "travail déjà remplis, pour que nous puissions le retrouver sans vous le " +
        "demander.",
    "settings.helpEmailAction" to "Écrire à {email}",
    "settings.helpWhatToSay" to
        "Dites ce que vous attendiez et ce qui s'est passé à la place. S'il s'agit " +
        "d'un texto ou d'un appel précis, le numéro du client et le moment " +
        "approximatif nous suffisent en général.",
    "settings.helpNoMailAppTitle" to "Si ce bouton n'ouvre rien",
    "settings.helpNoMailAppIntro" to
        "Écrivez à {email} depuis n'importe quelle application de courriel et " +
        "collez ceci.",
    "settings.helpIdeaTitle" to "Une idée ?",
    "settings.helpIdeaIntro" to
        "Quelque chose que nous ne faisons pas encore, ou que nous faisons d'une " +
        "façon qui ne convient pas à votre travail.",
    "settings.helpIdeaAction" to "Envoyer une idée",
    "settings.helpIdeaNote" to
        "Cela arrive au même endroit, sous son propre objet, pour ne pas être " +
        "traité comme une panne. La moitié de ce qui est dans le produit vient de " +
        "quelqu'un qui nous a décrit sa journée.",
    "settings.helpFaqTitle" to "Questions fréquentes",
    "settings.helpFaqIntro" to
        "Ce qui déroute le plus les gens, expliqué franchement.",
    "settings.helpExpectTitle" to "À quoi vous attendre",
    "settings.helpExpectIntro" to
        "Une réponse honnête plutôt qu'une promesse que nous devrions rompre.",
)

// ---------------------------------------------------------------------------
// Settings → deleting your own account (#346, #371)
// ---------------------------------------------------------------------------

/**
 * `{word}` is the word that has to be typed, and it is NOT translated: the
 * comparison in `DeleteAccountCard` is against the literal `delete`, so a French
 * label naming a French word would ask for a word the check refuses.
 */
private val DELETE_ACCOUNT_EN = mapOf(
    "settings.deleteTitle" to "Delete your account",
    "settings.deleteIntro" to
        "Removes you from Loonext entirely. This cannot be undone.",
    "settings.deleteAction" to "Delete my account",
    "settings.deletePending" to "Deleting…",
    "settings.deleteChecking" to "Checking your account…",
    "settings.deletePreviewFailed" to
        "Couldn't check your account. Try again in a moment.",
    "settings.deleteFailed" to "Couldn't delete your account. Try again in a moment.",
    "settings.deleteBlockedByOwnership" to
        "You own {workspaces}. A workspace cannot be left without an owner, so hand " +
        "it to someone else or close it first — then you can delete your account.",
    "settings.deleteClosingIsElsewhere" to
        "Closing a workspace is on the workspace settings screen.",
    "settings.deleteSignedOut" to
        "You are signed out everywhere and cannot sign back in. Your name comes off " +
        "the app, and notifications stop.",
    "settings.deleteLeaveOne" to "You leave your workspace.",
    "settings.deleteLeaveOneOpenWork" to
        "You leave your workspace, and anything you are still working on goes back " +
        "to the crew so nothing is lost.",
    "settings.deleteLeaveMany" to "You leave all {count} of your workspaces.",
    "settings.deleteLeaveManyOpenWork" to
        "You leave all {count} of your workspaces, and anything you are still " +
        "working on goes back to the crew so nothing is lost.",
    "settings.deleteRecordStays" to
        "Texts you sent to customers, jobs you logged and notes you wrote stay with " +
        "the business. They have to — that record is theirs, and some of it we are " +
        "required by law to keep. They will no longer carry your name.",
    "settings.deleteConfirmationEmail" to
        "We email you a confirmation before your address is removed. It is the last " +
        "thing you will get from us, and it is worth keeping.",
    "settings.deleteConfirmTitle" to "Delete your account?",
    "settings.deleteConfirmBody" to
        "You will be signed out everywhere and will not be able to sign back in. " +
        "Your work stays with the business, without your name on it. Nobody can " +
        "undo this.",
    "settings.deleteTypeToConfirm" to "Type {word} to confirm",
    "settings.deleteKeep" to "Keep my account",
)

private val DELETE_ACCOUNT_FR = mapOf(
    "settings.deleteTitle" to "Supprimer votre compte",
    "settings.deleteIntro" to
        "Vous retire entièrement de Loonext. Cette action est irréversible.",
    "settings.deleteAction" to "Supprimer mon compte",
    "settings.deletePending" to "Suppression…",
    "settings.deleteChecking" to "Vérification de votre compte…",
    "settings.deletePreviewFailed" to
        "Impossible de vérifier votre compte. Réessayez dans un moment.",
    "settings.deleteFailed" to
        "Impossible de supprimer votre compte. Réessayez dans un moment.",
    "settings.deleteBlockedByOwnership" to
        "Vous êtes propriétaire de {workspaces}. Un espace de travail ne peut pas " +
        "rester sans propriétaire : confiez-le à quelqu'un d'autre ou fermez-le " +
        "d'abord — vous pourrez ensuite supprimer votre compte.",
    "settings.deleteClosingIsElsewhere" to
        "La fermeture d'un espace de travail se fait dans les paramètres de " +
        "l'espace de travail.",
    "settings.deleteSignedOut" to
        "Vous êtes déconnecté partout et ne pourrez plus vous reconnecter. Votre nom " +
        "est retiré de l'application et les notifications cessent.",
    "settings.deleteLeaveOne" to "Vous quittez votre espace de travail.",
    "settings.deleteLeaveOneOpenWork" to
        "Vous quittez votre espace de travail, et tout ce sur quoi vous travaillez " +
        "encore retourne à l'équipe pour que rien ne se perde.",
    "settings.deleteLeaveMany" to "Vous quittez vos {count} espaces de travail.",
    "settings.deleteLeaveManyOpenWork" to
        "Vous quittez vos {count} espaces de travail, et tout ce sur quoi vous " +
        "travaillez encore retourne à l'équipe pour que rien ne se perde.",
    "settings.deleteRecordStays" to
        "Les textos envoyés aux clients, les travaux consignés et les notes que vous " +
        "avez écrites restent à l'entreprise. C'est obligatoire : ce dossier lui " +
        "appartient, et la loi nous oblige à en conserver une partie. Votre nom n'y " +
        "figurera plus.",
    "settings.deleteConfirmationEmail" to
        "Nous vous envoyons une confirmation par courriel avant de retirer votre " +
        "adresse. C'est la dernière chose que vous recevrez de nous, et elle vaut la " +
        "peine d'être conservée.",
    "settings.deleteConfirmTitle" to "Supprimer votre compte ?",
    "settings.deleteConfirmBody" to
        "Vous serez déconnecté partout et ne pourrez plus vous reconnecter. Votre " +
        "travail reste à l'entreprise, sans votre nom. Personne ne peut annuler ceci.",
    "settings.deleteTypeToConfirm" to "Tapez {word} pour confirmer",
    "settings.deleteKeep" to "Garder mon compte",
)

// ---------------------------------------------------------------------------
// Settings → emergency words and reply (#460, #553)
// ---------------------------------------------------------------------------

/**
 * URGENT stays URGENT in the French. It is the word a CUSTOMER texts, matched
 * on the wire against the workspace's keyword list — translating the example
 * would teach a Quebec owner to expect a word the matcher never sees.
 *
 * `{line}` is `EMERGENCY_SAFETY_LINE`, which is likewise not translated here:
 * it is the sentence the SERVER appends to an outgoing text, mirrored from
 * shared, and this screen only quotes it back.
 */
private val EMERGENCY_EN = mapOf(
    "settings.emergencyTitle" to "Emergency words and reply",
    "settings.emergencyIntro" to
        "Which words a customer can text to reach the whole crew straight away, and " +
        "what goes back to them automatically.",
    "settings.emergencyWordsHeading" to "Words that count as an emergency",
    "settings.emergencyWordsHelp" to
        "Matched on the first word a customer sends, so \"URGENT no heat\" counts. " +
        "Use the words your customers would actually reach for.",
    "settings.emergencyWordChip" to "{word}  ×",
    "settings.emergencyDuplicateWord" to "{word} is already on the list.",
    "settings.emergencyTooManyWords" to
        "Ten words is the limit — past that it stops being an emergency.",
    "settings.emergencyKeepOneWord" to
        "Keep at least one word. To stop treating replies as emergencies, turn the " +
        "switch off above.",
    "settings.emergencyAddWordLabel" to "Add a word",
    "settings.emergencyAddWordPlaceholder" to "LOCKEDOUT",
    "settings.emergencyAddWordAction" to "Add",
    "settings.emergencyDefaults" to
        "These are the defaults. Change them and only your words are watched for.",
    "settings.emergencyReplyHeading" to "Automatic reply",
    "settings.emergencyTextBack" to "Text the customer back",
    "settings.emergencyTextBackHelp" to
        "Off means we still alert the crew and flag the thread — we just don't " +
        "message the customer for you.",
    "settings.emergencyReplyHelp" to
        "Sent once per hour, at most, to a customer who texts one of these words. " +
        "Say what is true for your business.",
    "settings.emergencyCount" to "{count}/1000",
    "settings.emergencyCountDefault" to "{count}/1000 · using the default",
    "settings.emergencyPreviewLabel" to "What the customer receives",
    "settings.emergencySafetyLineNote" to
        "\"{line}\" is always added and can't be edited. You decide what is " +
        "promised; whether someone in danger is told where else to turn isn't ours " +
        "to leave out.",
    "settings.emergencySaveAction" to "Save emergency settings",
    "settings.emergencySaved" to "Emergency settings saved.",
    "settings.emergencyReadOnly" to
        "Only owners and admins can change emergency settings.",
)

private val EMERGENCY_FR = mapOf(
    "settings.emergencyTitle" to "Mots d'urgence et réponse",
    "settings.emergencyIntro" to
        "Quels mots un client peut envoyer par texto pour joindre toute l'équipe " +
        "immédiatement, et ce qui lui est renvoyé automatiquement.",
    "settings.emergencyWordsHeading" to "Les mots qui comptent comme une urgence",
    "settings.emergencyWordsHelp" to
        "La correspondance se fait sur le premier mot envoyé par le client : " +
        "« URGENT pas de chauffage » compte donc. Utilisez les mots auxquels vos " +
        "clients penseraient vraiment.",
    "settings.emergencyWordChip" to "{word}  ×",
    "settings.emergencyDuplicateWord" to "{word} est déjà dans la liste.",
    "settings.emergencyTooManyWords" to
        "Dix mots, c'est la limite — au-delà, ce n'est plus une urgence.",
    "settings.emergencyKeepOneWord" to
        "Gardez au moins un mot. Pour cesser de traiter les réponses comme des " +
        "urgences, désactivez l'interrupteur ci-dessus.",
    "settings.emergencyAddWordLabel" to "Ajouter un mot",
    "settings.emergencyAddWordPlaceholder" to "SANSCHAUFFAGE",
    "settings.emergencyAddWordAction" to "Ajouter",
    "settings.emergencyDefaults" to
        "Ce sont les mots par défaut. Modifiez-les et seuls vos mots seront surveillés.",
    "settings.emergencyReplyHeading" to "Réponse automatique",
    "settings.emergencyTextBack" to "Répondre au client par texto",
    "settings.emergencyTextBackHelp" to
        "Désactivée, nous alertons quand même l'équipe et signalons la conversation " +
        "— nous n'écrivons simplement pas au client à votre place.",
    "settings.emergencyReplyHelp" to
        "Envoyée au plus une fois par heure au client qui écrit l'un de ces mots. " +
        "Dites ce qui est vrai pour votre entreprise.",
    "settings.emergencyCount" to "{count}/1000",
    "settings.emergencyCountDefault" to "{count}/1000 · valeur par défaut utilisée",
    "settings.emergencyPreviewLabel" to "Ce que le client reçoit",
    "settings.emergencySafetyLineNote" to
        "« {line} » est toujours ajoutée et ne peut pas être modifiée. Vous décidez " +
        "de ce qui est promis ; dire à une personne en danger vers qui d'autre se " +
        "tourner n'est pas à nous de l'omettre.",
    "settings.emergencySaveAction" to "Enregistrer les réglages d'urgence",
    "settings.emergencySaved" to "Réglages d'urgence enregistrés.",
    "settings.emergencyReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier les " +
        "réglages d'urgence.",
)

// ---------------------------------------------------------------------------
// Settings → signed-in devices, app lock and mobile data (#236, #289, #330)
// ---------------------------------------------------------------------------

/**
 * Every count sentence exists TWICE — one device and several — rather than
 * dropping a "3 devices" phrase into a shared stem. `deviceCountLabel` builds
 * that phrase in English only, so the shared-stem version would have printed an
 * English fragment in the middle of a French warning about somebody's phone.
 */
private val DEVICES_EN = mapOf(
    "settings.devicesMineTitle" to "Your devices",
    "settings.devicesMineIntro" to
        "Anything signed in as you, in any workspace. Signing one out takes effect " +
        "on its next tap.",
    "settings.devicesNoneSignedIn" to
        "Nothing is signed in — which cannot be true, since you are reading this. " +
        "Pull to refresh and check again.",
    "settings.devicesLocationUnknown" to "Location not available",
    "settings.devicesThisDevice" to "This device",
    "settings.devicesLastActive" to "Last active {lastActive} · signed in {signedIn}",
    "settings.devicesSignOut" to "Sign out",
    "settings.devicesSignedOutThatOne" to "Signed that device out.",
    "settings.devicesSignOutEverywhere" to "Sign out everywhere else",
    "settings.devicesSignOutEverywhereTitle" to "Sign out everywhere else?",
    "settings.devicesSignOutEverywhereBodyOne" to
        "1 device will stop working on the next tap, and stop receiving your " +
        "customers' messages. You stay signed in here. Anyone who should still have " +
        "access can sign back in.",
    "settings.devicesSignOutEverywhereBody" to
        "{count} devices will stop working on the next tap, and stop receiving your " +
        "customers' messages. You stay signed in here. Anyone who should still have " +
        "access can sign back in.",
    "settings.devicesSignThemOut" to "Sign them out",
    "settings.devicesNothingElseSignedIn" to "Nothing else was signed in.",
    "settings.devicesSignedOutOne" to "Signed out 1 device.",
    "settings.devicesSignedOutMany" to "Signed out {count} devices.",
    "settings.devicesCrewTitle" to "The crew's devices",
    "settings.devicesCrewIntro" to
        "Everything signed in to this workspace. Removing someone already ends " +
        "their access — this is for a phone that went missing while they are still " +
        "on the team.",
    "settings.devicesCrewNoneSignedIn" to
        "Nobody on the crew has anything signed in right now.",
    "settings.devicesCrewMemberFallback" to "A crew member",
    "settings.devicesSignMemberOutTitle" to "Sign {name} out?",
    // Byte-identical to what `deviceCountLabel(1)` used to produce in this
    // sentence, awkward dash and all. Splitting the plural out is forced (French
    // agrees the verb), but rewording the English while doing it would be a copy
    // change smuggled in under an extraction.
    "settings.devicesSignMemberOutBodyOne" to
        "Every device they are signed in on — 1 device right now — stops working on " +
        "its next tap and stops receiving this workspace's messages. They keep " +
        "their seat and can sign back in; a call they are on right now is not cut off.",
    "settings.devicesSignMemberOutBody" to
        "Every device they are signed in on — {count} right now — stops working on " +
        "its next tap and stops receiving this workspace's messages. They keep " +
        "their seat and can sign back in; a call they are on right now is not cut off.",
    "settings.devicesTheyHadNothing" to "They had nothing signed in.",
    "settings.devicesSignedMemberOutOne" to "Signed {name} out of 1 device.",
    "settings.devicesSignedMemberOutMany" to "Signed {name} out of {count} devices.",
    "settings.devicesThisPhoneOnly" to
        "This phone only. Your other devices keep their own answer.",
    "settings.devicesAppLockTitle" to "Lock this app",
    "settings.devicesAppLockLabel" to "Ask before showing the inbox",
    "settings.devicesAppLockHelp" to
        "Your fingerprint, face or screen lock, whenever the app has been away for " +
        "a minute. Worth it if this phone is ever handed to somebody else.",
    "settings.devicesMobileDataTitle" to "Mobile data",
)

private val DEVICES_FR = mapOf(
    "settings.devicesMineTitle" to "Vos appareils",
    "settings.devicesMineIntro" to
        "Tout ce qui est connecté en votre nom, dans n'importe quel espace de " +
        "travail. La déconnexion d'un appareil prend effet à sa prochaine touche.",
    "settings.devicesNoneSignedIn" to
        "Rien n'est connecté — ce qui ne peut pas être vrai, puisque vous lisez " +
        "ceci. Tirez pour actualiser et vérifiez de nouveau.",
    "settings.devicesLocationUnknown" to "Lieu non disponible",
    "settings.devicesThisDevice" to "Cet appareil",
    "settings.devicesLastActive" to
        "Dernière activité {lastActive} · connecté {signedIn}",
    "settings.devicesSignOut" to "Déconnecter",
    "settings.devicesSignedOutThatOne" to "Cet appareil a été déconnecté.",
    "settings.devicesSignOutEverywhere" to "Déconnecter partout ailleurs",
    "settings.devicesSignOutEverywhereTitle" to "Déconnecter partout ailleurs ?",
    "settings.devicesSignOutEverywhereBodyOne" to
        "1 appareil cessera de fonctionner à la prochaine touche et cessera de " +
        "recevoir les textos de vos clients. Vous restez connecté ici. Quiconque " +
        "doit garder l'accès peut se reconnecter.",
    "settings.devicesSignOutEverywhereBody" to
        "{count} appareils cesseront de fonctionner à la prochaine touche et " +
        "cesseront de recevoir les textos de vos clients. Vous restez connecté ici. " +
        "Quiconque doit garder l'accès peut se reconnecter.",
    "settings.devicesSignThemOut" to "Les déconnecter",
    "settings.devicesNothingElseSignedIn" to "Rien d'autre n'était connecté.",
    "settings.devicesSignedOutOne" to "1 appareil déconnecté.",
    "settings.devicesSignedOutMany" to "{count} appareils déconnectés.",
    "settings.devicesCrewTitle" to "Les appareils de l'équipe",
    "settings.devicesCrewIntro" to
        "Tout ce qui est connecté à cet espace de travail. Retirer quelqu'un met " +
        "déjà fin à son accès — ceci sert au téléphone égaré d'une personne " +
        "toujours dans l'équipe.",
    "settings.devicesCrewNoneSignedIn" to
        "Personne dans l'équipe n'a d'appareil connecté en ce moment.",
    "settings.devicesCrewMemberFallback" to "Un membre de l'équipe",
    "settings.devicesSignMemberOutTitle" to "Déconnecter {name} ?",
    "settings.devicesSignMemberOutBodyOne" to
        "Chaque appareil sur lequel cette personne est connectée — 1 appareil en ce " +
        "moment — cessera de fonctionner à sa prochaine touche et cessera de " +
        "recevoir les textos de cet espace de travail. Elle garde sa place et peut " +
        "se reconnecter ; un appel en cours n'est pas coupé.",
    "settings.devicesSignMemberOutBody" to
        "Chaque appareil sur lequel cette personne est connectée — {count} en ce " +
        "moment — cessera de fonctionner à sa prochaine touche et cessera de " +
        "recevoir les textos de cet espace de travail. Elle garde sa place et peut " +
        "se reconnecter ; un appel en cours n'est pas coupé.",
    "settings.devicesTheyHadNothing" to "Cette personne n'avait rien de connecté.",
    "settings.devicesSignedMemberOutOne" to "{name} a été déconnecté de 1 appareil.",
    "settings.devicesSignedMemberOutMany" to
        "{name} a été déconnecté de {count} appareils.",
    "settings.devicesThisPhoneOnly" to
        "Ce téléphone seulement. Vos autres appareils gardent leur propre réglage.",
    "settings.devicesAppLockTitle" to "Verrouiller cette application",
    "settings.devicesAppLockLabel" to "Demander avant d'afficher la boîte de réception",
    "settings.devicesAppLockHelp" to
        "Votre empreinte, votre visage ou le verrouillage de l'écran, dès que " +
        "l'application a été mise de côté une minute. Utile si ce téléphone est " +
        "parfois remis à quelqu'un d'autre.",
    "settings.devicesMobileDataTitle" to "Données mobiles",
)

// ---------------------------------------------------------------------------
// Settings → business hours and away reply (#157, #414, #453, #460)
// ---------------------------------------------------------------------------

/**
 * `{first_name}` and `{business_name}` inside `settings.awayCount` are MERGE
 * FIELDS, not catalogue tokens: they are the literal words an owner types into
 * the away message, so they read the same in both languages and are left
 * untouched by the interpolator (an unknown token stays visible on purpose).
 */
private val HOURS_EN = mapOf(
    "settings.hoursTitle" to "Business hours",
    "settings.hoursIntro" to
        "When you're open, in {timezone}. Texts that arrive outside these hours can " +
        "get your away reply. This is separate from each customer's texting quiet " +
        "hours.",
    "settings.hoursInvalid" to
        "Times are 24-hour HH:MM, and open and close can't match.",
    "settings.hoursSaveAction" to "Save hours",
    "settings.hoursSaved" to "Business hours saved.",
    "settings.hoursReadOnly" to "Only owners and admins can change business hours.",
    "settings.hoursOpen" to "Open",
    "settings.hoursClose" to "Close",
    "settings.hoursTo" to "to",
    "settings.hoursClosed" to "Closed",
    "settings.awayTitle" to "Away reply",
    "settings.awayIntro" to
        "One automatic text back when someone reaches you outside your business " +
        "hours, in your words, so you never lose an after-hours emergency.",
    "settings.awayEnable" to "Reply automatically after hours",
    "settings.awayEnableHelp" to
        "Fires once per conversation when a customer first texts outside your hours.",
    "settings.awayUsTextingOff" to
        "Customers with US numbers won't get this reply: US texting isn't on for " +
        "this workspace. Canadian numbers get it now.",
    "settings.awayUsPending" to
        "Customers with US numbers won't get this reply until your registration is " +
        "approved. Canadian numbers get it now.",
    "settings.awayCount" to
        "{count}/1000 · {first_name} and {business_name} fill in automatically.",
    "settings.awayEmergencySwitch" to "Treat an emergency word as an emergency",
    "settings.awayEmergencySwitchHelp" to
        "Texts back starting with {words} reach everyone on the crew straight away, " +
        "at the priority that wakes a phone — no away reply, and never held back by " +
        "your daily notification limit.",
    "settings.awayPreviewLabel" to "Preview",
    "settings.awayNeedsMessage" to "Write your away message before turning it on.",
    "settings.awaySaveAction" to "Save away reply",
    "settings.awaySaved" to "Away reply saved.",
    "settings.awayReadOnly" to "Only owners and admins can change the away reply.",
)

private val HOURS_FR = mapOf(
    "settings.hoursTitle" to "Heures d'ouverture",
    "settings.hoursIntro" to
        "Vos heures d'ouverture, selon {timezone}. Les textos qui arrivent en dehors " +
        "de ces heures peuvent recevoir votre réponse d'absence. C'est distinct des " +
        "heures de silence propres à chaque client.",
    "settings.hoursInvalid" to
        "Les heures s'écrivent HH:MM sur 24 heures, et l'ouverture ne peut pas être " +
        "identique à la fermeture.",
    "settings.hoursSaveAction" to "Enregistrer les heures",
    "settings.hoursSaved" to "Heures d'ouverture enregistrées.",
    "settings.hoursReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier les heures " +
        "d'ouverture.",
    "settings.hoursOpen" to "Ouverture",
    "settings.hoursClose" to "Fermeture",
    "settings.hoursTo" to "à",
    "settings.hoursClosed" to "Fermé",
    "settings.awayTitle" to "Réponse d'absence",
    "settings.awayIntro" to
        "Un texto automatique en retour quand quelqu'un vous joint en dehors de vos " +
        "heures d'ouverture, dans vos mots, pour ne jamais perdre une urgence après " +
        "les heures.",
    "settings.awayEnable" to "Répondre automatiquement après les heures",
    "settings.awayEnableHelp" to
        "Part une seule fois par conversation, au premier texto d'un client en " +
        "dehors de vos heures.",
    "settings.awayUsTextingOff" to
        "Les clients avec un numéro américain ne recevront pas cette réponse : les " +
        "textos vers les États-Unis ne sont pas activés pour cet espace de travail. " +
        "Les numéros canadiens la reçoivent dès maintenant.",
    "settings.awayUsPending" to
        "Les clients avec un numéro américain ne recevront pas cette réponse tant " +
        "que votre inscription n'est pas approuvée. Les numéros canadiens la " +
        "reçoivent dès maintenant.",
    "settings.awayCount" to
        "{count}/1000 · {first_name} et {business_name} se remplissent automatiquement.",
    "settings.awayEmergencySwitch" to "Traiter un mot d'urgence comme une urgence",
    "settings.awayEmergencySwitchHelp" to
        "Les textos qui commencent par {words} joignent immédiatement toute " +
        "l'équipe, à la priorité qui réveille un téléphone — sans réponse d'absence, " +
        "et jamais retenus par votre limite quotidienne de notifications.",
    "settings.awayPreviewLabel" to "Aperçu",
    "settings.awayNeedsMessage" to
        "Écrivez votre message d'absence avant de l'activer.",
    "settings.awaySaveAction" to "Enregistrer la réponse d'absence",
    "settings.awaySaved" to "Réponse d'absence enregistrée.",
    "settings.awayReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier la réponse " +
        "d'absence.",
)

// ---------------------------------------------------------------------------
// Settings → Calling (#157, #193, #278, #309)
// ---------------------------------------------------------------------------

private val CALLING_EN = mapOf(
    "settings.callingHostedOnly" to
        "In-app calling needs a number whose calls come through Loonext. Calls to " +
        "your text-enabled landline stay with your existing carrier, so these " +
        "settings won't apply until you add or transfer a Loonext number.",

    "settings.textBackTitle" to "Text back a missed call",
    "settings.textBackIntro" to
        "When a call to your business number goes unanswered, we send the caller " +
        "one text so they can book by reply, instead of calling the next number on " +
        "their list.",
    "settings.textBackSwitch" to "Text back missed calls",
    "settings.textBackSwitchHelp" to
        "Fires once per caller when a call goes unanswered.",
    "settings.textBackUsTextingOff" to
        "Callers with US numbers won't get this text: US texting isn't on for this " +
        "workspace. Canadian callers get it now.",
    "settings.textBackUsPending" to
        "Callers with US numbers won't get this text until your registration is " +
        "approved. Canadian callers get it now.",
    "settings.textBackHint" to
        "Leave it empty to send the default. {business_name} fills in automatically.",
    "settings.textBackStatusSaving" to " · Saving…",
    "settings.textBackStatusSaved" to " · Saved",
    "settings.textBackPreviewLabel" to "What the caller receives",
    "settings.textBackReadOnly" to
        "Only owners and admins can change the missed-call text-back.",

    "settings.voicemailTitle" to "Voicemail greeting",
    "settings.voicemailIntro" to
        "When nobody answers in the app, the caller hears this greeting and can " +
        "leave a message up to two minutes. Voicemails land in the call log and the " +
        "caller's conversation, ready to play.",
    "settings.voicemailCount" to
        "{count}/500 · Spoken aloud to the caller. Leave it empty to use the default.",
    "settings.voicemailPreviewLabel" to "What callers hear",
    "settings.voicemailSaveAction" to "Save greeting",
    "settings.voicemailSaved" to "Voicemail greeting saved.",
    "settings.voicemailReadOnly" to
        "Only owners and admins can change the voicemail greeting.",

    "settings.screeningTitle" to "Call screening",
    "settings.screeningIntro" to
        "What happens when the carrier thinks an incoming call is spam.",
    "settings.screeningOff" to "Off",
    "settings.screeningFlag" to "Label suspicious calls",
    "settings.screeningFlagDetail" to
        "The carrier's verdict shows on the call as “Spam likely”, but every call " +
        "still rings the team.",
    "settings.screeningDivert" to "Send suspicious calls to voicemail",
    "settings.screeningDivertDetail" to
        "Flagged callers skip the ring and go straight to voicemail. A real customer " +
        "who gets misflagged can still leave a message.",
    "settings.screeningUpdated" to "Call screening updated.",
    "settings.screeningReadOnly" to "Only owners and admins can change call screening.",

    "settings.ringTitle" to "How the phones ring",
    "settings.ringIntro" to
        "When a call comes in, every phone on the crew can ring together, or they " +
        "can join one at a time so whoever answers most gets first refusal.",
    "settings.ringAll" to "All at once",
    "settings.ringAllDetail" to
        "What happens today. Every phone on the crew rings for the whole time, and " +
        "the first to pick up takes the call.",
    "settings.ringInTurn" to "One at a time",
    "settings.ringInTurnDetail" to
        "The longest-serving member's phone rings first, alone. Twelve seconds later " +
        "the next joins them, then the next — nobody's phone is ever cut off mid-reach.",
    "settings.ringHowLong" to "How long they ring",
    "settings.ringSecondsLabel" to "{seconds} seconds · about {rings} rings",
    "settings.ringInTurnNoteOne" to
        "Then the caller gets your greeting. In {seconds} seconds, 1 phone gets a " +
        "turn — anyone after that never rings on this line.",
    "settings.ringInTurnNote" to
        "Then the caller gets your greeting. In {seconds} seconds, {phones} phones " +
        "get a turn — anyone after that never rings on this line.",
    "settings.ringAllNote" to
        "Then the caller gets your greeting. Longer than 45 seconds isn't offered: " +
        "the call legs themselves end there, so it would be ringing nobody could hear.",
    "settings.ringUpdated" to "Ringing updated.",
    "settings.ringLengthUpdated" to "Ring length updated.",
    "settings.ringReadOnly" to "Only owners and admins can change how the phones ring.",

    "settings.afterHoursTitle" to "After hours",
    "settings.afterHoursIntro" to
        "Outside your business hours a call can ring everyone, ring only whoever's " +
        "on call, or go straight to a message. Most small crews are best on the " +
        "first one.",
    "settings.afterHoursNoHours" to
        "You haven't set business hours yet, so nothing here can happen — every hour " +
        "is a working hour until you do. Set them under Hours.",
    "settings.afterHoursRingEveryone" to "Ring everyone, day or night",
    "settings.afterHoursRingEveryoneDetail" to
        "What happens today. Every call rings the whole crew whatever the clock says.",
    "settings.afterHoursOnCallOnly" to "Ring only whoever's on call",
    "settings.afterHoursOnCallOnlyDetail" to
        "After hours, the phone rings for the person holding the on-call shift and " +
        "nobody else. With no shift set, everyone rings — we never leave a call " +
        "reaching nobody.",
    "settings.afterHoursVoicemail" to "Take a message",
    "settings.afterHoursVoicemailDetail" to
        "After hours, the caller goes straight to your greeting instead of ringing " +
        "out first — unless somebody is on call, who still rings.",
    "settings.afterHoursUpdated" to "After-hours calling updated.",
    "settings.afterHoursReadOnly" to
        "Only owners and admins can change after-hours calling.",

    "settings.callerIdTitle" to "Caller ID",
    "settings.callerIdIntro" to
        "What people see when you call them, and what you see when they call you.",
    "settings.callerIdOutboundHeading" to "Your outbound display name",
    "settings.callerIdNone" to "No display name",
    "settings.callerIdUsingCompanyName" to "Using your company name",
    "settings.callerIdCustom" to "Custom display name",
    "settings.callerIdChange" to "Change",
    "settings.callerIdPending" to
        "Caller ID update submitted. Carriers usually show the new name within 1 to " +
        "3 days.",
    "settings.callerIdNewNameLabel" to "New display name",
    "settings.callerIdNewNameHelp" to
        "Shown on US caller ID when you call customers. Letters, digits, and spaces, " +
        "15 characters max. Canadian display names are set by the receiving carrier, " +
        "so this mainly helps your US calls.",
    "settings.callerIdInvalid" to "1 to 15 letters, digits, or spaces.",
    "settings.callerIdInvalidError" to
        "The display name must be 1 to 15 letters, digits, or spaces.",
    "settings.callerIdUseCompanyName" to "Use company name instead",
    "settings.callerIdReview" to "Review change",
    "settings.callerIdConfirm" to "Update your caller ID to \"{name}\"?",
    "settings.callerIdConfirmCompanyName" to
        "Update your caller ID to \"{name}\" (your company name)?",
    "settings.callerIdConfirmNote" to
        "Carriers refresh their name databases on their own schedule, so the new " +
        "name can take a few days to show on calls.",
    "settings.callerIdSubmit" to "Update caller ID",
    "settings.callerIdSubmitting" to "Submitting…",
    "settings.callerIdSubmitted" to "Caller ID update submitted to carriers.",
    "settings.callerIdGoBack" to "Go back",
    "settings.callerIdLookup" to "Look up who's calling",
    "settings.callerIdLookupHelp" to
        "Shows the caller's network-registered name on incoming calls when they " +
        "aren't in your contacts yet.",
    "settings.callerIdReadOnly" to
        "Only owners and admins can change caller ID settings.",

    "settings.minutesFooter" to
        "Your plan includes {minutes} calling minutes a month, both directions. " +
        "Details live in Settings › Usage.",
    "settings.minutesFooterOverage" to
        "Your plan includes {minutes} calling minutes a month, both directions. Past " +
        "that, extra minutes bill at 1¢ each up to your spending cap. Details live " +
        "in Settings › Usage.",
)

private val CALLING_FR = mapOf(
    "settings.callingHostedOnly" to
        "Les appels dans l'application exigent un numéro dont les appels passent par " +
        "Loonext. Les appels vers votre ligne fixe compatible texto restent chez " +
        "votre fournisseur actuel : ces réglages ne s'appliqueront donc pas tant que " +
        "vous n'aurez pas ajouté ou transféré un numéro Loonext.",

    "settings.textBackTitle" to "Répondre par texto à un appel manqué",
    "settings.textBackIntro" to
        "Quand un appel à votre numéro d'entreprise reste sans réponse, nous " +
        "envoyons un seul texto à l'appelant pour qu'il puisse réserver en " +
        "répondant, au lieu d'appeler le numéro suivant sur sa liste.",
    "settings.textBackSwitch" to "Répondre par texto aux appels manqués",
    "settings.textBackSwitchHelp" to
        "Part une seule fois par appelant lorsqu'un appel reste sans réponse.",
    "settings.textBackUsTextingOff" to
        "Les appelants avec un numéro américain ne recevront pas ce texto : les " +
        "textos vers les États-Unis ne sont pas activés pour cet espace de travail. " +
        "Les appelants canadiens le reçoivent dès maintenant.",
    "settings.textBackUsPending" to
        "Les appelants avec un numéro américain ne recevront pas ce texto tant que " +
        "votre inscription n'est pas approuvée. Les appelants canadiens le reçoivent " +
        "dès maintenant.",
    "settings.textBackHint" to
        "Laissez vide pour envoyer le message par défaut. {business_name} se remplit " +
        "automatiquement.",
    "settings.textBackStatusSaving" to " · Enregistrement…",
    "settings.textBackStatusSaved" to " · Enregistré",
    "settings.textBackPreviewLabel" to "Ce que l'appelant reçoit",
    "settings.textBackReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier la réponse " +
        "aux appels manqués.",

    "settings.voicemailTitle" to "Message d'accueil de la boîte vocale",
    "settings.voicemailIntro" to
        "Quand personne ne répond dans l'application, l'appelant entend ce message " +
        "d'accueil et peut laisser un message d'au plus deux minutes. Les messages " +
        "vocaux arrivent dans le journal d'appels et dans la conversation de " +
        "l'appelant, prêts à être écoutés.",
    "settings.voicemailCount" to
        "{count}/500 · Lu à voix haute à l'appelant. Laissez vide pour utiliser le " +
        "message par défaut.",
    "settings.voicemailPreviewLabel" to "Ce que les appelants entendent",
    "settings.voicemailSaveAction" to "Enregistrer le message d'accueil",
    "settings.voicemailSaved" to "Message d'accueil enregistré.",
    "settings.voicemailReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier le message " +
        "d'accueil de la boîte vocale.",

    "settings.screeningTitle" to "Filtrage des appels",
    "settings.screeningIntro" to
        "Ce qui se passe quand le fournisseur juge qu'un appel entrant est du " +
        "pourriel.",
    "settings.screeningOff" to "Désactivé",
    "settings.screeningFlag" to "Signaler les appels suspects",
    "settings.screeningFlagDetail" to
        "Le verdict du fournisseur s'affiche sur l'appel comme « Pourriel probable », " +
        "mais chaque appel fait quand même sonner l'équipe.",
    "settings.screeningDivert" to "Envoyer les appels suspects à la boîte vocale",
    "settings.screeningDivertDetail" to
        "Les appelants signalés ne font pas sonner et vont directement à la boîte " +
        "vocale. Un vrai client signalé par erreur peut quand même laisser un message.",
    "settings.screeningUpdated" to "Filtrage des appels mis à jour.",
    "settings.screeningReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier le filtrage " +
        "des appels.",

    "settings.ringTitle" to "Comment les téléphones sonnent",
    "settings.ringIntro" to
        "Quand un appel entre, tous les téléphones de l'équipe peuvent sonner " +
        "ensemble, ou se joindre un à la fois pour que la personne qui répond le " +
        "plus souvent ait le premier choix.",
    "settings.ringAll" to "Tous en même temps",
    "settings.ringAllDetail" to
        "Ce qui se passe aujourd'hui. Chaque téléphone de l'équipe sonne pendant " +
        "toute la durée, et la première personne à décrocher prend l'appel.",
    "settings.ringInTurn" to "Un à la fois",
    "settings.ringInTurnDetail" to
        "Le téléphone du membre le plus ancien sonne en premier, seul. Douze " +
        "secondes plus tard, le suivant se joint à lui, puis le suivant — le " +
        "téléphone de personne n'est jamais coupé en pleine sonnerie.",
    "settings.ringHowLong" to "Durée de la sonnerie",
    "settings.ringSecondsLabel" to "{seconds} secondes · environ {rings} sonneries",
    "settings.ringInTurnNoteOne" to
        "Ensuite, l'appelant entend votre message d'accueil. En {seconds} secondes, " +
        "1 téléphone a son tour — les suivants ne sonnent jamais sur cette ligne.",
    "settings.ringInTurnNote" to
        "Ensuite, l'appelant entend votre message d'accueil. En {seconds} secondes, " +
        "{phones} téléphones ont leur tour — les suivants ne sonnent jamais sur " +
        "cette ligne.",
    "settings.ringAllNote" to
        "Ensuite, l'appelant entend votre message d'accueil. Au-delà de 45 secondes, " +
        "ce n'est pas offert : les segments d'appel se terminent là, la sonnerie ne " +
        "serait donc entendue par personne.",
    "settings.ringUpdated" to "Sonnerie mise à jour.",
    "settings.ringLengthUpdated" to "Durée de sonnerie mise à jour.",
    "settings.ringReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier la façon " +
        "dont les téléphones sonnent.",

    "settings.afterHoursTitle" to "Après les heures",
    "settings.afterHoursIntro" to
        "En dehors de vos heures d'ouverture, un appel peut faire sonner tout le " +
        "monde, ne faire sonner que la personne de garde, ou aller directement à un " +
        "message. La première option convient à la plupart des petites équipes.",
    "settings.afterHoursNoHours" to
        "Vous n'avez pas encore défini d'heures d'ouverture : rien ici ne peut donc " +
        "se produire — chaque heure est une heure de travail tant que ce n'est pas " +
        "fait. Définissez-les sous Heures d'ouverture.",
    "settings.afterHoursRingEveryone" to "Faire sonner tout le monde, jour et nuit",
    "settings.afterHoursRingEveryoneDetail" to
        "Ce qui se passe aujourd'hui. Chaque appel fait sonner toute l'équipe, peu " +
        "importe l'heure.",
    "settings.afterHoursOnCallOnly" to "Ne faire sonner que la personne de garde",
    "settings.afterHoursOnCallOnlyDetail" to
        "Après les heures, le téléphone sonne pour la personne qui assure la garde " +
        "et pour personne d'autre. Sans garde définie, tout le monde sonne — nous ne " +
        "laissons jamais un appel n'atteindre personne.",
    "settings.afterHoursVoicemail" to "Prendre un message",
    "settings.afterHoursVoicemailDetail" to
        "Après les heures, l'appelant entend directement votre message d'accueil au " +
        "lieu de faire sonner d'abord — sauf si quelqu'un est de garde, auquel cas " +
        "son téléphone sonne.",
    "settings.afterHoursUpdated" to "Appels après les heures mis à jour.",
    "settings.afterHoursReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier les appels " +
        "après les heures.",

    "settings.callerIdTitle" to "Afficheur",
    "settings.callerIdIntro" to
        "Ce que les gens voient quand vous les appelez, et ce que vous voyez quand " +
        "ils vous appellent.",
    "settings.callerIdOutboundHeading" to "Votre nom d'affichage sortant",
    "settings.callerIdNone" to "Aucun nom d'affichage",
    "settings.callerIdUsingCompanyName" to "Le nom de votre entreprise est utilisé",
    "settings.callerIdCustom" to "Nom d'affichage personnalisé",
    "settings.callerIdChange" to "Modifier",
    "settings.callerIdPending" to
        "Mise à jour de l'afficheur soumise. Les fournisseurs affichent " +
        "habituellement le nouveau nom en 1 à 3 jours.",
    "settings.callerIdNewNameLabel" to "Nouveau nom d'affichage",
    "settings.callerIdNewNameHelp" to
        "Affiché sur l'afficheur américain quand vous appelez des clients. Lettres, " +
        "chiffres et espaces, 15 caractères au maximum. Les noms d'affichage " +
        "canadiens sont fixés par le fournisseur qui reçoit l'appel : ceci aide donc " +
        "surtout vos appels vers les États-Unis.",
    "settings.callerIdInvalid" to "De 1 à 15 lettres, chiffres ou espaces.",
    "settings.callerIdInvalidError" to
        "Le nom d'affichage doit compter de 1 à 15 lettres, chiffres ou espaces.",
    "settings.callerIdUseCompanyName" to "Utiliser plutôt le nom de l'entreprise",
    "settings.callerIdReview" to "Réviser la modification",
    "settings.callerIdConfirm" to "Remplacer votre afficheur par « {name} » ?",
    "settings.callerIdConfirmCompanyName" to
        "Remplacer votre afficheur par « {name} » (le nom de votre entreprise) ?",
    "settings.callerIdConfirmNote" to
        "Les fournisseurs actualisent leurs bases de noms selon leur propre horaire : " +
        "le nouveau nom peut donc mettre quelques jours à apparaître sur les appels.",
    "settings.callerIdSubmit" to "Mettre l'afficheur à jour",
    "settings.callerIdSubmitting" to "Envoi…",
    "settings.callerIdSubmitted" to
        "Mise à jour de l'afficheur soumise aux fournisseurs.",
    "settings.callerIdGoBack" to "Revenir",
    "settings.callerIdLookup" to "Chercher qui appelle",
    "settings.callerIdLookupHelp" to
        "Affiche le nom enregistré au réseau de l'appelant sur les appels entrants " +
        "quand il n'est pas encore dans vos clients.",
    "settings.callerIdReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier les " +
        "réglages de l'afficheur.",

    "settings.minutesFooter" to
        "Votre forfait comprend {minutes} minutes d'appel par mois, dans les deux " +
        "sens. Les détails se trouvent dans Paramètres › Utilisation.",
    "settings.minutesFooterOverage" to
        "Votre forfait comprend {minutes} minutes d'appel par mois, dans les deux " +
        "sens. Au-delà, les minutes supplémentaires sont facturées 1 ¢ chacune " +
        "jusqu'à votre plafond de dépenses. Les détails se trouvent dans " +
        "Paramètres › Utilisation.",
)

// ---------------------------------------------------------------------------
// Settings → Numbers → a number the plan does not cover (#523)
// ---------------------------------------------------------------------------

/**
 * Only the CONTROL is here. The sentences that explain a hold — `heldNumberKept`,
 * `suspendedNumberNote`, `heldNumberRoutes`, `portHoldNote`, `changePlanMessage`
 * — are pure functions in `HeldNumbers.kt` with no locale in reach and a test
 * file pinning their wording. Threading a locale into them is its own change.
 */
private val HELD_EN = mapOf(
    "settings.heldThisNumber" to "This number",
    "settings.heldBringBackPriced" to "Bring it back · {price}",
    "settings.heldBringBack" to "Bring it back",
    "settings.heldBringBackTitle" to "Bring {number} back?",
    "settings.heldBringBackBody" to
        "{price} is added to your plan for this number. You're charged a prorated " +
        "amount for the rest of this period today, then the full price each month. " +
        "It starts sending and answering again straight away.",
    "settings.heldAlreadyBack" to "{number} is already back.",
    "settings.heldBackNow" to "{number} is back. It can send and answer again.",
)

private val HELD_FR = mapOf(
    "settings.heldThisNumber" to "Ce numéro",
    "settings.heldBringBackPriced" to "Le réactiver · {price}",
    "settings.heldBringBack" to "Le réactiver",
    "settings.heldBringBackTitle" to "Réactiver {number} ?",
    "settings.heldBringBackBody" to
        "{price} s'ajoute à votre forfait pour ce numéro. Vous êtes facturé " +
        "aujourd'hui un montant au prorata pour le reste de la période, puis le " +
        "plein prix chaque mois. Le numéro recommence immédiatement à envoyer et à " +
        "répondre.",
    "settings.heldAlreadyBack" to "{number} est déjà réactivé.",
    "settings.heldBackNow" to
        "{number} est réactivé. Il peut de nouveau envoyer et répondre.",
)

// ---------------------------------------------------------------------------
// Settings → Billing (#157, #277, #328, #392, #481, #490, #523, #583)
// ---------------------------------------------------------------------------

/**
 * `settings.cancelExitAction` is the label on the button that leaves, and its
 * English is byte-identical to the literal it replaced. That is load-bearing:
 * `BillingPressTest` finds the control by the text it RENDERS, and the default
 * locale is English. `ExitPathGuard.EXIT_KEY` is how the guards that read the
 * SOURCE find it now.
 *
 * Not here, and named in the extraction report: `pausedStateCopy`,
 * `prepaidConversionCopy`, `cancellationOffer`, `planFacts`,
 * `planAllowanceLines`, `CANCELLATION_REASONS`, `planStateUnknownNote` and
 * `pausedCancelNote` all live in `SettingsLogic.kt`, which is another agent's
 * file, and `heldNumbersPlanNote`/`changePlanMessage` are pure functions with no
 * locale in reach.
 */
private val BILLING_EN = mapOf(
    "settings.billingTitle" to "Billing",
    "settings.billingReadOnly" to "Only owners and admins can change billing.",
    "settings.billingOpening" to "Opening…",
    "settings.billingPortalTitle" to "Payment & invoices",
    "settings.billingPortalIntro" to
        "Cards, receipts, and billing details live in the secure Stripe portal. It " +
        "opens in your browser.",
    "settings.billingPortalAction" to "Manage payment & invoices",

    "settings.cancelTitle" to "Cancel",
    "settings.cancelOwnerOnly" to
        "Only the owner can cancel this plan. When they do, the plan runs to the end " +
        "of the billing period and nothing sends after that. The number is held for " +
        "{days} days from the day they cancel — not from that date — in case they " +
        "change their mind. After that it is released for good.",
    "settings.cancelNotInPortal" to
        "The payment portal above is for cards and invoices and has no cancellation " +
        "on it, so this is not something to go looking for there.",
    "settings.cancelConsequence" to
        "Cancel anytime. Your plan runs to the end of your billing period, and you " +
        "can't send once it ends. Your number is held for {days} days from the day " +
        "you cancel — not from that date — in case you change your mind. After that " +
        "it is released for good.",
    "settings.cancelWhyAsk" to
        "If you want to say why, it helps us fix it. Optional, and it changes nothing " +
        "about cancelling.",
    "settings.cancelDetailLabel" to "Anything you want to tell us (optional)",
    "settings.cancelCharactersLeft" to "{count} characters left.",
    "settings.cancelExportHeading" to "Take your contacts with you",
    "settings.cancelExportIntro" to
        "Every contact in this workspace as a CSV: names, numbers, tags and when they " +
        "opted in. Save it, send it, or open it in a spreadsheet. Yours either way.",
    "settings.cancelExportAction" to "Export contacts",
    "settings.cancelExporting" to "Exporting…",
    "settings.cancelContactsExported" to "Contacts exported.",
    "settings.cancelHandoffNote" to
        "Nothing above has to be filled in. This takes you to the secure Stripe " +
        "portal either way, where you finish cancelling. It opens in your browser.",
    "settings.cancelExitAction" to "Continue to cancel",
    "settings.pausePaused" to "Paused. Your number and your history are safe.",
    "settings.pauseResumed" to "You're back. Texting and calls work again.",

    "settings.offRampTitle" to "Tell your customers where you went",
    "settings.offRampIntro" to
        "Anyone who texts your old number gets this back, once each. It stops when " +
        "the number goes back to the phone company. After that we can't answer it, " +
        "and texts to it reach whoever gets it next.",
    "settings.offRampIntroDated" to
        "Anyone who texts your old number gets this back, once each. It stops on " +
        "{date}, when the number goes back to the phone company. After that we can't " +
        "answer it, and texts to it reach whoever gets it next.",
    "settings.offRampPlaceholder" to
        "We've moved to (416) 555-0123 — call or text us there and we'll pick right up.",
    "settings.offRampEmpty" to "Nothing is sent until you write something here.",
    "settings.offRampCount" to
        "{count} of {max} characters. Your words, sent as they are.",
    "settings.offRampStart" to "Start sending this",
    "settings.offRampTurnOff" to "Turn off",
    "settings.offRampTurnedOff" to "Turned off.",
    "settings.offRampSaved" to
        "Saved. We'll send this once to each customer who texts you.",
    "settings.offRampSaveFailed" to "Couldn't save that. Try again.",

    "settings.missedWhileOffOne" to "1 customer called while your number was off",
    "settings.missedWhileOff" to "{count} customers called while your number was off",
    "settings.missedWhileOffNote" to "They heard that the number isn't taking calls.",
    "settings.missedWhileOffNoteDated" to
        "They heard that the number isn't taking calls. The most recent was {day}.",

    "settings.noticePastDue" to
        "Your last payment didn't go through. Update your payment method to keep " +
        "sending messages.",
    "settings.noticeUnpaid" to
        "Sending is paused until your payment method is updated.",
    "settings.noticeUpdatePayment" to "Update payment method",
    "settings.noticeCancelling" to
        "Your plan is set to cancel at the end of this period. Texting stops then. " +
        "Your number is held for {days} days from the day you cancelled — not from " +
        "the end of that period — so it can be released soon afterwards. You can undo " +
        "this from the payment portal.",
    "settings.noticeCancellingOn" to
        "Your plan is set to cancel on {date}. Texting stops then. Your number is " +
        "held for {days} days from the day you cancelled — not from the end of that " +
        "period — so it can be released soon afterwards. You can undo this from the " +
        "payment portal.",
    "settings.noticeKeepMyPlan" to "Keep my plan",

    "settings.subscriptionTitle" to "Subscription",
    "settings.subscriptionCanceled" to "Your subscription is canceled.",
    "settings.subscriptionCanceledInGrace" to
        "Your subscription is canceled. You can't send until you're back, but your " +
        "number is still taking messages and your history is untouched.",
    "settings.winbackNoThanks" to "No thanks",
    "settings.winbackDismissFailed" to "Couldn't save that. Try again.",
    "settings.holdEndedOn" to
        "The {days}-day hold on your number ended on {date}. Resubscribing now sets " +
        "you up with a new number — your message history is still here.",
    "settings.holdEnded" to
        "The {days}-day hold on your number has ended. Resubscribing now sets you up " +
        "with a new number — your message history is still here.",
    "settings.holdUntil" to
        "We hold your number until {date}. Resubscribe before then and it comes back " +
        "with everything in it; after that it goes back to the phone company.",
    "settings.holdRule" to
        "We hold your number for {days} days from the day you cancel. Resubscribe " +
        "before then and it comes back with everything in it; after that it goes back " +
        "to the phone company.",
    "settings.resubscribe" to "Resubscribe",

    "settings.planTitle" to "Plan",
    "settings.planNone" to
        "No plan yet. Finish setup on the web to pick one and get your number.",
    "settings.planNameAndPrice" to "{name} · {price}",
    "settings.planPillPaused" to "Paused",
    "settings.planPillActive" to "Active",
    "settings.planPillChecking" to "Checking…",
    "settings.planAllowanceLine" to "· {line}",
    "settings.planFairUse" to "Allowances reflect fair use. See the policy",
    "settings.planOpenNumbers" to "Open your numbers",
    "settings.planPeriodEnds" to "Current period ends {date}.",
    "settings.pausedSince" to "Paused since {date}.",
    "settings.planSwitchToStarter" to "Switch to Starter",
    "settings.planUpgradeToPro" to "Upgrade to Pro",

    "settings.changePlanUpgradeTitle" to "Upgrade to Pro?",
    "settings.changePlanUpgradeBody" to
        "The upgrade happens right away. You're charged the prorated difference for " +
        "the rest of this period, and your allowances go up immediately.",
    "settings.changePlanUpgradeAction" to "Upgrade now",
    "settings.changePlanDowngradeTitle" to "Switch to Starter?",
    "settings.changePlanDowngradeBody" to
        "Starter is smaller, so your workspace has to fit it first.",
    "settings.changePlanDowngradeAction" to "Schedule the switch",
    "settings.downgradeNumbersOkOne" to "✓ 1 phone number. You're set.",
    "settings.downgradeNumbersOk" to "✓ {numbers} phone numbers. You're set.",
    "settings.downgradeNumbersBlockedOne" to
        "✗ Starter includes 1 phone number; you have {have}. Release under " +
        "Settings › Numbers first.",
    "settings.downgradeNumbersBlocked" to
        "✗ Starter includes {numbers} phone numbers; you have {have}. Release under " +
        "Settings › Numbers first.",
    "settings.downgradeSeatsUnknown" to "✗ Couldn't check your member count. Try again.",
    "settings.downgradeSeatsChecking" to "Checking your member count…",
    "settings.downgradeSeatsOk" to "✓ Up to {seats} members; you have {have}.",
    "settings.downgradeSeatsBlocked" to
        "✗ Starter includes {seats} members; you have {have} active. Deactivate " +
        "{excess} under Settings › Team first.",
    "settings.downgradeTiming" to
        "The change happens at the end of your current period. You keep Pro until " +
        "then, and nothing is refunded mid-period.",

    "settings.prepaidPaidUpFront" to "Paid up front: {amount}",
    "settings.prepaidMonthsUsed" to "Months used: {months} of 12",
    "settings.prepaidCredit" to "Back on your account: {amount}",

    "settings.modulesTitle" to "Add-ons",
    "settings.modulesIntro" to "Optional extras billed with your plan.",
    "settings.moduleRow" to "{name} · {price}/mo",
    "settings.moduleAddTitle" to "Add {name}?",
    "settings.moduleAddBody" to
        "{price}/mo is added to your plan. You're charged a prorated amount for the " +
        "rest of this period today, then the full price each month.",
    "settings.moduleAddAction" to "Add it",
    "settings.moduleAdded" to "{name} added.",
    "settings.moduleRemoveTitle" to "Remove {name}?",
    "settings.moduleRemoveBody" to
        "{name} comes off your plan now, with a prorated credit for the unused part " +
        "of this period on your next invoice.",
    "settings.moduleRemoveAction" to "Remove it",
    "settings.moduleRemoved" to "{name} removed.",
)

private val BILLING_FR = mapOf(
    "settings.billingTitle" to "Facturation",
    "settings.billingReadOnly" to
        "Seuls les propriétaires et les administrateurs peuvent modifier la facturation.",
    "settings.billingOpening" to "Ouverture…",
    "settings.billingPortalTitle" to "Paiement et factures",
    "settings.billingPortalIntro" to
        "Les cartes, les reçus et les coordonnées de facturation se trouvent dans le " +
        "portail sécurisé de Stripe. Il s'ouvre dans votre navigateur.",
    "settings.billingPortalAction" to "Gérer le paiement et les factures",

    "settings.cancelTitle" to "Annuler",
    "settings.cancelOwnerOnly" to
        "Seul le propriétaire peut annuler ce forfait. Quand il le fait, le forfait " +
        "se poursuit jusqu'à la fin de la période de facturation et plus rien ne part " +
        "après. Le numéro est conservé {days} jours à compter du jour de " +
        "l'annulation — et non de cette date — au cas où il changerait d'idée. " +
        "Après quoi il est libéré définitivement.",
    "settings.cancelNotInPortal" to
        "Le portail de paiement ci-dessus sert aux cartes et aux factures et ne " +
        "contient aucune annulation : ce n'est donc pas là qu'il faut la chercher.",
    "settings.cancelConsequence" to
        "Annulez quand vous voulez. Votre forfait se poursuit jusqu'à la fin de votre " +
        "période de facturation, et vous ne pouvez plus envoyer une fois qu'elle est " +
        "terminée. Votre numéro est conservé {days} jours à compter du jour de " +
        "l'annulation — et non de cette date — au cas où vous changeriez d'idée. " +
        "Après quoi il est libéré définitivement.",
    "settings.cancelWhyAsk" to
        "Si vous voulez nous dire pourquoi, cela nous aide à corriger le tir. " +
        "Facultatif, et cela ne change rien à l'annulation.",
    "settings.cancelDetailLabel" to "Ce que vous voulez nous dire (facultatif)",
    "settings.cancelCharactersLeft" to "Il reste {count} caractères.",
    "settings.cancelExportHeading" to "Partez avec vos clients",
    "settings.cancelExportIntro" to
        "Tous les clients de cet espace de travail dans un fichier CSV : noms, " +
        "numéros, étiquettes et date de consentement. Enregistrez-le, envoyez-le ou " +
        "ouvrez-le dans un tableur. Il est à vous dans tous les cas.",
    "settings.cancelExportAction" to "Exporter les clients",
    "settings.cancelExporting" to "Exportation…",
    "settings.cancelContactsExported" to "Clients exportés.",
    "settings.cancelHandoffNote" to
        "Rien de ce qui précède n'est obligatoire. Ceci vous amène de toute façon au " +
        "portail sécurisé de Stripe, où vous terminez l'annulation. Il s'ouvre dans " +
        "votre navigateur.",
    "settings.cancelExitAction" to "Continuer vers l'annulation",
    "settings.pausePaused" to "En pause. Votre numéro et votre historique sont intacts.",
    "settings.pauseResumed" to
        "Vous êtes de retour. Les textos et les appels fonctionnent de nouveau.",

    "settings.offRampTitle" to "Dites à vos clients où vous êtes allé",
    "settings.offRampIntro" to
        "Quiconque écrit à votre ancien numéro reçoit ceci en retour, une seule fois " +
        "chacun. Cela s'arrête quand le numéro retourne à la compagnie de téléphone. " +
        "Après quoi nous ne pouvons plus y répondre, et les textos qui y sont envoyés " +
        "aboutissent chez la personne qui l'obtiendra ensuite.",
    "settings.offRampIntroDated" to
        "Quiconque écrit à votre ancien numéro reçoit ceci en retour, une seule fois " +
        "chacun. Cela s'arrête le {date}, quand le numéro retourne à la compagnie de " +
        "téléphone. Après quoi nous ne pouvons plus y répondre, et les textos qui y " +
        "sont envoyés aboutissent chez la personne qui l'obtiendra ensuite.",
    "settings.offRampPlaceholder" to
        "Nous avons déménagé au (416) 555-0123 — appelez-nous ou écrivez-nous là et " +
        "nous répondrons tout de suite.",
    "settings.offRampEmpty" to "Rien n'est envoyé tant que vous n'écrivez rien ici.",
    "settings.offRampCount" to
        "{count} caractères sur {max}. Vos mots, envoyés tels quels.",
    "settings.offRampStart" to "Commencer à envoyer ceci",
    "settings.offRampTurnOff" to "Désactiver",
    "settings.offRampTurnedOff" to "Désactivé.",
    "settings.offRampSaved" to
        "Enregistré. Nous l'enverrons une fois à chaque client qui vous écrit.",
    "settings.offRampSaveFailed" to "Impossible d'enregistrer. Réessayez.",

    "settings.missedWhileOffOne" to
        "1 client a appelé pendant que votre numéro était hors service",
    "settings.missedWhileOff" to
        "{count} clients ont appelé pendant que votre numéro était hors service",
    "settings.missedWhileOffNote" to
        "Ils ont entendu que le numéro ne prend pas les appels.",
    "settings.missedWhileOffNoteDated" to
        "Ils ont entendu que le numéro ne prend pas les appels. Le plus récent " +
        "remonte à {day}.",

    "settings.noticePastDue" to
        "Votre dernier paiement n'a pas été accepté. Mettez votre mode de paiement à " +
        "jour pour continuer à envoyer des textos.",
    "settings.noticeUnpaid" to
        "L'envoi est suspendu tant que votre mode de paiement n'est pas mis à jour.",
    "settings.noticeUpdatePayment" to "Mettre le mode de paiement à jour",
    "settings.noticeCancelling" to
        "Votre forfait doit être annulé à la fin de cette période. Les textos " +
        "s'arrêtent alors. Votre numéro est conservé {days} jours à compter du jour " +
        "de l'annulation — et non de la fin de cette période — il peut donc être " +
        "libéré peu après. Vous pouvez annuler cette décision depuis le portail de " +
        "paiement.",
    "settings.noticeCancellingOn" to
        "Votre forfait doit être annulé le {date}. Les textos s'arrêtent alors. Votre " +
        "numéro est conservé {days} jours à compter du jour de l'annulation — et non " +
        "de la fin de cette période — il peut donc être libéré peu après. Vous pouvez " +
        "annuler cette décision depuis le portail de paiement.",
    "settings.noticeKeepMyPlan" to "Garder mon forfait",

    "settings.subscriptionTitle" to "Abonnement",
    "settings.subscriptionCanceled" to "Votre abonnement est annulé.",
    "settings.subscriptionCanceledInGrace" to
        "Votre abonnement est annulé. Vous ne pouvez pas envoyer tant que vous n'êtes " +
        "pas de retour, mais votre numéro reçoit toujours les textos et votre " +
        "historique est intact.",
    "settings.winbackNoThanks" to "Non merci",
    "settings.winbackDismissFailed" to "Impossible d'enregistrer. Réessayez.",
    "settings.holdEndedOn" to
        "La conservation de {days} jours de votre numéro a pris fin le {date}. Vous " +
        "réabonner maintenant vous donne un nouveau numéro — votre historique de " +
        "textos est toujours là.",
    "settings.holdEnded" to
        "La conservation de {days} jours de votre numéro a pris fin. Vous réabonner " +
        "maintenant vous donne un nouveau numéro — votre historique de textos est " +
        "toujours là.",
    "settings.holdUntil" to
        "Nous conservons votre numéro jusqu'au {date}. Réabonnez-vous avant cette " +
        "date et il revient avec tout ce qu'il contient ; après quoi il retourne à la " +
        "compagnie de téléphone.",
    "settings.holdRule" to
        "Nous conservons votre numéro {days} jours à compter du jour de l'annulation. " +
        "Réabonnez-vous avant la fin de ce délai et il revient avec tout ce qu'il " +
        "contient ; après quoi il retourne à la compagnie de téléphone.",
    "settings.resubscribe" to "Se réabonner",

    "settings.planTitle" to "Forfait",
    "settings.planNone" to
        "Aucun forfait pour l'instant. Terminez la configuration sur le Web pour en " +
        "choisir un et obtenir votre numéro.",
    "settings.planNameAndPrice" to "{name} · {price}",
    "settings.planPillPaused" to "En pause",
    "settings.planPillActive" to "Actif",
    "settings.planPillChecking" to "Vérification…",
    "settings.planAllowanceLine" to "· {line}",
    "settings.planFairUse" to
        "Les allocations respectent l'usage raisonnable. Voir la politique",
    "settings.planOpenNumbers" to "Ouvrir vos numéros",
    "settings.planPeriodEnds" to "La période en cours se termine le {date}.",
    "settings.pausedSince" to "En pause depuis le {date}.",
    "settings.planSwitchToStarter" to "Passer à Starter",
    "settings.planUpgradeToPro" to "Passer à Pro",

    "settings.changePlanUpgradeTitle" to "Passer à Pro ?",
    "settings.changePlanUpgradeBody" to
        "La mise à niveau se fait immédiatement. Vous êtes facturé la différence au " +
        "prorata pour le reste de cette période, et vos allocations augmentent tout " +
        "de suite.",
    "settings.changePlanUpgradeAction" to "Passer à Pro maintenant",
    "settings.changePlanDowngradeTitle" to "Passer à Starter ?",
    "settings.changePlanDowngradeBody" to
        "Starter est plus petit : votre espace de travail doit d'abord y entrer.",
    "settings.changePlanDowngradeAction" to "Planifier le changement",
    "settings.downgradeNumbersOkOne" to "✓ 1 numéro de téléphone. Tout est bon.",
    "settings.downgradeNumbersOk" to "✓ {numbers} numéros de téléphone. Tout est bon.",
    "settings.downgradeNumbersBlockedOne" to
        "✗ Starter comprend 1 numéro de téléphone ; vous en avez {have}. " +
        "Libérez-en d'abord sous Paramètres › Numéros.",
    "settings.downgradeNumbersBlocked" to
        "✗ Starter comprend {numbers} numéros de téléphone ; vous en avez {have}. " +
        "Libérez-en d'abord sous Paramètres › Numéros.",
    "settings.downgradeSeatsUnknown" to
        "✗ Impossible de vérifier votre nombre de membres. Réessayez.",
    "settings.downgradeSeatsChecking" to "Vérification de votre nombre de membres…",
    "settings.downgradeSeatsOk" to
        "✓ Jusqu'à {seats} membres ; vous en avez {have}.",
    "settings.downgradeSeatsBlocked" to
        "✗ Starter comprend {seats} membres ; vous en avez {have} actifs. " +
        "Désactivez-en {excess} sous Paramètres › Équipe d'abord.",
    "settings.downgradeTiming" to
        "Le changement prend effet à la fin de votre période en cours. Vous gardez " +
        "Pro jusque-là, et rien n'est remboursé en cours de période.",

    "settings.prepaidPaidUpFront" to "Payé d'avance : {amount}",
    "settings.prepaidMonthsUsed" to "Mois utilisés : {months} sur 12",
    "settings.prepaidCredit" to "Remis à votre compte : {amount}",

    "settings.modulesTitle" to "Options",
    "settings.modulesIntro" to "Extras facultatifs facturés avec votre forfait.",
    "settings.moduleRow" to "{name} · {price}/mois",
    "settings.moduleAddTitle" to "Ajouter {name} ?",
    "settings.moduleAddBody" to
        "{price}/mois s'ajoute à votre forfait. Vous êtes facturé aujourd'hui un " +
        "montant au prorata pour le reste de cette période, puis le plein prix chaque " +
        "mois.",
    "settings.moduleAddAction" to "L'ajouter",
    "settings.moduleAdded" to "{name} ajouté.",
    "settings.moduleRemoveTitle" to "Retirer {name} ?",
    "settings.moduleRemoveBody" to
        "{name} est retiré de votre forfait dès maintenant, avec un crédit au prorata " +
        "pour la partie inutilisée de cette période sur votre prochaine facture.",
    "settings.moduleRemoveAction" to "Le retirer",
    "settings.moduleRemoved" to "{name} retiré.",
)
