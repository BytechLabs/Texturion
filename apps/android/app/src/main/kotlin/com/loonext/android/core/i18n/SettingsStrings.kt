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
 * Copy that lives outside a composable reaches a locale the way rule 3 says:
 * the pure functions in `HeldNumbers.kt` and `HelpSection.kt` take one, default
 * it to null (the English table) so the guards that compare this app against
 * `packages/shared` keep reading English, and every composable call site hands
 * them `LocalAppLocale.current`.
 *
 * `ContactFields.Copy` is the exception and stays where it is:
 * `ContactFieldsParityTest` pins it word for word against the web card, so a
 * copy here would fork the thing that test exists to keep single.
 */
object SettingsStrings : AppStrings.Section {
    override val en: Map<String, String> =
        AI_EN + CLOSED_DATES_EN + CONTACT_FIELDS_EN + LEAVE_EN + HELP_EN +
            SUPPORT_EN + DELETE_ACCOUNT_EN + EMERGENCY_EN + DEVICES_EN +
            HOURS_EN + CALLING_EN + HELD_EN + HOLD_COPY_EN + REGISTRATION_EN +
            BILLING_EN

    override val frCA: Map<String, String> =
        AI_FR + CLOSED_DATES_FR + CONTACT_FIELDS_FR + LEAVE_FR + HELP_FR +
            SUPPORT_FR + DELETE_ACCOUNT_FR + EMERGENCY_FR + DEVICES_FR +
            HOURS_FR + CALLING_FR + HELD_FR + HOLD_COPY_FR + REGISTRATION_FR +
            BILLING_FR
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
    // #228 — the five sentences that used to live in packages/shared.
    "settings.contactFieldsHeading" to "Your own contact fields",
    "settings.contactFieldsIntro" to "Boiler model, gate code, warranty date — the things your crew needs before the truck leaves. They show on every customer and come back in search and exports.",
    "settings.contactFieldsPrivacy" to "Do not put card numbers, government IDs or health information here. These fields are stored and exported like a customer's name, which is not the handling those need.",
    "settings.contactFieldsCapReached" to "That is all {count} fields. Remove one to add another.",
    "settings.contactFieldsDeleteWarning" to "Removing a field hides it everywhere. What your crew typed into it stays on each customer until you edit them.",
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
    "settings.contactFieldsHeading" to "Vos propres champs de contact",
    "settings.contactFieldsIntro" to "Modèle de chaudière, code de portail, date de garantie — ce que votre équipe doit savoir avant que le camion parte. Ces champs apparaissent sur chaque client et reviennent dans la recherche et les exportations.",
    "settings.contactFieldsPrivacy" to "N'y mettez pas de numéros de carte, de pièces d'identité ni de renseignements médicaux. Ces champs sont stockés et exportés comme le nom d'un client, ce qui n'est pas le traitement que ces données exigent.",
    "settings.contactFieldsCapReached" to "Vous avez vos {count} champs. Retirez-en un pour en ajouter un autre.",
    "settings.contactFieldsDeleteWarning" to "Retirer un champ le masque partout. Ce que votre équipe y a inscrit reste sur chaque client jusqu'à ce que vous les modifiiez.",
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
 * The help screen's own headings. The FAQ, the fix promise and the reply
 * promise moved into [SUPPORT_EN] below, where the support pre-fill lives;
 * `SUPPORT_TOPICS` and friends in `HelpSection.kt` now READ this catalogue's
 * English rather than holding a second copy of it, so `SupportPortTest` still
 * compares the shipped sentence against `packages/shared/src/support.ts`.
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
 * `{line}` is `settings.emergencySafetyLine`, the sentence the SERVER appends
 * to an outgoing text. Both languages are copied from shared rather than
 * written here — this screen only quotes back what the send path composes.
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
    // THE ONE SENTENCE WITH A SAFETY PROPERTY. Everything else in this file
    // degrades to "the reader gets English" when a translation is missing;
    // this degrades to somebody in danger being told what to do in a language
    // they may not read. Both languages are the SERVER's own, copied from
    // `packages/shared/src/locale.ts` — this screen only previews what the
    // send path appends. 911 is the number in Canada and the US alike.
    "settings.emergencySafetyLine" to "If anyone is in danger, call 911.",
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
    "settings.emergencySafetyLine" to "Si quelqu'un est en danger, composez le 911.",
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
    // THE MESSAGE ITSELF, not a description of it: this is the placeholder
    // AND the preview of what the caller receives. Both languages are copied
    // character for character out of `packages/shared/src/locale.ts`, which
    // is what the server puts on the wire — so the French reads without
    // accents and inside GSM-7, exactly as the text a customer gets does. A
    // prettier French here would preview a message this product never sends.
    // `{business_name}` is a merge field the send path fills in, not a
    // catalogue token, and survives interpolation untouched.
    "settings.textBackDefault" to
        "Sorry we missed your call! This is {business_name}. Reply here with your " +
        "address and what you need, and we'll get you booked in.",
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
    // `FR_CA_COPY.missedCallTextBack` in `packages/shared/src/locale.ts`,
    // character for character — accents and all left as the wire has them.
    "settings.textBackDefault" to
        "Desole, nous avons manque votre appel. Ici {business_name}. " +
        "Repondez ici avec votre adresse et ce dont vous avez besoin, " +
        "et nous vous trouverons une place.",
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

    /*
     * #277's six answers. The CODES are frozen in SettingsLogic and land in the
     * database; these are only the words, and changing one is free.
     */
    /*
     * #228 — what a plan gives you, on the compare card.
     *
     * Every line is either a fact about the plan or a limit on it. "fair use"
     * is the product's own term and reads as "usage raisonnable" throughout,
     * which is the wording SettingsMoreStrings already uses.
     */
    /*
     * #523 — switching away from a prepaid year.
     *
     * The credited and uncredited forms are separate keys rather than one
     * sentence with a clause bolted on: they say different things about the
     * money, and French orders them differently.
     */
    "settings.prepaidHeading" to "You have a prepaid {plan} year running.",
    "settings.prepaidEndsPlain" to
        "Switching ends the prepaid year. You then pay the normal {plan} monthly price.",
    "settings.prepaidEndsCredited" to
        "Switching ends the prepaid year and puts {credit} back on your account as " +
        "credit, which comes off your next invoices. You then pay the normal {plan} " +
        "monthly price.",
    "settings.prepaidAckPlain" to "End my prepaid year",
    "settings.prepaidAckCredited" to "End my prepaid year and credit me {credit}",

    /*
     * #277 — the pause, offered and then lived in.
     *
     * The named-plan and unnamed forms are SEPARATE KEYS rather than one
     * sentence with an optional insert: a plan name is a noun that has to sit
     * in a grammatical slot, and French does not put it where English does.
     */
    "settings.pauseStops" to
        "You can't send texts or take calls while you're paused, and anyone who " +
        "rings hears that the line isn't taking calls.",
    "settings.pauseKeeps" to
        "Every text a customer sends still arrives, anything you've scheduled is " +
        "held rather than dropped and goes out when you're back, and your number " +
        "and your whole message history stay exactly as they are.",

    "settings.pausedHeading" to "Paused",
    "settings.pausedHeadingPrice" to "Paused — {price} a month instead of the plan price",
    "settings.pauseResumeNamed" to
        "Resuming puts you straight back on {plan}, with the rest of this billing " +
        "period charged at the {plan} price.",
    "settings.pauseResumeAny" to
        "Resuming puts you straight back on your plan, with the rest of this " +
        "billing period charged at the plan price.",
    "settings.pauseResumeLabelNamed" to "Resume {plan}",
    "settings.pauseResumeLabelAny" to "Resume my plan",
    "settings.pauseConfirmTitleNamed" to "Resume {plan}?",
    "settings.pauseConfirmTitleAny" to "Resume your plan?",
    "settings.pauseConfirmTail" to
        "Texting and calls work again as soon as it lands, and anything that was " +
        "held goes out.",
    "settings.pauseResumeNow" to "Resume now",

    "settings.pauseOfferHeading" to "Pause instead of cancelling — {price} a month",
    "settings.pauseOfferBody" to
        "{price} a month instead of your plan, for as long as the quiet season lasts.",
    "settings.pauseOfferNoClock" to
        "Cancelling starts a {days}-day clock on your number from the day you " +
        "cancel; pausing starts no clock at all — come back in spring and pick up " +
        "where you left off.",
    "settings.pauseOfferAction" to "Pause my plan — {price}/mo",
    "settings.pauseOfferConfirmTitle" to "Pause your plan?",
    "settings.pauseOfferConfirmBody" to
        "{price} a month from today, instead of your plan price, and every month " +
        "after that until you resume. You can resume whenever you want.",
    "settings.pauseOfferConfirmLabel" to "Pause for {price}/mo",

    "settings.planLineTexting" to "Texting for your crew, bound by fair use",
    "settings.planLineCalling" to "Calling included on every plan, never an add-on",
    "settings.planLineExtraTexts" to
        "Extra texts bill under fair use, up to a cap you control",
    "settings.planLineSeats" to "{count} team members",
    "settings.planLineNumberOne" to "{count} phone number",
    "settings.planLineNumbers" to "{count} phone numbers",

    "settings.cancelReasonTooExpensive" to "Too expensive",
    "settings.cancelReasonSeasonal" to "Quiet season, I'll be back",
    "settings.cancelReasonMissingFeature" to "Missing something I need",
    "settings.cancelReasonSwitched" to "Going with something else",
    "settings.cancelReasonNotUsing" to "Not using it",
    "settings.cancelReasonOther" to "Something else",
    "settings.cancelOwnerOnly" to
        "Only the owner can cancel this plan. When they do, the plan runs to the end " +
        "of the billing period and nothing sends after that. The number is held for " +
        "{days} days from the day they cancel — not from that date — in case they " +
        "change their mind. After that it is released for good.",
    "settings.cancelNotInPortal" to
        "The payment portal above is for cards and invoices and has no cancellation " +
        "on it, so this is not something to go looking for there.",
    // #228 — the emergency-word screen. Named by
    // packages/shared/src/emergency.ts and spelled the way iOS already spells
    // it, so all three clients say one warning.
    "settings.keywordEmpty" to "Type a word first.",
    "settings.keywordOneWord" to
        "One word only — customers text a single word, so a phrase would never match.",
    "settings.keywordAlphanumeric" to
        "Letters and numbers only. Punctuation is stripped from what customers send.",
    "settings.keywordTooShort" to "Too short — use at least 2 characters.",
    "settings.keywordTooLong" to "Too long — 15 characters at most.",
    "settings.keywordCarrierOwned" to
        "{word} is answered by the phone carrier before it reaches us, so it can't be an emergency word.",
    "settings.awayEmergencyOff" to
        "Your away message tells customers to reply for an emergency, but nothing will treat that reply as one. Turn this back on, or take the offer out of the message.",
    // {word} TWICE. Kotlin's String.replace and the translate() below both
    // replace every occurrence; JavaScript's does not, which is why shared
    // fills its templates through a helper rather than with .replace().
    "settings.awayEmergencyUnknownWord" to
        "Your away message tells customers to reply {word}, which nothing watches for. Use {words} instead, add {word} to your emergency words, or take the offer out of the message.",
    "settings.awayEmergencyNotMentioned" to
        "Nobody has been told they can. Mention it in your away message if you want customers to know.",
    "settings.wordListNothing" to "nothing",
    // The spaces belong to the word: French joins the last pair with "ou".
    "settings.wordListOr" to " or ",
    // #228 — the ownership prompt. Spelled the way iOS spells it.
    "settings.handoverPromptOffered" to "You have been offered ownership of this workspace.",
    "settings.handoverPromptReady" to "Your request to take over is ready to complete.",
    "settings.handoverPromptAsked" to "You have asked to take over this workspace.",
    "settings.handoverPromptBackup" to "You are the backup owner.",
    "settings.handoverWithdraw" to "Withdraw my request",
    "settingsMore.ownershipDecline" to "Decline",
    "misc.ownershipDetailAcceptOffer" to "Accepting makes you responsible for billing, the spending cap and your numbers; the current owner stays on the team as an admin. Everyone is told either way. The offer expires {when}.",
    "misc.ownershipDetailCompleteClaim" to "The waiting period is over and nobody stopped it. Completing this makes you the owner — billing, the spending cap and your numbers — and puts the previous owner on the team as an admin.",
    "misc.ownershipDetailClaimWaiting" to "The owner has been emailed and can stop this until {when}. If nobody stops it, you can complete the takeover after that.",
    "misc.ownershipDetailBackupStanding" to "If the owner ever can't get in — they leave, they lose access to their email, or worse — you're the one person who can ask to take over. They get a week to say no, and everyone on the team is told. Nothing changes until you ask.",
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
    /*
     * #228 — the cancel card's answers.
     *
     * iOS converted these first and its key names are the ones all three
     * clients use, so one wording change lands everywhere at once. This client
     * typed the paragraphs out until now, which is what
     * CancellationOfferTest's cross-language pin was watching.
     *
     * The singular "business number" is its OWN key rather than the plural
     * with an appended "s": French pluralises the noun and its article
     * together, and a suffix cannot express that.
     */
    /*
     * #228 — what a workspace reads while its number is being set up, and
     * what it reads when that stops working. Three tiers on the wait,
     * because the flat "under a minute" line was true for the first minute
     * and a lie for every one after it.
     */
    "settings.provisionWaitShort" to
        "We're setting up your number. This usually takes under a minute.",
    "settings.provisionWaitMedium" to
        "Still setting up your number, this is taking a little longer than " +
        "usual. Hang tight.",
    "settings.provisionWaitLong" to
        "Your number is taking a little longer than usual. We're still on " +
        "it, you don't have to wait here.",
    "settings.numberSetupSlow" to
        "We're still setting up your number. This is taking a little " +
        "longer than usual.",
    "settings.numberSetupStalled" to
        "Setup is taking longer than expected. Choose a number to finish — " +
        "you won't be charged again.",
    "settings.numberAreaCodeEmpty" to
        "Area code {code} is out of new numbers right now. Choose another " +
        "number to finish setup.",
    "settings.numberSetupFailed" to
        "We couldn't finish setting up your number. Choose a number to try " +
        "again.",
    "settings.offerComeBackOnStarter" to "Come back on Starter",
    "settings.offerGetHelp" to "Get help",
    "settings.offerMissingBody" to "If the thing you needed is not here, the fastest way to change that is to tell us what it was. We answer {when}. {promise}",
    "settings.offerMissingHeading" to "Tell us what was missing",
    "settings.offerPausedSeasonalBody" to "Your number and your whole message history are held for as long as you stay paused — nothing expires while your plan is paused, and there is no date you have to be back by. Cancelling instead ends the pause and starts a clock: {days} days from the day you cancel, not from the end of your billing period, and at the end of it the number goes back to the phone company.",
    "settings.offerPausedSeasonalHeading" to "Your plan is already paused, and that hold has no deadline",
    "settings.offerRegistrationFeePaid" to " You have already paid the one-time registration fee, and it is charged at most once per workspace, ever — coming back does not charge it again.",
    "settings.offerSeasonalBody" to "It keeps receiving texts the whole time, so nothing a customer sends is lost — you cannot reply until you are back, and your message history stays put. The {days} days run from the day you cancel, not from the end of your billing period, so a quiet season longer than that outruns the hold and the number goes back to the phone company.",
    "settings.offerSeasonalGraceBody" to "It is still receiving texts, so nothing a customer sends is lost, though you cannot reply until you are back. That date is {days} days from the day you cancelled, not from the end of your last billing period. Resubscribe before then and the number and your whole message history come back with you.",
    "settings.offerSeasonalGraceHeading" to "Your number is still yours until the date below",
    "settings.offerSeasonalHeading" to "Your number is held for {days} days from the day you cancel",
    "settings.offerStarterCovers" to "It covers {seats} people and {numbers} business numbers.",
    "settings.offerStarterCoversOne" to "It covers {seats} people and {numbers} business number.",
    "settings.offerStarterHeading" to "Starter is the same product, priced for a smaller crew",
    "settings.offerStarterHeadingGrace" to "There is a smaller plan to come back on",
    "settings.offerStarterPrice" to "Starter is {starter} a month instead of {pro}, with smaller texting and calling allowances under the same fair-use policy.",
    "settings.offerStarterTail" to "The switch takes effect at the end of your current billing period. Your message history comes with you, and so does the number you text from — a second number does not: the downgrade is refused until you release it, and until the crew is back inside {seats} seats.",
    "settings.offerStarterTailGrace" to "Come back on Starter and your number and your whole message history come with you.",
    "settings.offerStarterTailPaused" to "Your plan is paused, so this takes two steps in this order: resume first, then switch plans. The switch takes effect at the end of your current billing period. Your message history comes with you, and so does the number you text from — a second number does not: the downgrade is refused until you release it, and until the crew is back inside {seats} seats.",

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

    "settings.prepaidHeading" to "Vous avez une année prépayée {plan} en cours.",
    "settings.prepaidEndsPlain" to
        "Changer met fin à l'année prépayée. Vous payez ensuite le prix mensuel " +
        "normal du forfait {plan}.",
    "settings.prepaidEndsCredited" to
        "Changer met fin à l'année prépayée et remet {credit} en crédit sur votre " +
        "compte, qui sera déduit de vos prochaines factures. Vous payez ensuite le " +
        "prix mensuel normal du forfait {plan}.",
    "settings.prepaidAckPlain" to "Mettre fin à mon année prépayée",
    "settings.prepaidAckCredited" to
        "Mettre fin à mon année prépayée et me créditer {credit}",

    "settings.pauseStops" to
        "Vous ne pouvez ni envoyer de textos ni prendre d'appels pendant la pause, " +
        "et les gens qui appellent entendent que la ligne ne prend pas les appels.",
    "settings.pauseKeeps" to
        "Chaque texto qu'un client envoie arrive quand même, tout ce que vous avez " +
        "planifié est retenu plutôt qu'abandonné et part à votre retour, et votre " +
        "numéro et tout votre historique de messages restent exactement tels quels.",

    "settings.pausedHeading" to "En pause",
    "settings.pausedHeadingPrice" to
        "En pause — {price} par mois au lieu du prix du forfait",
    "settings.pauseResumeNamed" to
        "Reprendre vous ramène directement au forfait {plan}, et le reste de cette " +
        "période de facturation est facturé au prix {plan}.",
    "settings.pauseResumeAny" to
        "Reprendre vous ramène directement à votre forfait, et le reste de cette " +
        "période de facturation est facturé au prix du forfait.",
    "settings.pauseResumeLabelNamed" to "Reprendre le forfait {plan}",
    "settings.pauseResumeLabelAny" to "Reprendre mon forfait",
    "settings.pauseConfirmTitleNamed" to "Reprendre le forfait {plan} ?",
    "settings.pauseConfirmTitleAny" to "Reprendre votre forfait ?",
    "settings.pauseConfirmTail" to
        "Les textos et les appels refonctionnent dès que c'est fait, et tout ce qui " +
        "était retenu part.",
    "settings.pauseResumeNow" to "Reprendre maintenant",

    "settings.pauseOfferHeading" to "Mettre en pause au lieu d'annuler — {price} par mois",
    "settings.pauseOfferBody" to
        "{price} par mois au lieu de votre forfait, aussi longtemps que dure la " +
        "saison tranquille.",
    "settings.pauseOfferNoClock" to
        "Annuler déclenche un compte à rebours de {days} jours sur votre numéro à " +
        "partir du jour de l'annulation ; la pause ne déclenche aucun compte à " +
        "rebours — revenez au printemps et reprenez où vous en étiez.",
    "settings.pauseOfferAction" to "Mettre mon forfait en pause — {price}/mois",
    "settings.pauseOfferConfirmTitle" to "Mettre votre forfait en pause ?",
    "settings.pauseOfferConfirmBody" to
        "{price} par mois à partir d'aujourd'hui, au lieu du prix de votre forfait, " +
        "et chaque mois par la suite jusqu'à ce que vous repreniez. Vous pouvez " +
        "reprendre quand vous voulez.",
    "settings.pauseOfferConfirmLabel" to "Mettre en pause pour {price}/mois",

    "settings.planLineTexting" to
        "Messagerie pour votre équipe, encadrée par l'usage raisonnable",
    "settings.planLineCalling" to
        "Les appels sont inclus dans tous les forfaits, jamais en supplément",
    "settings.planLineExtraTexts" to
        "Les textos supplémentaires sont facturés selon l'usage raisonnable, " +
        "jusqu'à un plafond que vous contrôlez",
    "settings.planLineSeats" to "{count} membres de l'équipe",
    "settings.planLineNumberOne" to "{count} numéro de téléphone",
    "settings.planLineNumbers" to "{count} numéros de téléphone",

    "settings.cancelReasonTooExpensive" to "Trop cher",
    "settings.cancelReasonSeasonal" to "Saison tranquille, je reviens",
    "settings.cancelReasonMissingFeature" to "Il manque quelque chose dont j'ai besoin",
    "settings.cancelReasonSwitched" to "Je passe à autre chose",
    "settings.cancelReasonNotUsing" to "Je ne m'en sers pas",
    "settings.cancelReasonOther" to "Autre chose",
    "settings.cancelOwnerOnly" to
        "Seul le propriétaire peut annuler ce forfait. Quand il le fait, le forfait " +
        "se poursuit jusqu'à la fin de la période de facturation et plus rien ne part " +
        "après. Le numéro est conservé {days} jours à compter du jour de " +
        "l'annulation — et non de cette date — au cas où il changerait d'idée. " +
        "Après quoi il est libéré définitivement.",
    "settings.cancelNotInPortal" to
        "Le portail de paiement ci-dessus sert aux cartes et aux factures et ne " +
        "contient aucune annulation : ce n'est donc pas là qu'il faut la chercher.",
    "settings.keywordEmpty" to "Tapez d'abord un mot.",
    "settings.keywordOneWord" to
        "Un seul mot — les clients envoient un mot unique, alors une expression ne correspondrait jamais.",
    "settings.keywordAlphanumeric" to
        "Lettres et chiffres seulement. La ponctuation est retirée de ce que les clients envoient.",
    "settings.keywordTooShort" to "Trop court — utilisez au moins 2 caractères.",
    "settings.keywordTooLong" to "Trop long — 15 caractères au maximum.",
    "settings.keywordCarrierOwned" to
        "{word} reçoit une réponse du fournisseur avant de nous parvenir : ce mot ne peut donc pas servir d'urgence.",
    "settings.awayEmergencyOff" to
        "Votre message d'absence dit aux clients de répondre en cas d'urgence, mais rien ne traitera cette réponse comme telle. Réactivez ce réglage, ou retirez cette offre du message.",
    "settings.awayEmergencyUnknownWord" to
        "Votre message d'absence dit aux clients de répondre {word}, un mot que rien ne surveille. Utilisez plutôt {words}, ajoutez {word} à vos mots d'urgence, ou retirez cette offre du message.",
    "settings.awayEmergencyNotMentioned" to
        "Personne n'a été informé qu'il le pouvait. Mentionnez-le dans votre message d'absence si vous voulez que les clients le sachent.",
    "settings.wordListNothing" to "rien",
    "settings.wordListOr" to " ou ",
    "settings.handoverPromptOffered" to "La propriété de cet espace de travail vous a été offerte.",
    "settings.handoverPromptReady" to "Votre demande de reprise est prête à être conclue.",
    "settings.handoverPromptAsked" to "Vous avez demandé à reprendre cet espace de travail.",
    "settings.handoverPromptBackup" to "Vous êtes le propriétaire de relève.",
    "settings.handoverWithdraw" to "Retirer ma demande",
    "settingsMore.ownershipDecline" to "Refuser",
    "misc.ownershipDetailAcceptOffer" to "En acceptant, vous devenez responsable de la facturation, du plafond de dépenses et de vos numéros ; le propriétaire actuel reste dans l'équipe comme administrateur. Tout le monde est informé dans les deux cas. L'offre expire {when}.",
    "misc.ownershipDetailCompleteClaim" to "Le délai d'attente est écoulé et personne ne l'a arrêté. Terminer cette reprise fait de vous le propriétaire — la facturation, le plafond de dépenses et vos numéros — et place l'ancien propriétaire dans l'équipe comme administrateur.",
    "misc.ownershipDetailClaimWaiting" to "Le propriétaire a reçu un courriel et peut arrêter cette demande jusqu'au {when}. Si personne ne l'arrête, vous pourrez terminer la reprise après ce moment.",
    "misc.ownershipDetailBackupStanding" to "Si le propriétaire ne peut plus accéder au compte un jour — il quitte, il perd l'accès à son courriel, ou pire — vous êtes la seule personne qui peut demander à reprendre. Il a une semaine pour refuser, et toute l'équipe en est informée. Rien ne change tant que vous ne demandez pas.",
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
    "settings.provisionWaitShort" to
        "Nous configurons votre numéro. Cela prend habituellement moins " +
        "d'une minute.",
    "settings.provisionWaitMedium" to
        "Nous configurons encore votre numéro, cela prend un peu plus de " +
        "temps que d'habitude. Patientez un instant.",
    "settings.provisionWaitLong" to
        "Votre numéro prend un peu plus de temps que d'habitude. Nous nous " +
        "en occupons, vous n'avez pas à attendre ici.",
    "settings.numberSetupSlow" to
        "Nous configurons encore votre numéro. Cela prend un peu plus de " +
        "temps que d'habitude.",
    "settings.numberSetupStalled" to
        "La configuration prend plus de temps que prévu. Choisissez un " +
        "numéro pour terminer — vous ne serez pas facturé de nouveau.",
    "settings.numberAreaCodeEmpty" to
        "L'indicatif régional {code} n'a plus de nouveaux numéros pour " +
        "l'instant. Choisissez un autre numéro pour terminer la " +
        "configuration.",
    "settings.numberSetupFailed" to
        "Nous n'avons pas pu terminer la configuration de votre numéro. " +
        "Choisissez un numéro pour réessayer.",
    "settings.offerComeBackOnStarter" to "Revenir sur Starter",
    "settings.offerGetHelp" to "Obtenir de l'aide",
    "settings.offerMissingBody" to "Si ce dont vous aviez besoin n'est pas là, le plus rapide pour que cela change est de nous dire ce que c'était. Nous répondons {when}. {promise}",
    "settings.offerMissingHeading" to "Dites-nous ce qui manquait",
    "settings.offerPausedSeasonalBody" to "Votre numéro et tout votre historique de messages sont conservés aussi longtemps que vous restez en pause — rien n'expire pendant la pause, et il n'y a aucune date de retour à respecter. Annuler plutôt met fin à la pause et démarre un compte à rebours : {days} jours à compter du jour de l'annulation, et non de la fin de votre période de facturation, au terme duquel le numéro retourne à la compagnie de téléphone.",
    "settings.offerPausedSeasonalHeading" to "Votre forfait est déjà en pause, et cette conservation n'a aucune échéance",
    "settings.offerRegistrationFeePaid" to " Vous avez déjà payé les frais d'inscription uniques, et ils sont facturés au plus une fois par espace de travail, à jamais — revenir ne les facture pas de nouveau.",
    "settings.offerSeasonalBody" to "Il continue de recevoir les textos tout du long, alors rien de ce qu'un client envoie n'est perdu — vous ne pouvez pas répondre avant votre retour, et votre historique de messages reste en place. Les {days} jours courent à compter du jour de l'annulation, et non de la fin de votre période de facturation : une saison tranquille plus longue dépasse donc la conservation, et le numéro retourne à la compagnie de téléphone.",
    "settings.offerSeasonalGraceBody" to "Il reçoit encore les textos, alors rien de ce qu'un client envoie n'est perdu, même si vous ne pouvez pas répondre avant votre retour. Cette date est à {days} jours du jour de l'annulation, et non de la fin de votre dernière période de facturation. Réabonnez-vous avant, et le numéro ainsi que tout votre historique de messages reviennent avec vous.",
    "settings.offerSeasonalGraceHeading" to "Votre numéro vous appartient encore jusqu'à la date ci-dessous",
    "settings.offerSeasonalHeading" to "Votre numéro est conservé {days} jours à compter du jour de l'annulation",
    "settings.offerStarterCovers" to "Il couvre {seats} personnes et {numbers} numéros d'entreprise.",
    "settings.offerStarterCoversOne" to "Il couvre {seats} personnes et {numbers} numéro d'entreprise.",
    "settings.offerStarterHeading" to "Starter est le même produit, au prix d'une plus petite équipe",
    "settings.offerStarterHeadingGrace" to "Il existe un forfait plus petit pour revenir",
    "settings.offerStarterPrice" to "Starter coûte {starter} par mois au lieu de {pro}, avec des quantités de textos et d'appels plus petites, sous la même politique d'usage raisonnable.",
    "settings.offerStarterTail" to "Le changement prend effet à la fin de votre période de facturation en cours. Votre historique de messages vous suit, et le numéro d'où vous textez aussi — un deuxième numéro, non : le passage au forfait inférieur est refusé tant que vous ne l'avez pas libéré, et tant que l'équipe n'est pas revenue sous les {seats} places.",
    "settings.offerStarterTailGrace" to "Revenez sur Starter et votre numéro ainsi que tout votre historique de messages vous suivent.",
    "settings.offerStarterTailPaused" to "Votre forfait est en pause : cela se fait donc en deux étapes, dans cet ordre — reprenez d'abord, puis changez de forfait. Le changement prend effet à la fin de votre période de facturation en cours. Votre historique de messages vous suit, et le numéro d'où vous textez aussi — un deuxième numéro, non : le passage au forfait inférieur est refusé tant que vous ne l'avez pas libéré, et tant que l'équipe n'est pas revenue sous les {seats} places.",

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

// ---------------------------------------------------------------------------
// Settings → Help → the route to a human (#382, #253, #321)
// ---------------------------------------------------------------------------

/**
 * The support pre-fill and the questions it exists to make unnecessary.
 *
 * ## Two readers, two languages, one key each
 *
 * A support report is read TWICE. The person writing it reads the screen and the
 * body of the mail their phone opens; we read the subject line. So each sentence
 * is one key with two translations, and the two readers ask for it differently:
 * `supportBody` resolves it in the READER's language, and `supportSubjectFor`
 * resolves the same key against the ENGLISH table on purpose.
 *
 * The subject is the inbox's index. `supportSubjectFor` gives every reporter of
 * one failure the identical subject so a single search finds all of them, and
 * `docs/RELEASING.md` makes the reply a step of every release — that mechanism
 * is what #321's "we write back when it's fixed" promise rests on. A subject
 * line that changed with the reporter's language would split each failure into
 * two piles, and the pattern that matters most, five reports of one thing in a
 * morning, would be the one that stopped being visible.
 *
 * ## The response time is quoted, not translated
 *
 * `{time}` inside `helpReplyPromise` is `SUPPORT_RESPONSE_TIME`, the ONE
 * constant three clients and `SupportPortTest` read. Web interpolates the
 * English into its French for the same reason. It is listed as a known gap in
 * the extraction report rather than quietly forked here — a promise about how
 * fast we answer is not a sentence one client should reword alone.
 *
 * `android` in `supportBodyApp` is the platform's name and is never translated.
 */
private val SUPPORT_EN = mapOf(
    // -- what the person was looking at, for the subject and the body --------
    "settings.supportSituationRegistrationPending" to "US registration is pending approval",
    "settings.supportSituationRegistrationSuspended" to
        "the carrier suspended our US registration",
    "settings.supportSituationUsTextingOff" to "US texting is off for this workspace",
    "settings.supportSituationUsageCap" to "sending is paused at the spending cap",
    "settings.supportSituationSubscription" to "the subscription is not active",
    "settings.supportSituationOptedOut" to "this customer is opted out",
    "settings.supportSituationOptOutHint" to "an opt-out was detected in the thread",
    "settings.supportSituationNumberAccess" to "I do not have texting access to this number",
    "settings.supportSituationReadOnly" to "I have view-only access",

    // -- the subject line, always the English table --------------------------
    "settings.supportSubjectDefault" to "Help with my Loonext workspace",
    "settings.supportSubjectProblem" to "Problem: {situation}",
    "settings.supportSubjectIdea" to "Idea for Loonext",

    // -- the body, which is printed on the screen as well --------------------
    "settings.supportBodyLeadIn" to
        "The details below help us look this up. Please leave them in.",
    "settings.supportBodyWorkspace" to "Workspace: {name} ({id})",
    "settings.supportBodyUnnamed" to "(unnamed)",
    "settings.supportBodyPlan" to "Plan: {plan}",
    "settings.supportBodyApp" to "App: android {version}",
    "settings.supportBodyAppNoVersion" to "App: android",
    "settings.supportBodyScreen" to "Screen: {situation}",
    "settings.supportBodyErrors" to "Recent errors on this device (newest first):",

    // -- what to expect ------------------------------------------------------
    "settings.helpResponseTime" to "within two business days, usually sooner",
    "settings.helpReplyPromise" to
        "We reply {time}. We're a small team, so this is email rather than a chat " +
        "window, and we read everything that comes in. If your texts have stopped " +
        "arriving, say so in the subject line and we'll start there.",
    "settings.helpFixPromise" to
        "If you tell us something's broken, we write back when it's fixed, not just " +
        "when we've read it.",

    // -- the questions the answers already existed for -----------------------
    // STOP and START are carrier keywords: a carrier matches on the literal
    // word, so they are never translated.
    "settings.helpFaqUsSendQ" to "Why won't my text to a US number send?",
    "settings.helpFaqUsSendA" to
        "US carriers require every business number to be registered before it can text US " +
        "phones. Approval usually takes 3 to 7 business days, and there is nothing to do " +
        "while it runs. Calls to US numbers work the whole time, and Canadian texts are " +
        "unaffected.",
    "settings.helpFaqPendingQ" to "What does “registration pending” actually mean?",
    "settings.helpFaqPendingA" to
        "We have submitted your business to the carriers and they have not answered yet. It " +
        "is a queue, not a review of anything you did. You will get an email the moment it " +
        "clears.",
    "settings.helpFaqStoppedQ" to "Why did my number stop sending after it was working?",
    "settings.helpFaqStoppedA" to
        "Two things do that. A carrier can suspend an approved registration, which we are " +
        "told about and act on without you doing anything. Or your workspace has hit the " +
        "spending cap the owner set, which is protection rather than a quota and an owner " +
        "can raise it in Settings.",
    "settings.helpFaqNotGotQ" to "A customer says they never got my text. What now?",
    "settings.helpFaqNotGotA" to
        "Check whether they ever texted STOP: a carrier opt-out blocks us and only the " +
        "customer can lift it, by texting START. If that is not it, email us the customer's " +
        "number and roughly when you sent it, and we can trace the message with the carrier.",
    "settings.helpFaqPortQ" to "How long does moving my existing number take?",
    "settings.helpFaqPortA" to
        "Porting takes 7 to 10 business days once the carrier accepts the request, and your " +
        "old number keeps working the entire time. Nothing goes dark at any point.",
)

private val SUPPORT_FR = mapOf(
    "settings.supportSituationRegistrationPending" to
        "l'inscription américaine est en attente d'approbation",
    "settings.supportSituationRegistrationSuspended" to
        "le fournisseur a suspendu notre inscription américaine",
    "settings.supportSituationUsTextingOff" to
        "les textos américains sont désactivés pour cet espace de travail",
    "settings.supportSituationUsageCap" to
        "l'envoi est suspendu au plafond de dépenses",
    "settings.supportSituationSubscription" to "l'abonnement n'est pas actif",
    "settings.supportSituationOptedOut" to "ce client s'est désabonné",
    "settings.supportSituationOptOutHint" to
        "un désabonnement a été détecté dans la conversation",
    "settings.supportSituationNumberAccess" to
        "je n'ai pas accès aux textos de ce numéro",
    "settings.supportSituationReadOnly" to "j'ai un accès en lecture seule",

    // The subject line is resolved from the ENGLISH table whatever this says —
    // see the header. These exist so the same sentence can be read in French
    // inside the body, from one key rather than two.
    "settings.supportSubjectDefault" to "Aide avec mon espace de travail Loonext",
    "settings.supportSubjectProblem" to "Problème : {situation}",
    "settings.supportSubjectIdea" to "Idée pour Loonext",

    "settings.supportBodyLeadIn" to
        "Les renseignements ci-dessous nous aident à retrouver votre dossier. " +
        "Laissez-les dans le message.",
    "settings.supportBodyWorkspace" to "Espace de travail : {name} ({id})",
    "settings.supportBodyUnnamed" to "(sans nom)",
    "settings.supportBodyPlan" to "Forfait : {plan}",
    "settings.supportBodyApp" to "Application : android {version}",
    "settings.supportBodyAppNoVersion" to "Application : android",
    "settings.supportBodyScreen" to "Écran : {situation}",
    "settings.supportBodyErrors" to
        "Erreurs récentes sur cet appareil (les plus récentes d'abord) :",

    "settings.helpResponseTime" to "within two business days, usually sooner",
    // Copied character for character from web's `appShell.helpReplyPromise`.
    "settings.helpReplyPromise" to
        "Nous répondons {time}. Nous sommes une petite équipe, alors c'est le " +
        "courriel plutôt qu'une fenêtre de clavardage, et nous lisons tout ce qui " +
        "arrive. Si vos textos ont cessé d'arriver, dites-le dans l'objet et nous " +
        "commencerons par là.",
    "settings.helpFixPromise" to
        "Si vous nous signalez un problème, nous vous réécrivons quand il est " +
        "corrigé, pas seulement quand nous l'avons lu.",

    "settings.helpFaqUsSendQ" to
        "Pourquoi mon texto vers un numéro américain ne part-il pas ?",
    "settings.helpFaqUsSendA" to
        "Les fournisseurs américains exigent que chaque numéro d'entreprise soit " +
        "inscrit avant de pouvoir texter des téléphones américains. " +
        "L'approbation prend habituellement de 3 à 7 jours ouvrables, et il n'y a rien " +
        "à faire pendant ce temps. Les appels vers les numéros américains " +
        "fonctionnent tout du long, et les textos canadiens ne sont pas touchés.",
    "settings.helpFaqPendingQ" to
        "Que veut dire « inscription en attente », au juste ?",
    "settings.helpFaqPendingA" to
        "Nous avons soumis votre entreprise aux fournisseurs et ils n'ont pas encore " +
        "répondu. C'est une file d'attente, pas un examen de quoi que ce soit que vous " +
        "auriez fait. Vous recevrez un courriel dès que ce sera réglé.",
    "settings.helpFaqStoppedQ" to
        "Pourquoi mon numéro a-t-il cessé d'envoyer après avoir fonctionné ?",
    "settings.helpFaqStoppedA" to
        "Deux choses causent cela. Un fournisseur peut suspendre une inscription " +
        "approuvée ; on nous en avise et nous agissons sans que vous ayez rien à " +
        "faire. Ou votre espace de travail a atteint le plafond de dépenses fixé " +
        "par le propriétaire, qui est une protection plutôt qu'un quota et qu'un " +
        "propriétaire peut relever dans les paramètres.",
    "settings.helpFaqNotGotQ" to
        "Un client dit qu'il n'a jamais reçu mon texto. Que faire ?",
    "settings.helpFaqNotGotA" to
        "Vérifiez s'il a déjà envoyé STOP : un désabonnement chez le " +
        "fournisseur nous bloque et seul le client peut le lever, en textant START. Si ce " +
        "n'est pas cela, écrivez-nous le numéro du client et le moment approximatif " +
        "de l'envoi, et nous pourrons retracer le message avec le fournisseur.",
    "settings.helpFaqPortQ" to
        "Combien de temps prend le transfert de mon numéro actuel ?",
    "settings.helpFaqPortA" to
        "Le transfert prend de 7 à 10 jours ouvrables une fois que le fournisseur " +
        "accepte la demande, et votre ancien numéro continue de fonctionner pendant tout " +
        "ce temps. Rien ne s'éteint à aucun moment.",
)

// ---------------------------------------------------------------------------
// Settings → a number the plan does not cover (#523)
// ---------------------------------------------------------------------------

/**
 * The words a hold is explained with, on three surfaces.
 *
 * THE "NOT GIVEN UP" CLAUSE IS ONE ENTRY PER GRAMMAR and every sentence quotes
 * it as `{kept}`. It is the half somebody could plan a business around being
 * wrong about: an owner who reads "on hold" and concludes the line is dead tells
 * customers to use a different number, or starts a transfer they do not need.
 * Two copies of it are two chances for one of them to lose the "still reach it"
 * half in an edit.
 *
 * THE PLAN NOTE IS TWO WHOLE SENTENCES rather than a stem with `is`/`are`
 * dropped into it. French agrees a verb, an article and a possessive at once, so
 * a shared stem would have pushed three more fragments into this file for a
 * translator to reassemble blind — the same reason the devices card spells both
 * counts out. The vocabulary is web's own (`settings.ts`): a hold is "en
 * attente", bringing one back is "récupérer", and nothing is ever "abandonné".
 */
private val HOLD_COPY_EN = mapOf(
    "settings.heldKeptOne" to
        "It hasn't been given up: texts and calls still reach it and its " +
        "history is untouched, but you can't send or answer from it while it's on hold.",
    "settings.heldKeptMany" to
        "They haven't been given up: texts and calls still reach them and their " +
        "history is untouched, but you can't send or answer from them while " +
        "they're on hold.",
    // The word between two numbers in a list, and the sentence for the numbers
    // we hold but cannot spell.
    "settings.heldAndJoiner" to " and ",
    "settings.heldCounted" to "{count} held numbers",
    "settings.heldOneOfYours" to "One of your numbers",
    "settings.heldYourHeldNumber" to "your held number",

    "settings.heldPlanNoteOne" to
        "{subject} is on hold — your plan covers fewer numbers than you're " +
        "holding. {kept} The ways to bring it back are on the Numbers screen, on " +
        "the number's own card.",
    "settings.heldPlanNoteMany" to
        "{subject} are on hold — your plan covers fewer numbers than you're " +
        "holding. {kept} The ways to bring them back are on the Numbers screen, on " +
        "each number's own card.",

    "settings.heldNoteAllowance" to
        "This number is on hold — your plan covers fewer numbers than you're " +
        "holding. {kept}",
    "settings.heldAskOwnerAllowance" to
        "Ask an owner or admin — the ways to bring it back are under Billing.",
    "settings.heldNotePastDue" to
        "This number is on hold because the last payment didn't go through. {kept} " +
        "It comes back as soon as the payment method is updated.",
    "settings.heldFixPastDue" to "Update it under Settings › Billing.",
    "settings.heldAskOwnerPastDue" to "Ask an owner or admin to update it under Billing.",
    "settings.heldNoteCanceled" to
        "This number is on hold because the subscription is canceled. {kept} It " +
        "comes back when the subscription does.",
    "settings.heldFixCanceled" to "Resubscribe under Settings › Billing.",
    "settings.heldAskOwnerCanceled" to "Ask an owner or admin to resubscribe under Billing.",
    "settings.heldNoteUnknown" to "This number is on hold. {kept}",
    "settings.heldFixUnknown" to "Settings › Billing has the ways to bring it back.",

    "settings.heldPortNote" to
        "This transfer finished and the number is yours. It's on hold for a billing " +
        "reason, not a transfer one. {kept} Its own card, further up this screen, " +
        "says why and what can be done about it.",

    "settings.heldRoutePaidOrPro" to
        "Bring it back as a paid extra number for {price}, or move to Pro under " +
        "Settings › Billing — either brings it straight back.",
    "settings.heldRoutePaid" to
        "Bring it back as a paid extra number for {price} and it works again " +
        "straight away.",
    "settings.heldRouteHardCap" to
        "Starter tops out at {cap} numbers, so this one needs Pro — the plan " +
        "switch is under Settings › Billing.",
    "settings.heldRouteBilling" to
        "The ways to bring it back are under Settings › Billing.",

    "settings.changePlanScheduled" to
        "Switch to Starter scheduled for the end of this period.",
    "settings.changePlanOnPro" to "You're on Pro now.",
    "settings.changePlanBackOne" to "You're on Pro now, and {subject} is back.",
    "settings.changePlanBackMany" to "You're on Pro now, and {subject} are back.",
)

private val HOLD_COPY_FR = mapOf(
    "settings.heldKeptOne" to
        "Il n'a pas été abandonné : les textos et les appels s'y rendent " +
        "toujours et l'historique est intact, mais vous ne pouvez pas envoyer ni " +
        "répondre à partir de ce numéro tant qu'il est en attente.",
    "settings.heldKeptMany" to
        "Ils n'ont pas été abandonnés : les textos et les appels s'y rendent " +
        "toujours et leur historique est intact, mais vous ne pouvez pas envoyer ni " +
        "répondre à partir de ces numéros tant qu'ils sont en attente.",
    "settings.heldAndJoiner" to " et ",
    "settings.heldCounted" to "{count} numéros en attente",
    "settings.heldOneOfYours" to "Un de vos numéros",
    "settings.heldYourHeldNumber" to "votre numéro en attente",

    "settings.heldPlanNoteOne" to
        "{subject} est en attente — votre forfait couvre moins de numéros que " +
        "vous en avez. {kept} Les façons de le récupérer se trouvent à " +
        "l'écran Numéros, sur la fiche du numéro.",
    "settings.heldPlanNoteMany" to
        "{subject} sont en attente — votre forfait couvre moins de numéros que " +
        "vous en avez. {kept} Les façons de les récupérer se trouvent à " +
        "l'écran Numéros, sur la fiche de chaque numéro.",

    "settings.heldNoteAllowance" to
        "Ce numéro est en attente — votre forfait couvre moins de numéros que " +
        "vous en avez. {kept}",
    "settings.heldAskOwnerAllowance" to
        "Demandez à un propriétaire ou à un administrateur — les " +
        "façons de le récupérer sont sous Facturation.",
    "settings.heldNotePastDue" to
        "Ce numéro est en attente parce que le dernier paiement n'a pas été " +
        "accepté. {kept} Il revient dès que le mode de paiement est mis à jour.",
    "settings.heldFixPastDue" to
        "Mettez-le à jour sous Paramètres › Facturation.",
    "settings.heldAskOwnerPastDue" to
        "Demandez à un propriétaire ou à un administrateur de le mettre à " +
        "jour sous Facturation.",
    "settings.heldNoteCanceled" to
        "Ce numéro est en attente parce que l'abonnement est annulé. {kept} Il " +
        "revient quand l'abonnement revient.",
    "settings.heldFixCanceled" to
        "Réabonnez-vous sous Paramètres › Facturation.",
    "settings.heldAskOwnerCanceled" to
        "Demandez à un propriétaire ou à un administrateur de se réabonner " +
        "sous Facturation.",
    "settings.heldNoteUnknown" to "Ce numéro est en attente. {kept}",
    "settings.heldFixUnknown" to
        "Paramètres › Facturation contient les façons de le récupérer.",

    "settings.heldPortNote" to
        "Ce transfert est terminé et le numéro est à vous. Il est en attente " +
        "pour une raison de facturation, pas de transfert. {kept} Sa propre fiche, plus " +
        "haut sur cet écran, dit pourquoi et ce qu'on peut y faire.",

    "settings.heldRoutePaidOrPro" to
        "Récupérez-le comme numéro supplémentaire payant à {price}, " +
        "ou passez à Pro sous Paramètres › Facturation — les deux le " +
        "ramènent immédiatement.",
    "settings.heldRoutePaid" to
        "Récupérez-le comme numéro supplémentaire payant à {price} " +
        "et il refonctionne immédiatement.",
    "settings.heldRouteHardCap" to
        "Starter plafonne à {cap} numéros : celui-ci exige donc Pro — le " +
        "changement de forfait est sous Paramètres › Facturation.",
    "settings.heldRouteBilling" to
        "Les façons de le récupérer sont sous Paramètres › Facturation.",

    "settings.changePlanScheduled" to
        "Passage à Starter prévu pour la fin de cette période.",
    "settings.changePlanOnPro" to "Vous êtes sur Pro maintenant.",
    "settings.changePlanBackOne" to
        "Vous êtes sur Pro maintenant, et {subject} est de retour.",
    "settings.changePlanBackMany" to
        "Vous êtes sur Pro maintenant, et {subject} sont de retour.",
)

// ---------------------------------------------------------------------------
// Settings → buying the US carrier registration (#525)
// ---------------------------------------------------------------------------

/**
 * The enable-US card, whose French is web's own (`settingsMore.ts`:
 * `regUsTextingDescription`, `regEnableUsAction`, `regEnableUsConfirmTitle`,
 * `regEnableUs`, `regAskOwnerEnableUs`, `usRegTerms`, `usRegRunningTail`,
 * `usRegStartedPaused`, `usRegStartedRunning`) copied character for character.
 *
 * `{window}` is the approval estimate, quoted rather than spelled out in every
 * sentence that mentions it — a card that says one figure in the dialog and
 * another in the note above the button is asking the reader which of us to
 * believe, and `EnableUsPausedTest` counts the spellings. Its English is
 * `US_APPROVAL_WINDOW` in `RegistrationCard.kt`, byte for byte; its French is
 * the one web already uses ("3 à 7 jours ouvrables").
 */
private val REGISTRATION_EN = mapOf(
    // The system document picker, which the transfer and text-enablement
    // uploads both open. Written from the launcher's own callback, long after
    // the composition that started it — see `rememberDocumentPicker`.
    "settings.docWrongKind" to "Use a PDF, PNG, or JPEG up to 10 MB.",
    "settings.docUnreadable" to "Couldn't read that file. Try another one.",

    "settings.usApprovalWindow" to "3 to 7 business days",
    "settings.enableUsCharge" to
        "A one-time {fee} registration fee is charged to your card on file, " +
        "and we register your business with US carriers.",
    "settings.enableUsDescription" to
        "Texting Canadian numbers already works. Texting US numbers needs " +
        "a one-time carrier registration.",
    "settings.enableUsButton" to "Enable US texting: {fee} one-time",
    "settings.enableUsReadOnly" to
        "Ask your account owner to enable US texting; it's a one-time " +
        "{fee} carrier registration.",
    "settings.enableUsPausedNote" to
        "Your plan is paused, and the carriers review this either way — the " +
        "{window} pass while you're quiet instead of costing you a " +
        "week in the spring. Texting US numbers starts the day you resume.",
    "settings.enableUsConfirmTitle" to "Enable US texting?",
    "settings.enableUsConfirmBody" to
        "{charge} Approval usually takes {window}. We handle it and " +
        "email you when it's live.",
    "settings.enableUsConfirmBodyPaused" to
        "{charge} Approval usually takes {window}, and that review runs " +
        "while your plan is paused. You still can't text anyone until you " +
        "resume — US numbers work from the day you do, with no waiting left. " +
        "The fee is charged once per workspace, ever, so waiting until spring " +
        "wouldn't save it.",
    "settings.enableUsConfirmLabel" to "Enable US texting",
    "settings.enableUsStarted" to
        "US registration started. We'll email you when it's approved.",
    "settings.enableUsStartedPaused" to
        "US registration started. We'll email you when the carriers approve it, " +
        "and US texting works when you resume.",
)

private val REGISTRATION_FR = mapOf(
    // « Mo » plutôt que « MB », comme sur le web (`settingsMore.portDocSizeError`).
    "settings.docWrongKind" to "Utilisez un PDF, un PNG ou un JPEG de 10 Mo au maximum.",
    "settings.docUnreadable" to "Impossible de lire ce fichier. Essayez-en un autre.",

    "settings.usApprovalWindow" to "3 à 7 jours ouvrables",
    "settings.enableUsCharge" to
        "Des frais d'inscription uniques de {fee} sont portés à la carte que nous " +
        "avons au dossier, et nous inscrivons votre entreprise auprès des " +
        "fournisseurs américains.",
    "settings.enableUsDescription" to
        "Texter des numéros canadiens fonctionne déjà. Texter des numéros " +
        "américains exige une inscription unique auprès des fournisseurs.",
    "settings.enableUsButton" to
        "Activer les textos américains : {fee} une seule fois",
    "settings.enableUsReadOnly" to
        "Demandez au propriétaire du compte d'activer les textos américains ; " +
        "c'est une inscription unique de {fee} auprès des fournisseurs.",
    "settings.enableUsPausedNote" to
        "Votre forfait est en pause, et les fournisseurs examinent votre demande de toute " +
        "façon — les {window} passent pendant votre saison tranquille au lieu de " +
        "vous coûter une semaine au printemps. Les textos vers les numéros " +
        "américains commencent le jour de votre reprise.",
    "settings.enableUsConfirmTitle" to "Activer les textos vers les États-Unis ?",
    "settings.enableUsConfirmBody" to
        "{charge} L'approbation prend habituellement de {window}. Nous nous en " +
        "occupons et vous écrivons quand c'est en service.",
    "settings.enableUsConfirmBodyPaused" to
        "{charge} L'approbation prend habituellement de {window}, et cet examen se " +
        "déroule pendant que votre forfait est en pause. Vous ne pouvez toujours " +
        "écrire à personne avant votre reprise — les numéros " +
        "américains fonctionnent dès ce jour-là, sans attente restante. Les " +
        "frais sont facturés une seule fois par espace de travail, à jamais : " +
        "attendre au printemps ne les éviterait pas.",
    "settings.enableUsConfirmLabel" to "Activer les textos américains",
    "settings.enableUsStarted" to
        "Inscription américaine lancée. Nous vous écrirons quand elle sera " +
        "approuvée.",
    "settings.enableUsStartedPaused" to
        "Inscription américaine lancée. Nous vous écrirons quand les " +
        "fournisseurs l'auront approuvée, et les textos américains " +
        "fonctionneront à votre reprise.",
)
