import Foundation

/// #228 — the settings screens, N–Z: numbers, transfers, ownership, the US
/// registration, the account, notifications, on-call and referrals.
///
/// The twin of `SettingsMoreStrings.kt`, key for key. `SettingsStrings` holds
/// A–M; the split is the same one Android made, so a translator working a
/// screen finds its strings in the file with the same name.
///
/// The register is `CommonStrings`': Quebec French, VOUVOIEMENT, accents spelled
/// normally, a normal space before the high punctuation. Product names (Loonext,
/// Stripe, Telnyx, Lou) and the carrier keywords (STOP / HELP / START / URGENT)
/// are never translated.
///
/// ## Why this file exists as its own commit
///
/// The screens here were converted to `AppStrings.translate` before this
/// section was written, and `translate` resolves
/// `table(locale)[key] ?? en[key] ?? key` — so every one of these keys rendered
/// its own name, and the settings screens displayed the literal text
/// `settingsMore.signOut`. Nothing threw and no test failed: the hardcoded-string
/// ledger counts literals REMOVED, and a converted-but-undefined key is the
/// absence of a literal. `SettingsMoreKeyParityTests` is the guard that now makes
/// that state impossible, and it is the more important half of this change.
///
/// ## Why the maps are assembled from per-surface pieces
///
/// The same reason `SettingsStrings` gives: one dictionary literal of this many
/// pairs is a type-checking bill Swift sends at build time, and a merge conflict
/// for every agent working on a settings screen. Each surface is its own
/// `private let` with an explicit type, and the two public maps are their sum.

enum SettingsMoreStrings {
    static let section = AppStrings.Section(
        name: "SettingsMoreStrings",
        en: settingsMoreEnglish,
        frCA: settingsMoreFrench
    )
}

/// Fold the per-surface maps into one. Spelled out rather than chained, for the
/// reason `SettingsStrings` gives: this file cannot be compiled on the machine
/// it was written on, so nothing is left to inference.
private func settingsMoreFolded(_ parts: [[String: String]]) -> [String: String] {
    var out: [String: String] = [:]
    for part in parts {
        for (key, value) in part { out[key] = value }
    }
    return out
}

private let settingsMoreEnglish: [String: String] = settingsMoreFolded([
    settingsMoreNumbersEn,
    settingsMorePortEn,
    settingsMoreIdentityEn,
    settingsMoreHoursEn,
    settingsMorePickerEn,
    settingsMoreOwnershipEn,
    settingsMoreRegistrationEn,
    settingsMoreProfileEn,
    settingsMoreNotificationsEn,
    settingsMoreOncallEn,
    settingsMoreReferralEn,
    settingsMoreIosOnlyEn,
    settingsMoreIosDocsEn,
    settingsMoreIosRejectionEn,
    settingsMoreIosEmergencyEn,
    settingsMoreIosRemindersEn,
    settingsMoreIosHelpEn,
    settingsMoreIosHomeEn,
    settingsMoreIosWhatsNewEn,
    settingsMoreIosTwoFactorEn,
    settingsMoreIosTeamEn,
    settingsMoreIosTagsEn,
    settingsMoreIosTemplatesEn,
    settingsMoreIosGreetingEn,
    settingsMoreIosTextEnableEn,
    settingsMoreIosRegistrationEn,
    settingsMoreIosPortEn,
    settingsMoreIosExportEn,
    settingsMoreIosNumbersEn,
])

private let settingsMoreFrench: [String: String] = settingsMoreFolded([
    settingsMoreNumbersFr,
    settingsMorePortFr,
    settingsMoreIdentityFr,
    settingsMoreHoursFr,
    settingsMorePickerFr,
    settingsMoreOwnershipFr,
    settingsMoreRegistrationFr,
    settingsMoreProfileFr,
    settingsMoreNotificationsFr,
    settingsMoreOncallFr,
    settingsMoreReferralFr,
    settingsMoreIosOnlyFr,
    settingsMoreIosDocsFr,
    settingsMoreIosRejectionFr,
    settingsMoreIosEmergencyFr,
    settingsMoreIosRemindersFr,
    settingsMoreIosHelpFr,
    settingsMoreIosHomeFr,
    settingsMoreIosWhatsNewFr,
    settingsMoreIosTwoFactorFr,
    settingsMoreIosTeamFr,
    settingsMoreIosTagsFr,
    settingsMoreIosTemplatesFr,
    settingsMoreIosGreetingFr,
    settingsMoreIosTextEnableFr,
    settingsMoreIosRegistrationFr,
    settingsMoreIosPortFr,
    settingsMoreIosExportFr,
    settingsMoreIosNumbersFr,
])

// --------------------------------------------------------------------------
// Settings → the numbers list
// --------------------------------------------------------------------------

private let settingsMoreNumbersEn: [String: String] = [
    "settingsMore.aNumber": "A number",
    "settingsMore.accessUpdated": "Access to {number} updated.",
    "settingsMore.addNumber": "Add a number",
    "settingsMore.addNumberBilled":
        "An extra number is billed to your plan today. Your message allowance "
        + "is shared, so an extra number doesn't add messages.",
    "settingsMore.addNumberIncluded":
        "Choose the number your customers will text. It's included in your "
        + "plan at no extra cost.",
    "settingsMore.addNumberPriced":
        "An extra number is {price}, billed today. Your message allowance is "
        + "shared, so an extra number doesn't add messages.",
    "settingsMore.adminsAlwaysUse": "Owners and admins can always use every number.",
    "settingsMore.areaCodeIs": "Area code {areaCode}",
    "settingsMore.chooseNumber": "Choose a number",
    "settingsMore.chooseNumberFinish": "Choose a number to finish setup",
    "settingsMore.codeSent": "Sent. Check your email.",
    "settingsMore.copyNumber": "Copy number",
    "settingsMore.keepNumber": "Keep the number",
    "settingsMore.noMembersToPick":
        "No active members to pick. Everyone else on the team is an owner or "
        + "admin.",
    "settingsMore.noNumberYet":
        "No number yet. It's created automatically when your subscription "
        + "starts.",
    "settingsMore.numberBeingSetUp": "Your number is being set up.",
    "settingsMore.numberCopied": "Number copied.",
    "settingsMore.numberReleased": "{number} released.",
    "settingsMore.numberUnreliable": "Messages from this number aren't arriving reliably",
    "settingsMore.onlyAdminsManageNumbers": "Only owners and admins can manage numbers.",
    "settingsMore.pickAtLeastOne": "Pick at least one person, or choose Everyone.",
    "settingsMore.planNumbersInUse": "Your plan's numbers are all in use. {reason}",
    "settingsMore.release": "Release",
    "settingsMore.releaseConfirm": "Release number",
    "settingsMore.releaseTitle": "Release {number}?",
    "settingsMore.releasedAgo": "Released {ago} ago.",
    "settingsMore.setupRestarted": "Setup restarted. You won't be charged again.",
    "settingsMore.sourceHosted": "Text-enabled landline",
    "settingsMore.sourceLoonext": "Loonext number",
    "settingsMore.sourcePorted": "Transferred in",
    "settingsMore.statusActionNeeded": "Action needed",
    "settingsMore.statusActive": "Active",
    "settingsMore.statusFailed": "Couldn't set up",
    "settingsMore.statusReleased": "Released",
    "settingsMore.statusSettingUp": "Setting up",
    "settingsMore.teammate": "Teammate",
    "settingsMore.thisNumber": "this number",
    "settingsMore.typeToConfirm": "Type {number} to confirm",
    "settingsMore.whatYouReach": "What you can reach",
    "settingsMore.whatYouReachDesc":
        "Some of this workspace's numbers are not shared with you. Here is "
        + "which, and what decided it.",
    "settingsMore.whoCanUse": "Who can use this number",
    "settingsMore.whoCanUseNumber": "Who can use {number}?",
    "settingsMore.yourNumber": "Your number",
]

private let settingsMoreNumbersFr: [String: String] = [
    "settingsMore.aNumber": "Un numéro",
    "settingsMore.accessUpdated": "L'accès à {number} a été mis à jour.",
    "settingsMore.addNumber": "Ajouter un numéro",
    "settingsMore.addNumberBilled":
        "Un numéro supplémentaire est facturé à votre forfait aujourd'hui. "
        + "Votre quota de messages est partagé : un numéro de plus n'ajoute pas "
        + "de messages.",
    "settingsMore.addNumberIncluded":
        "Choisissez le numéro auquel vos clients écriront. Il est compris "
        + "dans votre forfait, sans frais supplémentaires.",
    "settingsMore.addNumberPriced":
        "Un numéro supplémentaire coûte {price}, facturé aujourd'hui. Votre "
        + "quota de messages est partagé : un numéro de plus n'ajoute pas de "
        + "messages.",
    "settingsMore.adminsAlwaysUse":
        "Les propriétaires et les admins peuvent toujours utiliser chaque "
        + "numéro.",
    "settingsMore.areaCodeIs": "Indicatif {areaCode}",
    "settingsMore.chooseNumber": "Choisir un numéro",
    "settingsMore.chooseNumberFinish": "Choisir un numéro pour terminer la configuration",
    "settingsMore.codeSent": "Envoyé. Vérifiez vos courriels.",
    "settingsMore.copyNumber": "Copier le numéro",
    "settingsMore.keepNumber": "Garder le numéro",
    "settingsMore.noMembersToPick":
        "Aucun membre actif à choisir. Tous les autres membres de l'équipe "
        + "sont propriétaires ou admins.",
    "settingsMore.noNumberYet":
        "Aucun numéro pour l'instant. Il est créé automatiquement au début de "
        + "votre abonnement.",
    "settingsMore.numberBeingSetUp": "Votre numéro est en cours de configuration.",
    "settingsMore.numberCopied": "Numéro copié.",
    "settingsMore.numberReleased": "{number} libéré.",
    "settingsMore.numberUnreliable": "Les textos de ce numéro n'arrivent pas de façon fiable",
    "settingsMore.onlyAdminsManageNumbers":
        "Seuls les propriétaires et les admins peuvent gérer les numéros.",
    "settingsMore.pickAtLeastOne":
        "Choisissez au moins une personne, ou sélectionnez Tout le monde.",
    "settingsMore.planNumbersInUse":
        "Les numéros de votre forfait sont tous utilisés. {reason}",
    "settingsMore.release": "Libérer",
    "settingsMore.releaseConfirm": "Libérer le numéro",
    "settingsMore.releaseTitle": "Libérer {number} ?",
    "settingsMore.releasedAgo": "Libéré il y a {ago}.",
    "settingsMore.setupRestarted":
        "Configuration relancée. Vous ne serez pas facturé de nouveau.",
    "settingsMore.sourceHosted": "Ligne fixe activée pour les textos",
    "settingsMore.sourceLoonext": "Numéro Loonext",
    "settingsMore.sourcePorted": "Transféré",
    "settingsMore.statusActionNeeded": "Action requise",
    "settingsMore.statusActive": "Actif",
    "settingsMore.statusFailed": "Configuration impossible",
    "settingsMore.statusReleased": "Libéré",
    "settingsMore.statusSettingUp": "Configuration en cours",
    "settingsMore.teammate": "Coéquipier",
    "settingsMore.thisNumber": "ce numéro",
    "settingsMore.typeToConfirm": "Tapez {number} pour confirmer",
    "settingsMore.whatYouReach": "Ce que vous pouvez joindre",
    "settingsMore.whatYouReachDesc":
        "Certains numéros de cet espace de travail ne sont pas partagés avec "
        + "vous. Voici lesquels, et ce qui l'a décidé.",
    "settingsMore.whoCanUse": "Qui peut utiliser ce numéro",
    "settingsMore.whoCanUseNumber": "Qui peut utiliser {number} ?",
    "settingsMore.yourNumber": "Votre numéro",
]

// --------------------------------------------------------------------------
// Settings → bringing a number in
// --------------------------------------------------------------------------

private let settingsMorePortEn: [String: String] = [
    "settingsMore.accountHolder": "Account holder",
    "settingsMore.accountNumber": "Account number",
    "settingsMore.authorizedPerson": "Authorized person",
    "settingsMore.beforeSwitch": "Before your number switches",
    "settingsMore.bridgeNumber": "Temporary number while you wait: {number}.",
    "settingsMore.bringNumber": "Bring your existing number",
    "settingsMore.bringNumberDesc":
        "Transfer a number you already own. It keeps working with your "
        + "current carrier until the switch completes, usually a few business "
        + "days. Transfers are free.",
    "settingsMore.canBeTransferred": "{number} can be transferred.",
    "settingsMore.cancelTransfer": "Cancel transfer",
    "settingsMore.cancelTransferBody":
        "Your number stays with your current carrier and nothing changes "
        + "there. You can start a new transfer any time.",
    "settingsMore.cancelTransferTitle": "Cancel this transfer?",
    "settingsMore.city": "City",
    "settingsMore.enterFullNanp": "Enter a full 10-digit US or Canadian number.",
    "settingsMore.fixResubmit": "Fix and resubmit",
    "settingsMore.focDate": "The carriers agreed on a switch date: {date}.",
    "settingsMore.keepItGoing": "Keep it going",
    "settingsMore.last4Of": "Last 4 of {idLabel}",
    "settingsMore.mayNotText":
        "Heads up: this number may not support texting after the transfer. "
        + "Calls will still work.",
    "settingsMore.notPortable": "That number can't be transferred automatically.",
    "settingsMore.numberToTransfer": "Number to transfer",
    "settingsMore.phoneSample": "(416) 555-0182",
    "settingsMore.portDocsNote":
        "Two documents are needed: a signed letter of authorization and a "
        + "recent bill from your current carrier (PDF, PNG, or JPEG).",
    "settingsMore.portFormIntro":
        "Enter these exactly as they appear on your current carrier's bill. "
        + "Mismatches are the top cause of rejections.",
    "settingsMore.portWirelessNote":
        "This is a mobile number. Enter the transfer PIN and the last 4 of "
        + "the account holder's {idLabel}. We store only the last 4.",
    "settingsMore.reenterSecrets":
        "The account number and PIN are never shown back for security. "
        + "Re-enter them.",
    "settingsMore.registrationHeld":
        "Your number arrived, but its texting registration is still held by "
        + "your previous texting provider. Ask them to release it, and texting "
        + "switches on automatically.",
    "settingsMore.startTransfer": "Start a transfer",
    "settingsMore.streetAddress": "Street address",
    "settingsMore.transferCancelled": "Transfer cancelled.",
    "settingsMore.transferCreated": "Transfer created. Upload the two documents to submit it.",
    "settingsMore.transferPin": "Transfer PIN",
    "settingsMore.transferResubmitted": "Transfer resubmitted.",
    "settingsMore.transferSubmitted": "Transfer submitted to the carriers.",
    "settingsMore.transferTitle": "Transfer: {number}",
    "settingsMore.uploading": "Uploading…",
    "settingsMore.wantBridge": "Give me a temporary number while it transfers",
    "settingsMore.wantBridgeSupporting":
        "Optional. Texting starts right away on the temporary number; your "
        + "own number takes over when the transfer completes.",
    "settingsMore.wirelessRequires":
        "It's a mobile number, so a transfer PIN and ID check are required.",
]

private let settingsMorePortFr: [String: String] = [
    "settingsMore.accountHolder": "Titulaire du compte",
    "settingsMore.accountNumber": "Numéro de compte",
    "settingsMore.authorizedPerson": "Personne autorisée",
    "settingsMore.beforeSwitch": "Avant la bascule de votre numéro",
    "settingsMore.bridgeNumber": "Numéro temporaire pendant l'attente : {number}.",
    "settingsMore.bringNumber": "Transférer votre numéro actuel",
    "settingsMore.bringNumberDesc":
        "Transférez un numéro que vous possédez déjà. Il continue de "
        + "fonctionner chez votre fournisseur actuel jusqu'à la bascule, "
        + "généralement en quelques jours ouvrables. Les transferts sont "
        + "gratuits.",
    "settingsMore.canBeTransferred": "{number} peut être transféré.",
    "settingsMore.cancelTransfer": "Annuler le transfert",
    "settingsMore.cancelTransferBody":
        "Votre numéro reste chez votre fournisseur actuel et rien n'y change. "
        + "Vous pouvez démarrer un nouveau transfert à tout moment.",
    "settingsMore.cancelTransferTitle": "Annuler ce transfert ?",
    "settingsMore.city": "Ville",
    "settingsMore.enterFullNanp":
        "Entrez un numéro américain ou canadien complet à 10 chiffres.",
    "settingsMore.fixResubmit": "Corriger et soumettre de nouveau",
    "settingsMore.focDate":
        "Les fournisseurs se sont entendus sur une date de bascule : {date}.",
    "settingsMore.keepItGoing": "Poursuivre",
    "settingsMore.last4Of": "4 derniers chiffres du {idLabel}",
    "settingsMore.mayNotText":
        "À noter : ce numéro pourrait ne pas prendre les textos après le "
        + "transfert. Les appels fonctionneront quand même.",
    "settingsMore.notPortable": "Ce numéro ne peut pas être transféré automatiquement.",
    "settingsMore.numberToTransfer": "Numéro à transférer",
    "settingsMore.phoneSample": "(416) 555-0182",
    "settingsMore.portDocsNote":
        "Deux documents sont requis : une lettre d'autorisation signée et une "
        + "facture récente de votre fournisseur actuel (PDF, PNG ou JPEG).",
    "settingsMore.portFormIntro":
        "Entrez ces renseignements exactement comme ils apparaissent sur la "
        + "facture de votre fournisseur actuel. Les écarts sont la première "
        + "cause de refus.",
    "settingsMore.portWirelessNote":
        "Il s'agit d'un numéro mobile. Entrez le NIP de transfert et les 4 "
        + "derniers chiffres du {idLabel} du titulaire. Nous ne conservons que "
        + "les 4 derniers.",
    "settingsMore.reenterSecrets":
        "Le numéro de compte et le NIP ne sont jamais réaffichés, par "
        + "sécurité. Entrez-les de nouveau.",
    "settingsMore.registrationHeld":
        "Votre numéro est arrivé, mais son inscription pour les textos est "
        + "encore retenue par votre ancien fournisseur de textos. Demandez-lui "
        + "de la libérer et les textos s'activeront automatiquement.",
    "settingsMore.startTransfer": "Démarrer un transfert",
    "settingsMore.streetAddress": "Adresse",
    "settingsMore.transferCancelled": "Transfert annulé.",
    "settingsMore.transferCreated":
        "Transfert créé. Téléversez les deux documents pour le soumettre.",
    "settingsMore.transferPin": "NIP de transfert",
    "settingsMore.transferResubmitted": "Transfert soumis de nouveau.",
    "settingsMore.transferSubmitted": "Transfert soumis aux fournisseurs.",
    "settingsMore.transferTitle": "Transfert : {number}",
    "settingsMore.uploading": "Téléversement…",
    "settingsMore.wantBridge": "Donnez-moi un numéro temporaire pendant le transfert",
    "settingsMore.wantBridgeSupporting":
        "Facultatif. Les textos démarrent tout de suite sur le numéro "
        + "temporaire ; votre propre numéro prend le relais à la fin du "
        + "transfert.",
    "settingsMore.wirelessRequires":
        "C'est un numéro mobile : un NIP de transfert et une vérification "
        + "d'identité sont requis.",
]

// --------------------------------------------------------------------------
// Settings → what a caller reaches
// --------------------------------------------------------------------------

private let settingsMoreIdentityEn: [String: String] = [
    "settingsMore.afterHoursCalls": "After-hours calls",
    "settingsMore.afterHoursHint":
        "Outside this line's hours. With nobody on call, the last two still "
        + "differ — one rings the crew anyway, the other takes a message.",
    "settingsMore.afterHoursOnCallOnly": "Ring only whoever's on call",
    "settingsMore.afterHoursReplyHint":
        "The text sent when somebody messages this line outside your hours.",
    "settingsMore.afterHoursReplyTitle": "After-hours reply",
    "settingsMore.afterHoursRingEveryone": "Ring everyone, day or night",
    "settingsMore.afterHoursVoicemail": "Take a message",
    "settingsMore.lineNameHint":
        "Used in the greeting, on missed-call texts, and wherever this line "
        + "introduces itself.",
    "settingsMore.lineNameTitle": "Name for this line",
    "settingsMore.missedCallBackHint": "Sent from this line when a call goes unanswered.",
    "settingsMore.missedCallBackTitle": "Text back a missed caller",
    "settingsMore.missedCallTextHint":
        "What a caller gets when nobody picks up and they hang up.",
    "settingsMore.missedCallTextTitle": "Missed-call text",
    "settingsMore.numberIdentityIntro":
        "Anything you leave alone follows your workspace. Change one here and "
        + "it only affects this number.",
    "settingsMore.numberIdentityTitle": "How this line answers",
    "settingsMore.recordingFallbackHint":
        "A recording that will not play falls back to the words below, so a "
        + "caller never hears silence.",
    "settingsMore.ringAll": "All at once",
    "settingsMore.ringHow": "How the phones ring",
    "settingsMore.ringHowLong": "How long they ring",
    "settingsMore.ringInTurn": "One at a time",
    "settingsMore.ringSeconds": "{seconds} seconds",
    "settingsMore.voicemailGreetingHint": "What a caller hears when nobody picks up.",
    "settingsMore.voicemailGreetingTitle": "Voicemail greeting",
    "settingsMore.voicemailVoice": "Voicemail voice",
    "settingsMore.writtenGreeting": "The written greeting, read aloud",
]

private let settingsMoreIdentityFr: [String: String] = [
    "settingsMore.afterHoursCalls": "Appels hors des heures",
    "settingsMore.afterHoursHint":
        "En dehors des heures de cette ligne. Sans personne de garde, les "
        + "deux derniers choix diffèrent encore : l'un fait sonner l'équipe "
        + "quand même, l'autre prend un message.",
    "settingsMore.afterHoursOnCallOnly": "Faire sonner seulement la personne de garde",
    "settingsMore.afterHoursReplyHint":
        "Le texto envoyé quand quelqu'un écrit à cette ligne en dehors de vos "
        + "heures.",
    "settingsMore.afterHoursReplyTitle": "Réponse hors des heures",
    "settingsMore.afterHoursRingEveryone": "Faire sonner tout le monde, jour et nuit",
    "settingsMore.afterHoursVoicemail": "Prendre un message",
    "settingsMore.lineNameHint":
        "Utilisé dans le message d'accueil, dans les textos d'appel manqué et "
        + "partout où cette ligne se présente.",
    "settingsMore.lineNameTitle": "Nom de cette ligne",
    "settingsMore.missedCallBackHint":
        "Envoyé depuis cette ligne quand un appel reste sans réponse.",
    "settingsMore.missedCallBackTitle": "Renvoyer un texto à un appelant manqué",
    "settingsMore.missedCallTextHint":
        "Ce qu'un appelant reçoit quand personne ne répond et qu'il "
        + "raccroche.",
    "settingsMore.missedCallTextTitle": "Texto d'appel manqué",
    "settingsMore.numberIdentityIntro":
        "Tout ce que vous ne touchez pas suit votre espace de travail. Un "
        + "changement ici ne vise que ce numéro.",
    "settingsMore.numberIdentityTitle": "Comment cette ligne répond",
    "settingsMore.recordingFallbackHint":
        "Un enregistrement qui ne joue pas est remplacé par les mots "
        + "ci-dessous : un appelant n'entend jamais le silence.",
    "settingsMore.ringAll": "Tous en même temps",
    "settingsMore.ringHow": "Comment les téléphones sonnent",
    "settingsMore.ringHowLong": "Combien de temps ils sonnent",
    "settingsMore.ringInTurn": "Un à la fois",
    "settingsMore.ringSeconds": "{seconds} secondes",
    "settingsMore.voicemailGreetingHint": "Ce qu'un appelant entend quand personne ne répond.",
    "settingsMore.voicemailGreetingTitle": "Message de la boîte vocale",
    "settingsMore.voicemailVoice": "Voix de la boîte vocale",
    "settingsMore.writtenGreeting": "Le message écrit, lu à voix haute",
]

// --------------------------------------------------------------------------
// Settings → when a line is open
// --------------------------------------------------------------------------

private let settingsMoreHoursEn: [String: String] = [
    "settingsMore.chooseTimezone": "Choose a timezone",
    "settingsMore.inheritSame": "Same as your workspace",
    "settingsMore.inheritUse": "Use the workspace's",
    "settingsMore.numberHoursIntro":
        "The after-hours reply on this number follows this clock. Leave it "
        + "alone and it follows your workspace.",
    "settingsMore.numberHoursTitle": "When this line is open",
    "settingsMore.openHours": "Open hours",
    "settingsMore.timezone": "Timezone",
]

private let settingsMoreHoursFr: [String: String] = [
    "settingsMore.chooseTimezone": "Choisir un fuseau horaire",
    "settingsMore.inheritSame": "Comme votre espace de travail",
    "settingsMore.inheritUse": "Utiliser celui de l'espace de travail",
    "settingsMore.numberHoursIntro":
        "La réponse hors des heures sur ce numéro suit cet horaire. "
        + "Laissez-le tel quel et il suit votre espace de travail.",
    "settingsMore.numberHoursTitle": "Heures d'ouverture de cette ligne",
    "settingsMore.openHours": "Heures d'ouverture",
    "settingsMore.timezone": "Fuseau horaire",
]

// --------------------------------------------------------------------------
// Settings → choosing a new number
// --------------------------------------------------------------------------

private let settingsMorePickerEn: [String: String] = [
    "settingsMore.areaCode": "Area code",
    "settingsMore.containsDigits": "Contains digits",
    "settingsMore.enterAreaCode": "Enter the 3-digit area code you want above.",
    "settingsMore.inAreaCode": " in {areaCode}",
    "settingsMore.maskedPick":
        "Canadian numbers are assigned when the order goes through, so your "
        + "pick here is the area code. There are numbers available{where}.",
    "settingsMore.noNumberContains":
        "No available number contains \"{digits}\". Loosen the filter or "
        + "refresh for a new batch.",
    "settingsMore.noNumbersBack":
        "No numbers came back. Refresh for a new batch, or try another area "
        + "code.",
    "settingsMore.noNumbersIn":
        "No numbers in {areaCode} right now. Nearby area codes usually have "
        + "plenty.",
    "settingsMore.ordering": "Ordering…",
    "settingsMore.refresh": "Refresh",
    "settingsMore.refreshList": "Refresh the list",
    "settingsMore.showNearby": "Show nearby numbers",
    "settingsMore.showingNearby":
        "Showing nearby numbers. The exact area code is out of stock.",
    "settingsMore.thatAreaCode": "that area code",
    "settingsMore.useAreaCode": "Use area code {areaCode}",
]

private let settingsMorePickerFr: [String: String] = [
    "settingsMore.areaCode": "Indicatif régional",
    "settingsMore.containsDigits": "Contient les chiffres",
    "settingsMore.enterAreaCode":
        "Entrez ci-dessus l'indicatif régional à 3 chiffres que vous voulez.",
    "settingsMore.inAreaCode": " dans le {areaCode}",
    "settingsMore.maskedPick":
        "Les numéros canadiens sont attribués au moment de la commande : "
        + "votre choix ici est l'indicatif régional. Des numéros sont "
        + "disponibles{where}.",
    "settingsMore.noNumberContains":
        "Aucun numéro disponible ne contient « {digits} ». Élargissez le "
        + "filtre ou actualisez pour une nouvelle sélection.",
    "settingsMore.noNumbersBack":
        "Aucun numéro n'est revenu. Actualisez pour une nouvelle sélection ou "
        + "essayez un autre indicatif régional.",
    "settingsMore.noNumbersIn":
        "Aucun numéro dans le {areaCode} en ce moment. Les indicatifs voisins "
        + "en ont presque toujours.",
    "settingsMore.ordering": "Commande en cours…",
    "settingsMore.refresh": "Actualiser",
    "settingsMore.refreshList": "Actualiser la liste",
    "settingsMore.showNearby": "Montrer les numéros voisins",
    "settingsMore.showingNearby":
        "Voici des numéros voisins. L'indicatif exact est en rupture.",
    "settingsMore.thatAreaCode": "cet indicatif régional",
    "settingsMore.useAreaCode": "Utiliser l'indicatif {areaCode}",
]

// --------------------------------------------------------------------------
// Settings → who owns the workspace
// --------------------------------------------------------------------------

private let settingsMoreOwnershipEn: [String: String] = [
    "settingsMore.aTeammate": "a teammate",
    "settingsMore.aTeammateCapital": "A teammate",
    "settingsMore.askTakeOver": "Ask to take over",
    "settingsMore.backupCleared": "Backup owner cleared.",
    "settingsMore.backupOwner": "Backup owner",
    "settingsMore.backupOwnerExplain":
        "If you ever can't get in — you lose your email, or worse — this is "
        + "the one person who can ask to take over. They wait a week, you can "
        + "stop it with one click, and everyone gets told. Nothing changes "
        + "today.",
    "settingsMore.backupSet": "{name} is your backup owner.",
    "settingsMore.chooseTeammate": "Choose a teammate",
    "settingsMore.claimAsked": "Asked. The owner has 7 days to stop it.",
    "settingsMore.claimBody":
        "The owner will be emailed straight away and can stop this with one "
        + "click for the next 7 days. Everyone on the team is told too. If "
        + "nobody stops it, you can complete the takeover after 7 days. Only do "
        + "this if the owner genuinely cannot act.",
    "settingsMore.claimExplain":
        "If the owner can't act, you can ask to take over. They get a week to "
        + "stop it, and everyone on the team is told straight away.",
    "settingsMore.claimTitle": "Ask to take over this workspace?",
    "settingsMore.handItOver": "Hand it over",
    "settingsMore.handOverNote": "They have to accept. You stay on the team as an admin.",
    "settingsMore.handOverTitle": "Hand the workspace over",
    "settingsMore.handToTitle": "Hand this workspace to {name}?",
    "settingsMore.handoverStopped": "Stopped. Nothing changed hands.",
    "settingsMore.inviteBackupFirst": "Invite someone first — a backup has to be on the team.",
    "settingsMore.nobody": "Nobody",
    "settingsMore.nobodyNamed": "Nobody named",
    "settingsMore.nowOwn": "You now own this workspace.",
    "settingsMore.offeredTo": "Offered to {name}. They have 7 days to accept.",
    "settingsMore.owner": "Owner",
    "settingsMore.ownershipCaption": "OWNERSHIP",
    "settingsMore.ownershipDesc":
        "The owner controls billing, the spending cap, and your numbers. Only "
        + "they can hand that on.",
    "settingsMore.ownershipTitle": "Ownership",
    "settingsMore.them": "them",
    "settingsMore.you": "You",
    "settingsMore.youAreBackup": "You are the backup owner",
]

private let settingsMoreOwnershipFr: [String: String] = [
    "settingsMore.aTeammate": "un coéquipier",
    "settingsMore.aTeammateCapital": "Un coéquipier",
    "settingsMore.askTakeOver": "Demander à reprendre",
    "settingsMore.backupCleared": "Propriétaire suppléant retiré.",
    "settingsMore.backupOwner": "Propriétaire suppléant",
    "settingsMore.backupOwnerExplain":
        "Si un jour vous ne pouvez plus entrer — vous perdez votre courriel, "
        + "ou pire — voici la seule personne qui peut demander à reprendre "
        + "l'espace de travail. Elle attend une semaine, vous pouvez l'arrêter "
        + "d'un seul clic, et tout le monde en est informé. Rien ne change "
        + "aujourd'hui.",
    "settingsMore.backupSet": "{name} est votre propriétaire suppléant.",
    "settingsMore.chooseTeammate": "Choisir un coéquipier",
    "settingsMore.claimAsked": "Demande envoyée. Le propriétaire a 7 jours pour l'arrêter.",
    "settingsMore.claimBody":
        "Le propriétaire recevra un courriel sur-le-champ et pourra arrêter "
        + "cette demande d'un seul clic pendant les 7 prochains jours. Toute "
        + "l'équipe en est informée aussi. Si personne ne l'arrête, vous "
        + "pourrez conclure la reprise après 7 jours. Ne faites cela que si le "
        + "propriétaire est vraiment incapable d'agir.",
    "settingsMore.claimExplain":
        "Si le propriétaire ne peut pas agir, vous pouvez demander à "
        + "reprendre l'espace de travail. Il a une semaine pour l'arrêter, et "
        + "toute l'équipe en est informée sur-le-champ.",
    "settingsMore.claimTitle": "Demander à reprendre cet espace de travail ?",
    "settingsMore.handItOver": "Céder",
    "settingsMore.handOverNote":
        "La personne doit accepter. Vous restez dans l'équipe comme admin.",
    "settingsMore.handOverTitle": "Céder l'espace de travail",
    "settingsMore.handToTitle": "Céder cet espace de travail à {name} ?",
    "settingsMore.handoverStopped": "Arrêté. Rien n'a changé de mains.",
    "settingsMore.inviteBackupFirst":
        "Invitez d'abord quelqu'un — un suppléant doit faire partie de "
        + "l'équipe.",
    "settingsMore.nobody": "Personne",
    "settingsMore.nobodyNamed": "Personne de désigné",
    "settingsMore.nowOwn": "Vous êtes maintenant propriétaire de cet espace de travail.",
    "settingsMore.offeredTo": "Proposé à {name}. La personne a 7 jours pour accepter.",
    "settingsMore.owner": "Propriétaire",
    "settingsMore.ownershipCaption": "PROPRIÉTÉ",
    "settingsMore.ownershipDesc":
        "Le propriétaire contrôle la facturation, le plafond de dépenses et "
        + "vos numéros. Lui seul peut céder ce rôle.",
    "settingsMore.ownershipTitle": "Propriété",
    "settingsMore.them": "cette personne",
    "settingsMore.you": "Vous",
    "settingsMore.youAreBackup": "Vous êtes le propriétaire suppléant",
]

// --------------------------------------------------------------------------
// Settings → US texting registration
// --------------------------------------------------------------------------

private let settingsMoreRegistrationEn: [String: String] = [
    "settingsMore.agoSuffix": " {ago} ago",
    "settingsMore.businessIdentity": "Business identity",
    "settingsMore.messagingCampaign": "Messaging campaign",
    "settingsMore.newPinSent": "A new PIN is on its way.",
    "settingsMore.notNow": "Not now",
    "settingsMore.onlyAdminsRegistration": "Only owners and admins can change registration.",
    "settingsMore.otpVerified": "Verified. The registry review continues.",
    "settingsMore.regApproved": "Approved",
    "settingsMore.regDraft": "Draft",
    "settingsMore.regDraftLine": "Draft · not submitted yet",
    "settingsMore.regInReview": "In review",
    "settingsMore.regNotStarted": "Not started",
    "settingsMore.regRejected": "Rejected",
    "settingsMore.registrationNotStarted":
        "Registration hasn't started yet. It's created automatically when "
        + "your subscription starts.",
    "settingsMore.registrationResubmitted": "Registration resubmitted.",
    "settingsMore.sixDigitPin": "6-digit PIN",
    "settingsMore.solePropPin":
        "One more step: the registry texted a 6-digit PIN to your registered "
        + "mobile to confirm it's really you.",
    "settingsMore.submittedSuffix": " · submitted {ago} ago",
    "settingsMore.textingRegistration": "Texting registration",
    "settingsMore.textingRegistrationDesc":
        "US carriers require every business texter to register (10DLC). "
        + "Approval usually takes a few days; texting US numbers starts once "
        + "both steps are approved.",
    "settingsMore.usTexting": "US texting",
]

private let settingsMoreRegistrationFr: [String: String] = [
    "settingsMore.agoSuffix": " il y a {ago}",
    "settingsMore.businessIdentity": "Identité de l'entreprise",
    "settingsMore.messagingCampaign": "Campagne de messagerie",
    "settingsMore.newPinSent": "Un nouveau NIP est en route.",
    "settingsMore.notNow": "Pas maintenant",
    "settingsMore.onlyAdminsRegistration":
        "Seuls les propriétaires et les admins peuvent modifier "
        + "l'inscription.",
    "settingsMore.otpVerified": "Vérifié. La révision du registre se poursuit.",
    "settingsMore.regApproved": "Approuvé",
    "settingsMore.regDraft": "Brouillon",
    "settingsMore.regDraftLine": "Brouillon · pas encore soumis",
    "settingsMore.regInReview": "En révision",
    "settingsMore.regNotStarted": "Pas commencé",
    "settingsMore.regRejected": "Refusé",
    "settingsMore.registrationNotStarted":
        "L'inscription n'a pas encore commencé. Elle est créée "
        + "automatiquement au début de votre abonnement.",
    "settingsMore.registrationResubmitted": "Inscription soumise de nouveau.",
    "settingsMore.sixDigitPin": "NIP à 6 chiffres",
    "settingsMore.solePropPin":
        "Une dernière étape : le registre a envoyé un NIP à 6 chiffres par "
        + "texto à votre mobile inscrit pour confirmer que c'est bien vous.",
    "settingsMore.submittedSuffix": " · soumis il y a {ago}",
    "settingsMore.textingRegistration": "Inscription pour les textos",
    "settingsMore.textingRegistrationDesc":
        "Les fournisseurs américains exigent que chaque entreprise qui texte "
        + "s'inscrive (10DLC). L'approbation prend généralement quelques jours "
        + "; les textos vers les numéros américains démarrent une fois les deux "
        + "étapes approuvées.",
    "settingsMore.usTexting": "Textos vers les États-Unis",
]

// --------------------------------------------------------------------------
// Settings → the account itself
// --------------------------------------------------------------------------

private let settingsMoreProfileEn: [String: String] = [
    "settingsMore.account": "Account",
    "settingsMore.atLeast8": "At least 8 characters.",
    "settingsMore.changeEmail": "Change email",
    "settingsMore.changePassword": "Change or set password",
    "settingsMore.codeFromEmail": "Code from the email",
    "settingsMore.emailConfirmSent":
        "Check both inboxes. Confirmation links went to your old and new "
        + "address. Nothing changes until you confirm.",
    "settingsMore.enterNewEmail": "Enter your new email address.",
    "settingsMore.nameLength": "1 to 80 characters.",
    "settingsMore.nameSaved": "Name saved.",
    "settingsMore.newEmail": "New email",
    "settingsMore.newPassword": "New password",
    "settingsMore.passwordOauthNote":
        "If you signed up with Google or Apple, this sets a password you can "
        + "also sign in with.",
    "settingsMore.passwordTooShort": "Use at least 8 characters.",
    "settingsMore.passwordUpdated": "Password updated.",
    "settingsMore.reauthCodeNote":
        "To confirm it's you, we emailed you a one-time code. Enter it here "
        + "and save again.",
    "settingsMore.signOut": "Sign out",
    "settingsMore.signOutThisDevice": "Sign out on this device",
    "settingsMore.signedInAs": "Signed in as {email}.",
    "settingsMore.theme": "Theme",
    "settingsMore.yourName": "Your name",
    "settingsMore.yourNameDesc":
        "Shown to teammates on messages, notes, tasks, and the members list.",
]

private let settingsMoreProfileFr: [String: String] = [
    "settingsMore.account": "Compte",
    "settingsMore.atLeast8": "Au moins 8 caractères.",
    "settingsMore.changeEmail": "Changer le courriel",
    "settingsMore.changePassword": "Changer ou définir le mot de passe",
    "settingsMore.codeFromEmail": "Code reçu par courriel",
    "settingsMore.emailConfirmSent":
        "Vérifiez les deux boîtes de réception. Des liens de confirmation ont "
        + "été envoyés à votre ancienne et à votre nouvelle adresse. Rien ne "
        + "change tant que vous n'avez pas confirmé.",
    "settingsMore.enterNewEmail": "Entrez votre nouvelle adresse courriel.",
    "settingsMore.nameLength": "De 1 à 80 caractères.",
    "settingsMore.nameSaved": "Nom enregistré.",
    "settingsMore.newEmail": "Nouveau courriel",
    "settingsMore.newPassword": "Nouveau mot de passe",
    "settingsMore.passwordOauthNote":
        "Si vous vous êtes inscrit avec Google ou Apple, ceci définit un mot "
        + "de passe avec lequel vous pourrez aussi vous connecter.",
    "settingsMore.passwordTooShort": "Utilisez au moins 8 caractères.",
    "settingsMore.passwordUpdated": "Mot de passe mis à jour.",
    "settingsMore.reauthCodeNote":
        "Pour confirmer que c'est bien vous, nous vous avons envoyé un code à "
        + "usage unique par courriel. Entrez-le ici et enregistrez de nouveau.",
    "settingsMore.signOut": "Déconnexion",
    "settingsMore.signOutThisDevice": "Se déconnecter sur cet appareil",
    "settingsMore.signedInAs": "Connecté en tant que {email}.",
    "settingsMore.theme": "Thème",
    "settingsMore.yourName": "Votre nom",
    "settingsMore.yourNameDesc":
        "Affiché à vos coéquipiers sur les messages, les notes, les tâches et "
        + "la liste des membres.",
]

// --------------------------------------------------------------------------
// Settings → what buzzes a phone
// --------------------------------------------------------------------------

private let settingsMoreNotificationsEn: [String: String] = [
    "settingsMore.emailBouncingBody":
        "Emails to this address are bouncing, so we've stopped sending them. "
        + "Push notifications still work. If the address was mistyped, fix it "
        + "in your account first, then tell us to try again.",
    "settingsMore.emailComplainedBody":
        "This address reported our email as spam, so we've stopped sending to "
        + "it for good. Push notifications still work. To get email again, "
        + "change your account to a different address.",
    "settingsMore.emailRetryQueued": "We'll try that address again on your next notification.",
    "settingsMore.emailUnreachableTitle": "We can't email you at {email}",
    "settingsMore.leadChaseLabel": "Tell the whole crew after {minutes} minutes",
    "settingsMore.leadChaseSupporting":
        "When a conversation is assigned to one person and they still haven't "
        + "replied, notify everyone who can see it. Business hours only, and "
        + "never someone who has turned their own notifications off. This one "
        + "is for the whole workspace, not just you",
    "settingsMore.notifAlwaysOn":
        "Billing, usage, and registration emails always go to owners and "
        + "admins. They can't be turned off.",
    "settingsMore.pushContentLabel": "Show message text on lock screens",
    "settingsMore.pushContentSupporting":
        "Notifications show who texted and the first line of what they said, "
        + "so the crew can tell a lead from a \"thanks\" without unlocking. "
        + "Turn this off and they'll still see who it was, but never what a "
        + "customer wrote — useful if phones are out on the job, in other "
        + "people's homes. This one is for the whole workspace, not just you",
]

private let settingsMoreNotificationsFr: [String: String] = [
    "settingsMore.emailBouncingBody":
        "Les courriels envoyés à cette adresse rebondissent, alors nous avons "
        + "cessé d'en envoyer. Les notifications poussées fonctionnent "
        + "toujours. Si l'adresse comporte une faute, corrigez-la d'abord dans "
        + "votre compte, puis demandez-nous de réessayer.",
    "settingsMore.emailComplainedBody":
        "Cette adresse a signalé nos courriels comme indésirables, alors nous "
        + "avons cessé définitivement d'y écrire. Les notifications poussées "
        + "fonctionnent toujours. Pour recevoir des courriels de nouveau, "
        + "changez l'adresse de votre compte.",
    "settingsMore.emailRetryQueued":
        "Nous réessaierons cette adresse à votre prochaine notification.",
    "settingsMore.emailUnreachableTitle": "Impossible de vous écrire à {email}",
    "settingsMore.leadChaseLabel": "Avertir toute l'équipe après {minutes} minutes",
    "settingsMore.leadChaseSupporting":
        "Quand une conversation est assignée à une personne et qu'elle n'a "
        + "toujours pas répondu, avertir tous ceux qui peuvent la voir. Pendant "
        + "les heures d'ouverture seulement, et jamais quelqu'un qui a "
        + "désactivé ses propres notifications. Ce réglage vaut pour tout "
        + "l'espace de travail, pas seulement pour vous",
    "settingsMore.notifAlwaysOn":
        "Les courriels de facturation, d'utilisation et d'inscription vont "
        + "toujours aux propriétaires et aux admins. Impossible de les "
        + "désactiver.",
    "settingsMore.pushContentLabel": "Afficher le texte des messages sur l'écran verrouillé",
    "settingsMore.pushContentSupporting":
        "Les notifications montrent qui a écrit et la première ligne du "
        + "texto, pour que l'équipe distingue un client potentiel d'un « merci "
        + "» sans déverrouiller. Désactivez ce réglage et l'équipe verra encore "
        + "qui a écrit, mais jamais ce que le client a dit — utile si les "
        + "téléphones sortent sur les chantiers, chez les clients. Ce réglage "
        + "vaut pour tout l'espace de travail, pas seulement pour vous",
]

// --------------------------------------------------------------------------
// Settings → who is on call
// --------------------------------------------------------------------------

private let settingsMoreOncallEn: [String: String] = [
    "settingsMore.onCallChecking": "Checking the rota…",
    "settingsMore.onCallEndShift": "End shift",
    "settingsMore.onCallNowOn": "{name} is on call",
    "settingsMore.onCallPut": "Put somebody on call",
    "settingsMore.onCallTitle": "On call",
    "settingsMore.remove": "Remove",
    "settingsMore.someone": "Someone",
]

private let settingsMoreOncallFr: [String: String] = [
    "settingsMore.onCallChecking": "Vérification du tour de garde…",
    "settingsMore.onCallEndShift": "Terminer le quart",
    "settingsMore.onCallNowOn": "{name} est de garde",
    "settingsMore.onCallPut": "Mettre quelqu'un de garde",
    "settingsMore.onCallTitle": "De garde",
    "settingsMore.remove": "Retirer",
    "settingsMore.someone": "Quelqu'un",
]

// --------------------------------------------------------------------------
// Settings → referrals
// --------------------------------------------------------------------------

private let settingsMoreReferralEn: [String: String] = [
    "settingsMore.freeMonthEarned": "1 free month earned so far.",
    "settingsMore.freeMonthsEarned": "{count} free months earned so far.",
    "settingsMore.noReferralsYet": "Nobody has used your link yet.",
]

private let settingsMoreReferralFr: [String: String] = [
    "settingsMore.freeMonthEarned": "1 mois gratuit obtenu jusqu'ici.",
    "settingsMore.freeMonthsEarned": "{count} mois gratuits obtenus jusqu'ici.",
    "settingsMore.noReferralsYet": "Personne n'a encore utilisé votre lien.",
]

// ---------------------------------------------------------------------------
// Settings -> what iOS says and Android does not
// ---------------------------------------------------------------------------

/// Seven keys with no twin in `SettingsMoreStrings.kt`, each because the two
/// apps reached the same fact by a different route rather than because they
/// disagree about it.
///
/// Four are the #523 transfer pills. Android draws that status through a
/// different composable and names it elsewhere; here the pill IS the claim, and
/// the pairing of word and tone is the thing under guard - "On hold" in amber
/// replaces a lime "Ported" over a line that can neither send nor answer, which
/// is the loudest wrong thing this screen could say.
///
/// `onCallWho` labels a SwiftUI `Picker`, a control Android's sheet does not
/// have. `enableUsConfirmTitle` and `usTextingDesc` belong to the Canadian
/// turn-on-US-texting card, whose iOS copy was written against #328's rule that
/// a CA workspace is billed in CAD and must never be quoted a US price.
private let settingsMoreIosOnlyEn: [String: String] = [
    "settingsMore.enableUsConfirmTitle": "Enable US texting?",
    "settingsMore.onCallWho": "Who",
    "settingsMore.portCancelling": "Cancelling",
    "settingsMore.portNeedsAttention": "Needs attention",
    "settingsMore.portOnHold": "On hold",
    "settingsMore.portStepPorted": "Ported",
    "settingsMore.usTextingDesc":
        "Texting Canadian numbers already works. Texting US numbers needs a "
        + "one-time carrier registration.",
]

/// The French for the seven above. `portStepPorted` reads "Transfert termine"
/// rather than a one-word "Porte": the English "Ported" is a term of art
/// carriers use and the French is the plain sentence, which is the register the
/// rest of this catalogue keeps.
private let settingsMoreIosOnlyFr: [String: String] = [
    "settingsMore.enableUsConfirmTitle": "Activer la messagerie américaine ?",
    "settingsMore.onCallWho": "Qui",
    "settingsMore.portCancelling": "Annulation en cours",
    "settingsMore.portNeedsAttention": "Intervention requise",
    "settingsMore.portOnHold": "En attente",
    "settingsMore.portStepPorted": "Transfert terminé",
    "settingsMore.usTextingDesc":
        "L'envoi de textos vers des numéros canadiens fonctionne déjà. Les "
        + "numéros américains exigent une inscription unique auprès des "
        + "opérateurs.",
]

// ==========================================================================
// #228 — the settings CARDS, in both languages.
//
// Every key below is asked for by one of the twenty-two files this pass
// converted: the team list, the two-factor card, the voice greeting, the
// transfer checklist, the emergency words, the away reply, the help page,
// the tags and templates, the US registration form, text-enablement, the
// usage export, the What's new list and the settings index itself.
//
// ## Where the words came from, and why almost none of them were written here
//
// Android shipped first, and its catalogue already holds a reviewed French
// for nearly all of these. So the rule for this pass was: find the sentence
// in `apps/android/.../core/i18n/`, reuse its KEY exactly, and copy its
// French character for character. Three hundred and eighty-seven of the four
// hundred and six below are that — not laziness, the parity guarantee. The
// same sentence has to reach the same key on both phones, or the two clients
// drift and the cross-client comparisons stop meaning anything.
//
// Nineteen had no Android twin and are written here, in the register the rest
// of this file keeps: Quebec French, VOUVOIEMENT, accents spelled normally, a
// normal space before the high punctuation. They are the iOS-only shapes — a
// navigation title where Android has a dialog, the export card's own status
// vocabulary (pinned in English by `UsageExportCardTests`, so the English
// could not move), the invite note's character countdown, and the two mailto
// subjects, whose French is web's own `rejectionMailSubject*`.
//
// ## Four keys deliberately DISAGREE with Android's value
//
// Each is a platform fact rather than a rewording, and the shared key is the
// point — a value comparison should show these two and nothing else:
//
//   - `settingsMore.micRefused` says "iOS Settings", and its French says
//     `Réglages`, which is what iOS calls that app in French. Android's says
//     `Paramètres`, which on this platform is the name of a screen inside
//     THIS app.
//   - `settingsMore.tfaFactorName` is "Loonext on iPhone". It is read inside
//     somebody's authenticator app, beside the entry from their other devices.
//   - `settings.supportBodyApp` / `…AppNoVersion` say `ios`. That line is a
//     diagnostic we read off a support email.
//
// ## Why `settings.*` keys live in this file
//
// Thirty-six of them do, and they belong to `SettingsStrings` by name. They
// are here because the screens that ask for them — the document picker, the
// emergency card, the help page — were converted in this pass, and a key
// defined nowhere renders its own name (which is the defect the header of
// this file records). The merged table is keyed by name, not by section, so
// the reader sees the sentence either way; the section is where a translator
// looks, and a translator looking for the help page's words now finds them
// beside the rest of the help page.
// ==========================================================================

private let settingsMoreIosDocsEn: [String: String] = [
    "settings.docUnreadable": "Couldn't read that file. Try another one.",
    "settings.docWrongKind": "Use a PDF, PNG, or JPEG up to 10 MB.",
]

private let settingsMoreIosDocsFr: [String: String] = [
    "settings.docUnreadable": "Impossible de lire ce fichier. Essayez-en un autre.",
    "settings.docWrongKind": "Utilisez un PDF, un PNG ou un JPEG de 10 Mo au maximum.",
]

private let settingsMoreIosRejectionEn: [String: String] = [
    "settingsMore.carrierSaid": "The carrier said: {reason}",
    "settingsMore.getHelp": "Get help from us",
    "settingsMore.rejectionMailSubjectPort": "My number transfer keeps getting rejected",
    "settingsMore.rejectionMailSubjectRegistration": "My registration keeps getting rejected",
    "settingsMore.rejectionUnknownFix":
        "Check the details below against your official registration "
        + "paperwork, and reply to us if nothing looks wrong.",
    "settingsMore.rejectionUnknownWhat":
        "The carrier turned down this {subject} and did not say why in a "
        + "way we can translate.",
    "settingsMore.subjectRegistration": "registration",
    "settingsMore.subjectTransfer": "transfer",
    "settingsMore.takeMeToIt": "Take me to it",
]

private let settingsMoreIosRejectionFr: [String: String] = [
    "settingsMore.carrierSaid": "Le fournisseur a dit : {reason}",
    "settingsMore.getHelp": "Obtenir de l'aide",
    "settingsMore.rejectionMailSubjectPort": "Mon transfert de numéro est refusé chaque fois",
    "settingsMore.rejectionMailSubjectRegistration": "Mon inscription est refusée chaque fois",
    "settingsMore.rejectionUnknownFix":
        "Comparez les renseignements ci-dessous avec vos documents "
        + "officiels d'entreprise, et répondez-nous si tout semble correct.",
    "settingsMore.rejectionUnknownWhat":
        "Le fournisseur a refusé ce {subject} sans en donner la raison "
        + "d'une façon que nous pouvons traduire.",
    "settingsMore.subjectRegistration": "inscription",
    "settingsMore.subjectTransfer": "transfert",
    "settingsMore.takeMeToIt": "M'y amener",
]

private let settingsMoreIosEmergencyEn: [String: String] = [
    "settings.emergencySafetyLine": "If anyone is in danger, call 911.",
]

private let settingsMoreIosEmergencyFr: [String: String] = [
    "settings.emergencySafetyLine": "Si quelqu'un est en danger, composez le 911.",
]

private let settingsMoreIosRemindersEn: [String: String] = [
    "settingsMore.discard": "Discard",
    "settingsMore.loading": "Loading…",
    "settingsMore.remindersAddAnother": "Add another",
    "settingsMore.remindersBodyLabel": "What it says",
    "settingsMore.remindersCap":
        "Two is the most we send. Past that, customers stop reading them.",
    "settingsMore.remindersDesc": "A text before the job, so fewer people forget.",
    "settingsMore.remindersNowOff": "Reminders are off. Nothing will go out automatically.",
    "settingsMore.remindersOffBody":
        "Reminders are off. Nothing goes out automatically until you set "
        + "one up — a job booked for tomorrow gets no text from us today.",
    "settingsMore.remindersSave": "Save reminders",
    "settingsMore.remindersSaved": "Saved. New jobs will carry these reminders.",
    "settingsMore.remindersSetUpUsual": "Set up the usual two",
    "settingsMore.remindersTitle": "Appointment reminders",
]

private let settingsMoreIosRemindersFr: [String: String] = [
    "settingsMore.discard": "Abandonner",
    "settingsMore.loading": "Chargement…",
    "settingsMore.remindersAddAnother": "Ajouter un autre rappel",
    "settingsMore.remindersBodyLabel": "Ce que dit le rappel",
    "settingsMore.remindersCap":
        "Deux, c'est le maximum que nous envoyons. Au-delà, les clients "
        + "cessent de les lire.",
    "settingsMore.remindersDesc": "Un texto avant le travail, pour que moins de gens oublient.",
    "settingsMore.remindersNowOff":
        "Les rappels sont désactivés. Rien ne partira automatiquement.",
    "settingsMore.remindersOffBody":
        "Les rappels sont désactivés. Rien ne part automatiquement tant que "
        + "vous n'en créez pas un — un travail prévu demain ne reçoit aucun "
        + "texto de notre part aujourd'hui.",
    "settingsMore.remindersSave": "Enregistrer les rappels",
    "settingsMore.remindersSaved": "Enregistré. Les nouveaux travaux porteront ces rappels.",
    "settingsMore.remindersSetUpUsual": "Créer les deux rappels habituels",
    "settingsMore.remindersTitle": "Rappels de rendez-vous",
]

private let settingsMoreIosHelpEn: [String: String] = [
    "settings.helpFaqNotGotA":
        "Check whether they ever texted STOP: a carrier opt-out blocks us "
        + "and only the customer can lift it, by texting START. If that is "
        + "not it, email us the customer's number and roughly when you sent "
        + "it, and we can trace the message with the carrier.",
    "settings.helpFaqNotGotQ": "A customer says they never got my text. What now?",
    "settings.helpFaqPendingA":
        "We have submitted your business to the carriers and they have not "
        + "answered yet. It is a queue, not a review of anything you did. You "
        + "will get an email the moment it clears.",
    "settings.helpFaqPendingQ": "What does “registration pending” actually mean?",
    "settings.helpFaqPortA":
        "Porting takes 7 to 10 business days once the carrier accepts the "
        + "request, and your old number keeps working the entire time. "
        + "Nothing goes dark at any point.",
    "settings.helpFaqPortQ": "How long does moving my existing number take?",
    "settings.helpFaqStoppedA":
        "Two things do that. A carrier can suspend an approved "
        + "registration, which we are told about and act on without you doing "
        + "anything. Or your workspace has hit the spending cap the owner "
        + "set, which is protection rather than a quota and an owner can "
        + "raise it in Settings.",
    "settings.helpFaqStoppedQ": "Why did my number stop sending after it was working?",
    "settings.helpFaqUsSendA":
        "US carriers require every business number to be registered before "
        + "it can text US phones. Approval usually takes 3 to 7 business "
        + "days, and there is nothing to do while it runs. Calls to US "
        + "numbers work the whole time, and Canadian texts are unaffected.",
    "settings.helpFaqUsSendQ": "Why won't my text to a US number send?",
    "settings.helpFixPromise":
        "If you tell us something's broken, we write back when it's fixed, "
        + "not just when we've read it.",
    "settings.helpReplyPromise":
        "We reply {time}. We're a small team, so this is email rather than "
        + "a chat window, and we read everything that comes in. If your texts "
        + "have stopped arriving, say so in the subject line and we'll start "
        + "there.",
    "settings.helpResponseTime": "within two business days, usually sooner",
    "settings.supportBodyApp": "App: ios {version}",
    "settings.supportBodyAppNoVersion": "App: ios",
    "settings.supportBodyErrors": "Recent errors on this device (newest first):",
    "settings.supportBodyLeadIn":
        "The details below help us look this up. Please leave them in.",
    "settings.supportBodyPlan": "Plan: {plan}",
    "settings.supportBodyScreen": "Screen: {situation}",
    "settings.supportBodyUnnamed": "(unnamed)",
    "settings.supportBodyWorkspace": "Workspace: {name} ({id})",
    "settings.supportSituationNumberAccess": "I do not have texting access to this number",
    "settings.supportSituationOptOutHint": "an opt-out was detected in the thread",
    "settings.supportSituationOptedOut": "this customer is opted out",
    "settings.supportSituationReadOnly": "I have view-only access",
    "settings.supportSituationRegistrationPending": "US registration is pending approval",
    "settings.supportSituationRegistrationSuspended":
        "the carrier suspended our US registration",
    "settings.supportSituationSubscription": "the subscription is not active",
    "settings.supportSituationUsTextingOff": "US texting is off for this workspace",
    "settings.supportSituationUsageCap": "sending is paused at the spending cap",
    "settings.supportSubjectDefault": "Help with my Loonext workspace",
    "settings.supportSubjectIdea": "Idea for Loonext",
    "settings.supportSubjectProblem": "Problem: {situation}",
]

private let settingsMoreIosHelpFr: [String: String] = [
    "settings.helpFaqNotGotA":
        "Vérifiez s'il a déjà envoyé STOP : un désabonnement chez le "
        + "fournisseur nous bloque et seul le client peut le lever, en "
        + "textant START. Si ce n'est pas cela, écrivez-nous le numéro du "
        + "client et le moment approximatif de l'envoi, et nous pourrons "
        + "retracer le message avec le fournisseur.",
    "settings.helpFaqNotGotQ": "Un client dit qu'il n'a jamais reçu mon texto. Que faire ?",
    "settings.helpFaqPendingA":
        "Nous avons soumis votre entreprise aux fournisseurs et ils n'ont "
        + "pas encore répondu. C'est une file d'attente, pas un examen de "
        + "quoi que ce soit que vous auriez fait. Vous recevrez un courriel "
        + "dès que ce sera réglé.",
    "settings.helpFaqPendingQ": "Que veut dire « inscription en attente », au juste ?",
    "settings.helpFaqPortA":
        "Le transfert prend de 7 à 10 jours ouvrables une fois que le "
        + "fournisseur accepte la demande, et votre ancien numéro continue de "
        + "fonctionner pendant tout ce temps. Rien ne s'éteint à aucun "
        + "moment.",
    "settings.helpFaqPortQ": "Combien de temps prend le transfert de mon numéro actuel ?",
    "settings.helpFaqStoppedA":
        "Deux choses causent cela. Un fournisseur peut suspendre une "
        + "inscription approuvée ; on nous en avise et nous agissons sans que "
        + "vous ayez rien à faire. Ou votre espace de travail a atteint le "
        + "plafond de dépenses fixé par le propriétaire, qui est une "
        + "protection plutôt qu'un quota et qu'un propriétaire peut relever "
        + "dans les paramètres.",
    "settings.helpFaqStoppedQ":
        "Pourquoi mon numéro a-t-il cessé d'envoyer après avoir fonctionné "
        + "?",
    "settings.helpFaqUsSendA":
        "Les fournisseurs américains exigent que chaque numéro d'entreprise "
        + "soit inscrit avant de pouvoir texter des téléphones américains. "
        + "L'approbation prend habituellement de 3 à 7 jours ouvrables, et il "
        + "n'y a rien à faire pendant ce temps. Les appels vers les numéros "
        + "américains fonctionnent tout du long, et les textos canadiens ne "
        + "sont pas touchés.",
    "settings.helpFaqUsSendQ": "Pourquoi mon texto vers un numéro américain ne part-il pas ?",
    "settings.helpFixPromise":
        "Si vous nous signalez un problème, nous vous réécrivons quand il "
        + "est corrigé, pas seulement quand nous l'avons lu.",
    "settings.helpReplyPromise":
        "Nous répondons {time}. Nous sommes une petite équipe, alors c'est "
        + "le courriel plutôt qu'une fenêtre de clavardage, et nous lisons "
        + "tout ce qui arrive. Si vos textos ont cessé d'arriver, dites-le "
        + "dans l'objet et nous commencerons par là.",
    "settings.helpResponseTime": "within two business days, usually sooner",
    "settings.supportBodyApp": "Application : ios {version}",
    "settings.supportBodyAppNoVersion": "Application : ios",
    "settings.supportBodyErrors":
        "Erreurs récentes sur cet appareil (les plus récentes d'abord) :",
    "settings.supportBodyLeadIn":
        "Les renseignements ci-dessous nous aident à retrouver votre "
        + "dossier. Laissez-les dans le message.",
    "settings.supportBodyPlan": "Forfait : {plan}",
    "settings.supportBodyScreen": "Écran : {situation}",
    "settings.supportBodyUnnamed": "(sans nom)",
    "settings.supportBodyWorkspace": "Espace de travail : {name} ({id})",
    "settings.supportSituationNumberAccess": "je n'ai pas accès aux textos de ce numéro",
    "settings.supportSituationOptOutHint":
        "un désabonnement a été détecté dans la conversation",
    "settings.supportSituationOptedOut": "ce client s'est désabonné",
    "settings.supportSituationReadOnly": "j'ai un accès en lecture seule",
    "settings.supportSituationRegistrationPending":
        "l'inscription américaine est en attente d'approbation",
    "settings.supportSituationRegistrationSuspended":
        "le fournisseur a suspendu notre inscription américaine",
    "settings.supportSituationSubscription": "l'abonnement n'est pas actif",
    "settings.supportSituationUsTextingOff":
        "les textos américains sont désactivés pour cet espace de travail",
    "settings.supportSituationUsageCap": "l'envoi est suspendu au plafond de dépenses",
    "settings.supportSubjectDefault": "Aide avec mon espace de travail Loonext",
    "settings.supportSubjectIdea": "Idée pour Loonext",
    "settings.supportSubjectProblem": "Problème : {situation}",
]

private let settingsMoreIosHomeEn: [String: String] = [
    "settingsMore.diagnostics": "Diagnostics",
    "settingsMore.sectionAi": "Lou",
    "settingsMore.sectionAiBlurb":
        "Loonext's assistant: drafts replies and fills in task details",
    "settingsMore.sectionBilling": "Billing",
    "settingsMore.sectionBillingBlurb": "Plan, payment, and invoices",
    "settingsMore.sectionCalling": "Calling",
    "settingsMore.sectionCallingBlurb":
        "Missed-call text-back, voicemail, screening, caller ID",
    "settingsMore.sectionDevices": "Signed-in devices",
    "settingsMore.sectionDevicesBlurb": "Every browser and phone with access right now",
    "settingsMore.sectionDiagnosticsBlurb":
        "Build, connection, and recent events on this phone",
    "settingsMore.sectionHelp": "Help",
    "settingsMore.sectionHelpBlurb": "Get in touch when something isn't right",
    "settingsMore.sectionHours": "Business hours & away reply",
    "settingsMore.sectionHoursBlurb": "When you're open, and what after-hours texters hear",
    "settingsMore.sectionNotifications": "Notifications",
    "settingsMore.sectionNotificationsBlurb": "Email and push for new conversations",
    "settingsMore.sectionNumbers": "Numbers",
    "settingsMore.sectionNumbersBlurb": "Your numbers, ports, text-enablement, registration",
    "settingsMore.sectionPayments": "Getting paid",
    "settingsMore.sectionPaymentsBlurb":
        "Take a deposit or a final payment straight from a thread",
    "settingsMore.sectionProfile": "Profile & account",
    "settingsMore.sectionProfileBlurb": "Your name, theme, email, and password",
    "settingsMore.sectionTeam": "Team",
    "settingsMore.sectionTeamBlurb": "Who can see and answer your customers' texts",
    "settingsMore.sectionTemplates": "Templates & tags",
    "settingsMore.sectionTemplatesBlurb":
        "Saved replies, and the labels you file conversations under",
    "settingsMore.sectionUsage": "Usage",
    "settingsMore.sectionUsageBlurb": "Fair use, your spending cap, and the numbers",
    "settingsMore.sectionWhatsNew": "What's new",
    "settingsMore.sectionWhatsNewBlurb": "What shipped recently, and where to find it",
    "settingsMore.sectionWorkspace": "Workspace",
    "settingsMore.sectionWorkspaceBlurb": "Name, business identification, timezone",
]

private let settingsMoreIosHomeFr: [String: String] = [
    "settingsMore.diagnostics": "Diagnostics",
    "settingsMore.sectionAi": "Lou",
    "settingsMore.sectionAiBlurb":
        "L'assistant de Loonext : rédige des réponses et remplit les "
        + "détails des tâches",
    "settingsMore.sectionBilling": "Facturation",
    "settingsMore.sectionBillingBlurb": "Forfait, paiement et factures",
    "settingsMore.sectionCalling": "Appels",
    "settingsMore.sectionCallingBlurb":
        "Texto d'appel manqué, boîte vocale, filtrage, afficheur",
    "settingsMore.sectionDevices": "Appareils connectés",
    "settingsMore.sectionDevicesBlurb":
        "Chaque navigateur et téléphone qui a accès en ce moment",
    "settingsMore.sectionDiagnosticsBlurb":
        "Version, connexion et événements récents sur ce téléphone",
    "settingsMore.sectionHelp": "Aide",
    "settingsMore.sectionHelpBlurb": "Écrivez-nous quand quelque chose ne va pas",
    "settingsMore.sectionHours": "Heures d'ouverture et réponse d'absence",
    "settingsMore.sectionHoursBlurb":
        "Quand vous êtes ouvert, et ce qu'entendent ceux qui écrivent hors "
        + "des heures",
    "settingsMore.sectionNotifications": "Notifications",
    "settingsMore.sectionNotificationsBlurb":
        "Courriel et notifications poussées pour les nouvelles "
        + "conversations",
    "settingsMore.sectionNumbers": "Numéros",
    "settingsMore.sectionNumbersBlurb":
        "Vos numéros, transferts, activation des textos, inscription",
    "settingsMore.sectionPayments": "Encaisser les paiements",
    "settingsMore.sectionPaymentsBlurb":
        "Prenez un acompte ou un paiement final directement depuis une "
        + "conversation",
    "settingsMore.sectionProfile": "Profil et compte",
    "settingsMore.sectionProfileBlurb": "Votre nom, le thème, le courriel et le mot de passe",
    "settingsMore.sectionTeam": "Équipe",
    "settingsMore.sectionTeamBlurb": "Qui peut voir et répondre aux textos de vos clients",
    "settingsMore.sectionTemplates": "Modèles et étiquettes",
    "settingsMore.sectionTemplatesBlurb":
        "Réponses enregistrées, et les étiquettes qui classent vos "
        + "conversations",
    "settingsMore.sectionUsage": "Utilisation",
    "settingsMore.sectionUsageBlurb":
        "Usage raisonnable, votre plafond de dépenses et les chiffres",
    "settingsMore.sectionWhatsNew": "Nouveautés",
    "settingsMore.sectionWhatsNewBlurb": "Ce qui a été livré récemment, et où le trouver",
    "settingsMore.sectionWorkspace": "Espace de travail",
    "settingsMore.sectionWorkspaceBlurb": "Nom, identification de l'entreprise, fuseau horaire",
]

private let settingsMoreIosWhatsNewEn: [String: String] = [
    "settingsMore.whatsNewBadge": "New",
    "settingsMore.whatsNewCallsBody":
        "Calls to your business number ring your whole crew right here. "
        + "Pick up, put someone on hold, or hand the call to a teammate.",
    "settingsMore.whatsNewCallsTitle": "Answer calls in the app",
    "settingsMore.whatsNewDraftsBody":
        "Lou reads the thread and offers a reply you can edit before it "
        + "goes. You send it, or you ignore it; nothing is sent on your "
        + "behalf.",
    "settingsMore.whatsNewDraftsTitle": "Lou drafts the reply for you",
    "settingsMore.whatsNewFooter":
        "Smaller repairs ship most days and are not listed. If you reported "
        + "something and want to know where it got to, ask us on the Help "
        + "page.",
    "settingsMore.whatsNewIntro":
        "Everything here has already shipped and is in the product now.",
    "settingsMore.whatsNewQuotesBody":
        "Your home screen now shows how many quotes you sent, how many you "
        + "won, and how many are still waiting on an answer.",
    "settingsMore.whatsNewQuotesTitle": "See how many quotes turned into work",
    "settingsMore.whatsNewSavedViewsBody":
        "Arrange the inbox how you want it, name it, and it is one tap away "
        + "tomorrow. Share one with the crew and everybody opens the same "
        + "list.",
    "settingsMore.whatsNewSavedViewsTitle": "Save the filters you use every morning",
    "settingsMore.whatsNewVoicemailBody":
        "A missed call leaves a voicemail you can read at a red light "
        + "instead of listening to it. It is searchable like any other "
        + "message.",
    "settingsMore.whatsNewVoicemailTitle": "Voicemails are written down",
]

private let settingsMoreIosWhatsNewFr: [String: String] = [
    "settingsMore.whatsNewBadge": "Nouveau",
    "settingsMore.whatsNewCallsBody":
        "Les appels à votre numéro d'affaires font sonner toute votre "
        + "équipe ici même. Répondez, mettez quelqu'un en attente, ou "
        + "transférez l'appel à un coéquipier.",
    "settingsMore.whatsNewCallsTitle": "Répondez aux appels dans l'application",
    "settingsMore.whatsNewDraftsBody":
        "Lou lit la conversation et propose une réponse que vous pouvez "
        + "modifier avant l'envoi. Vous l'envoyez, ou vous l'ignorez ; rien "
        + "n'est envoyé en votre nom.",
    "settingsMore.whatsNewDraftsTitle": "Lou rédige la réponse pour vous",
    "settingsMore.whatsNewFooter":
        "De petites corrections sortent presque tous les jours et ne sont "
        + "pas listées. Si vous avez signalé quelque chose et voulez savoir "
        + "où ça en est, écrivez-nous depuis la page Aide.",
    "settingsMore.whatsNewIntro":
        "Tout ce qui est ici est déjà livré et se trouve dans le produit.",
    "settingsMore.whatsNewQuotesBody":
        "Votre écran d'accueil montre maintenant combien de devis vous avez "
        + "envoyés, combien vous avez obtenus, et combien attendent encore "
        + "une réponse.",
    "settingsMore.whatsNewQuotesTitle": "Voyez combien de devis sont devenus des contrats",
    "settingsMore.whatsNewSavedViewsBody":
        "Organisez la boîte de réception comme vous voulez, nommez-la, et "
        + "elle est à une touche demain matin. Partagez-en une avec l'équipe "
        + "et tout le monde ouvre la même liste.",
    "settingsMore.whatsNewSavedViewsTitle":
        "Enregistrez les filtres que vous utilisez chaque matin",
    "settingsMore.whatsNewVoicemailBody":
        "Un appel manqué laisse un message vocal que vous pouvez lire à un "
        + "feu rouge au lieu de l'écouter. Il se cherche comme n'importe quel "
        + "autre message.",
    "settingsMore.whatsNewVoicemailTitle": "Les messages vocaux sont transcrits",
]

private let settingsMoreIosTwoFactorEn: [String: String] = [
    "settingsMore.addToAuthenticator": "Add Loonext to your authenticator",
    "settingsMore.addToAuthenticatorBody":
        "Tap below to hand it to your authenticator app, or copy the key in "
        + "by hand. Then enter the six-digit code it shows.",
    // #473 — the summary names WHICH kinds are on, because two can be.
    // These four are the shared rule's return values (mfa-factors.ts); a
    // catalogue whose names differ from those renders the key itself.
    "settingsMore.tfaAuthenticatorOn": "Authenticator app is on",
    "settingsMore.tfaPasskeyOn": "Passkey is on",
    "settingsMore.tfaBothOn": "Passkey and authenticator app are on",
    "settingsMore.tfaOn": "Two-factor authentication is on",
    // Offered from inside the already-on state, and only for the kind that is
    // missing: an option that does not apply is absent, not greyed out.
    "settingsMore.tfaAddPasskey": "Add a passkey",
    "settingsMore.tfaAddAuthenticator": "Add an authenticator app",
    "settingsMore.tfaUsePasskey": "Use a passkey",
    "settingsMore.tfaPasskeyPitch":
        "Use Face ID, Touch ID or your passcode as the second step. Nothing " +
        "to type and nothing to lose - it stays on this iPhone. We will give " +
        "you backup codes for the day the iPhone doesn't.",
    "settingsMore.tfaPasskeyFactorName": "Passkey on iPhone",
    "settingsMore.tfaPasskeyFailed":
        "Couldn't add a passkey. Try again, or use an authenticator app.",
    "settingsMore.cantReachSignIn": "Can't reach the sign-in service. Check your connection.",
    "settingsMore.codeDidNotMatch":
        "That code didn't match. Check your app and try the next one.",
    "settingsMore.copied": "Copied",
    "settingsMore.copyAllCodes": "Copy all codes",
    "settingsMore.copyKey": "Copy key",
    "settingsMore.newRecoveryCodes": "New recovery codes",
    "settingsMore.noRecoveryCodesLeft": "No recovery codes left",
    "settingsMore.oneRecoveryCodeLeft": "1 recovery code left.",
    "settingsMore.openAuthenticator": "Open my authenticator app",
    "settingsMore.orEnterKey": "Or enter this key by hand:",
    "settingsMore.recoveryCodesLeft": "{count} recovery codes left.",
    "settingsMore.saveRecoveryCodes": "Save your recovery codes",
    "settingsMore.saveRecoveryCodesBody":
        "This is the only time you will see these. If you lose your phone, "
        + "one of these codes is how you get back in — without them, getting "
        + "back into your business line takes us weeks.",
    "settingsMore.savedThem": "I've saved them",
    "settingsMore.setUpTwoFactor": "Set up two-factor",
    "settingsMore.sixDigitCode": "Six-digit code",
    "settingsMore.somethingWentWrongStatus": "Something went wrong ({status}).",
    "settingsMore.tfaCodeCheckFailed": "Couldn't check that code. Try again.",
    "settingsMore.tfaFactorName": "Loonext on iPhone",
    "settingsMore.tfaSetupDidNotStart": "Setup didn't start. Try again.",
    "settingsMore.turnItOff": "Turn it off",
    "settingsMore.turnItOn": "Turn it on",
    "settingsMore.turnOff": "Turn off",
    "settingsMore.turnOffTwoFactorBody":
        "Your account goes back to a password alone. If this workspace "
        + "requires two-factor, you will be asked to set it up again the next "
        + "time you open the app.",
    "settingsMore.turnOffTwoFactorTitle": "Turn off two-factor authentication?",
    "settingsMore.twoFactorDesc":
        "A code from an app, on top of your password. It is what stops a "
        + "stolen password becoming somebody texting your customers as you.",
    "settingsMore.twoFactorHow":
        "You will add Loonext to an authenticator app — Google "
        + "Authenticator, 1Password, whatever you already use — and enter the "
        + "six-digit code it shows. We will give you backup codes for the day "
        + "you lose the phone.",
    "settingsMore.twoFactorOff": "Two-factor authentication is off.",
    "settingsMore.twoFactorOn": "Two-factor authentication is on.",
    "settingsMore.twoFactorTitle": "Two-factor authentication",
]

private let settingsMoreIosTwoFactorFr: [String: String] = [
    "settingsMore.addToAuthenticator": "Ajouter Loonext à votre application d'authentification",
    "settingsMore.addToAuthenticatorBody":
        "Touchez ci-dessous pour la transmettre à votre application "
        + "d'authentification, ou copiez la clé à la main. Entrez ensuite le "
        + "code à six chiffres qu'elle affiche.",
    "settingsMore.tfaAuthenticatorOn": "L'application d'authentification est active",
    "settingsMore.tfaPasskeyOn": "La clé d'accès est activée",
    "settingsMore.tfaBothOn":
        "La clé d'accès et l'application d'authentification sont activées",
    "settingsMore.tfaOn": "La double authentification est activée",
    "settingsMore.tfaAddPasskey": "Ajouter une clé d'accès",
    "settingsMore.tfaAddAuthenticator": "Ajouter une application d'authentification",
    "settingsMore.tfaUsePasskey": "Utiliser une clé d'accès",
    "settingsMore.tfaPasskeyPitch":
        "Utilisez Face ID, Touch ID ou votre code comme deuxième étape. Rien " +
        "à taper et rien à perdre - cela reste sur cet iPhone. Nous vous " +
        "donnerons des codes de secours pour le jour où l'iPhone vous fera " +
        "défaut.",
    "settingsMore.tfaPasskeyFactorName": "Clé d'accès sur iPhone",
    "settingsMore.tfaPasskeyFailed":
        "Impossible d'ajouter une clé d'accès. Réessayez, ou utilisez une " +
        "application d'authentification.",
    "settingsMore.cantReachSignIn":
        "Impossible de joindre le service de connexion. Vérifiez votre "
        + "connexion.",
    "settingsMore.codeDidNotMatch":
        "Ce code ne correspond pas. Vérifiez votre application et essayez "
        + "le suivant.",
    "settingsMore.copied": "Copié",
    "settingsMore.copyAllCodes": "Copier tous les codes",
    "settingsMore.copyKey": "Copier la clé",
    "settingsMore.newRecoveryCodes": "Nouveaux codes de récupération",
    "settingsMore.noRecoveryCodesLeft": "Aucun code de récupération restant",
    "settingsMore.oneRecoveryCodeLeft": "1 code de récupération restant.",
    "settingsMore.openAuthenticator": "Ouvrir mon application d'authentification",
    "settingsMore.orEnterKey": "Ou entrez cette clé à la main :",
    "settingsMore.recoveryCodesLeft": "{count} codes de récupération restants.",
    "settingsMore.saveRecoveryCodes": "Enregistrez vos codes de récupération",
    "settingsMore.saveRecoveryCodesBody":
        "C'est la seule fois où vous les verrez. Si vous perdez votre "
        + "téléphone, l'un de ces codes est votre moyen de revenir — sans "
        + "eux, récupérer l'accès à votre ligne d'affaires nous prend des "
        + "semaines.",
    "settingsMore.savedThem": "Je les ai enregistrés",
    "settingsMore.setUpTwoFactor": "Configurer la double authentification",
    "settingsMore.sixDigitCode": "Code à six chiffres",
    "settingsMore.somethingWentWrongStatus": "Une erreur s'est produite ({status}).",
    "settingsMore.tfaCodeCheckFailed": "Impossible de vérifier ce code. Réessayez.",
    "settingsMore.tfaFactorName": "Loonext sur iPhone",
    "settingsMore.tfaSetupDidNotStart": "La configuration n'a pas démarré. Réessayez.",
    "settingsMore.turnItOff": "Désactiver",
    "settingsMore.turnItOn": "Activer",
    "settingsMore.turnOff": "Désactiver",
    "settingsMore.turnOffTwoFactorBody":
        "Votre compte revient au mot de passe seul. Si cet espace de "
        + "travail exige la double authentification, on vous demandera de la "
        + "configurer de nouveau à votre prochaine ouverture de "
        + "l'application.",
    "settingsMore.turnOffTwoFactorTitle": "Désactiver l'authentification à deux facteurs ?",
    "settingsMore.twoFactorDesc":
        "Un code venant d'une application, en plus de votre mot de passe. "
        + "C'est ce qui empêche un mot de passe volé de devenir quelqu'un qui "
        + "texte vos clients en votre nom.",
    "settingsMore.twoFactorHow":
        "Vous ajouterez Loonext à une application d'authentification — "
        + "Google Authenticator, 1Password, celle que vous utilisez déjà — et "
        + "vous entrerez le code à six chiffres qu'elle affiche. Nous vous "
        + "donnerons des codes de secours pour le jour où vous perdrez le "
        + "téléphone.",
    "settingsMore.twoFactorOff": "L'authentification à deux facteurs est désactivée.",
    "settingsMore.twoFactorOn": "L'authentification à deux facteurs est active.",
    "settingsMore.twoFactorTitle": "Authentification à deux facteurs",
]

private let settingsMoreIosTeamEn: [String: String] = [
    "settingsMore.charactersLeft": "{count} characters left",
    "settingsMore.checking": "Checking…",
    "settingsMore.copyLink": "Copy link",
    "settingsMore.deactivate": "Deactivate",
    "settingsMore.deactivateBody":
        "They lose access right away and their seat frees up. Conversations "
        + "and messages they worked on stay put.",
    "settingsMore.deactivateTitle": "Deactivate {name}?",
    "settingsMore.deactivated": "{name} deactivated. Their seat is free.",
    "settingsMore.deactivatedAgo": "Deactivated {ago} ago",
    "settingsMore.deactivatedHeading": "Deactivated",
    "settingsMore.done": "Done",
    "settingsMore.email": "Email",
    "settingsMore.enterTeammateEmail": "Enter the teammate's email address.",
    "settingsMore.giveUpAccessTitle": "Give up your own access?",
    "settingsMore.invite": "Invite",
    "settingsMore.inviteEmailFailed":
        "We couldn't email that invite. Use Copy link below and share it "
        + "yourself.",
    "settingsMore.inviteExpired": "Expired, doesn't hold a seat",
    "settingsMore.inviteExpires": "Expires {date}",
    "settingsMore.inviteLinkCopied": "Invite link copied.",
    "settingsMore.inviteNoteLabel": "What to tell them (optional)",
    "settingsMore.inviteNoteOneShot":
        "They see this once, when they join. You cannot change it after the "
        + "invite goes out.",
    "settingsMore.invitePending": "{role} · {when}",
    "settingsMore.inviteRevoked": "Invite revoked.",
    "settingsMore.inviteSentTo": "Invite sent to {email}.",
    "settingsMore.inviteTeammate": "Invite a teammate",
    "settingsMore.invites": "Invites",
    "settingsMore.inviting": "Inviting…",
    "settingsMore.joinedAgo": "Joined {ago} ago",
    "settingsMore.makeMeRole": "Make me {role}",
    "settingsMore.memberAccessFailed": "Couldn't load their access. Try again.",
    "settingsMore.memberNumbersDesc":
        "What they can do on each number, and the rule that decided it.",
    "settingsMore.memberNumbersTitle": "Numbers {name} can reach",
    "settingsMore.members": "Members",
    "settingsMore.membersDesc": "Who can see and answer your customers' texts.",
    "settingsMore.nameYou": "{name} (you)",
    "settingsMore.noNumbersInWorkspace": "This workspace has no numbers yet.",
    "settingsMore.numbersLink": "Numbers",
    "settingsMore.oneCharacterLeft": "1 character left",
    "settingsMore.onlyAdminsInvite":
        "Only owners and admins can invite or deactivate teammates.",
    "settingsMore.pendingInvites": "Pending invites",
    "settingsMore.revoke": "Revoke",
    "settingsMore.revoking": "Revoking…",
    "settingsMore.roleAdmin": "Admin",
    "settingsMore.roleAdminBlurb":
        "Everything except transferring ownership and closing the workspace",
    "settingsMore.roleBookkeeper": "Bookkeeper",
    "settingsMore.roleBookkeeperBlurb": "Billing and invoices only; no access to conversations",
    "settingsMore.roleChanged": "{name} is now {role}.",
    "settingsMore.roleMember": "Member",
    "settingsMore.roleMemberBlurb": "Read and answer customers; no billing, team or settings",
    "settingsMore.roleOwner": "Owner",
    "settingsMore.roleReadOnly": "View only",
    "settingsMore.roleReadOnlyBlurb": "Can see conversations, cannot reply or change anything",
    "settingsMore.seatsFull":
        "All seats are taken. Deactivate a teammate or revoke a pending "
        + "invite first.",
]

private let settingsMoreIosTeamFr: [String: String] = [
    "settingsMore.charactersLeft": "Il reste {count} caractères",
    "settingsMore.checking": "Vérification…",
    "settingsMore.copyLink": "Copier le lien",
    "settingsMore.deactivate": "Désactiver",
    "settingsMore.deactivateBody":
        "Cette personne perd l'accès immédiatement et sa place se libère. "
        + "Les conversations et les messages sur lesquels elle a travaillé "
        + "restent en place.",
    "settingsMore.deactivateTitle": "Désactiver {name} ?",
    "settingsMore.deactivated": "{name} désactivé. Sa place est libre.",
    "settingsMore.deactivatedAgo": "Désactivé il y a {ago}",
    "settingsMore.deactivatedHeading": "Désactivés",
    "settingsMore.done": "Terminé",
    "settingsMore.email": "Courriel",
    "settingsMore.enterTeammateEmail": "Entrez l'adresse courriel du coéquipier.",
    "settingsMore.giveUpAccessTitle": "Renoncer à votre propre accès ?",
    "settingsMore.invite": "Inviter",
    "settingsMore.inviteEmailFailed":
        "Nous n'avons pas pu envoyer cette invitation par courriel. "
        + "Utilisez Copier le lien ci-dessous et partagez-le vous-même.",
    "settingsMore.inviteExpired": "Expirée, n'occupe pas de place",
    "settingsMore.inviteExpires": "Expire le {date}",
    "settingsMore.inviteLinkCopied": "Lien d'invitation copié.",
    "settingsMore.inviteNoteLabel": "Ce qu'il faut lui dire (facultatif)",
    "settingsMore.inviteNoteOneShot":
        "La personne le voit une seule fois, à son arrivée. Vous ne pouvez "
        + "plus le changer une fois l'invitation partie.",
    "settingsMore.invitePending": "{role} · {when}",
    "settingsMore.inviteRevoked": "Invitation révoquée.",
    "settingsMore.inviteSentTo": "Invitation envoyée à {email}.",
    "settingsMore.inviteTeammate": "Inviter un coéquipier",
    "settingsMore.invites": "Invitations",
    "settingsMore.inviting": "Invitation…",
    "settingsMore.joinedAgo": "Arrivé il y a {ago}",
    "settingsMore.makeMeRole": "Faites de moi un {role}",
    "settingsMore.memberAccessFailed": "Impossible de charger son accès. Réessayez.",
    "settingsMore.memberNumbersDesc":
        "Ce que cette personne peut faire sur chaque numéro, et la règle "
        + "qui l'a décidé.",
    "settingsMore.memberNumbersTitle": "Numéros que {name} peut joindre",
    "settingsMore.members": "Membres",
    "settingsMore.membersDesc": "Qui peut voir et répondre aux textos de vos clients.",
    "settingsMore.nameYou": "{name} (vous)",
    "settingsMore.noNumbersInWorkspace": "Cet espace de travail n'a encore aucun numéro.",
    "settingsMore.numbersLink": "Numéros",
    "settingsMore.oneCharacterLeft": "Il reste 1 caractère",
    "settingsMore.onlyAdminsInvite":
        "Seuls les propriétaires et les admins peuvent inviter ou "
        + "désactiver des coéquipiers.",
    "settingsMore.pendingInvites": "Invitations en attente",
    "settingsMore.revoke": "Révoquer",
    "settingsMore.revoking": "Révocation…",
    "settingsMore.roleAdmin": "Admin",
    "settingsMore.roleAdminBlurb":
        "Tout, sauf céder la propriété et fermer l'espace de travail",
    "settingsMore.roleBookkeeper": "Comptable",
    "settingsMore.roleBookkeeperBlurb":
        "Facturation et factures seulement ; aucun accès aux conversations",
    "settingsMore.roleChanged": "{name} est maintenant {role}.",
    "settingsMore.roleMember": "Membre",
    "settingsMore.roleMemberBlurb":
        "Lit et répond aux clients ; ni facturation, ni équipe, ni "
        + "paramètres",
    "settingsMore.roleOwner": "Propriétaire",
    "settingsMore.roleReadOnly": "Consultation seulement",
    "settingsMore.roleReadOnlyBlurb":
        "Peut voir les conversations, sans répondre ni rien changer",
    "settingsMore.seatsFull":
        "Toutes les places sont prises. Désactivez un coéquipier ou "
        + "révoquez une invitation en attente d'abord.",
]

private let settingsMoreIosTagsEn: [String: String] = [
    "settingsMore.describe": "Describe",
    "settingsMore.edit": "Edit",
    "settingsMore.merge": "Merge",
    "settingsMore.mergeBody":
        "Every conversation tagged \"{tag}\" keeps its place under the tag "
        + "you pick, and this one goes away. Nothing is untagged.",
    "settingsMore.mergeDirection": "{uses} moves to \"{target}\". \"{tag}\" stops existing.",
    "settingsMore.mergeKeepWhich": "Keep which tag?",
    "settingsMore.mergeTitle": "Merge \"{tag}\" into another tag",
    "settingsMore.mergedInto": "Merged into \"{target}\".",
    "settingsMore.merging": "Merging…",
    "settingsMore.tagDescribePlaceholder": "What does this one mean?",
    "settingsMore.tagLastUsed": " · last {ago}",
    "settingsMore.tagLockDesc":
        "Anyone on the crew can add a tag by default. Lock it once your "
        + "list is the list.",
    "settingsMore.tagLockLabel": "Only owners and admins can create tags",
    "settingsMore.tagLockSupporting":
        "Everyone can still use every tag you already have. This only stops "
        + "new ones being invented mid-job.",
    "settingsMore.tagLockTitle": "Who can create tags",
    "settingsMore.tagLockedNote":
        "A tech who needs a category you do not have will leave the thread "
        + "untagged rather than ask. Check the list below now and then.",
    "settingsMore.tagNeverUsed": "never used",
    "settingsMore.tagOneThread": "1 thread",
    "settingsMore.tagThreads": "{count} threads",
    "settingsMore.tagsDesc":
        "What the crew has been tagging, and how often. The quiet ones at "
        + "the bottom are usually duplicates of something above.",
    "settingsMore.tagsTitle": "Tags",
]

private let settingsMoreIosTagsFr: [String: String] = [
    "settingsMore.describe": "Décrire",
    "settingsMore.edit": "Modifier",
    "settingsMore.merge": "Fusionner",
    "settingsMore.mergeBody":
        "Chaque conversation étiquetée « {tag} » garde sa place sous "
        + "l'étiquette que vous choisissez, et celle-ci disparaît. Rien n'est "
        + "laissé sans étiquette.",
    "settingsMore.mergeDirection": "{uses} passe à « {target} ». « {tag} » cesse d'exister.",
    "settingsMore.mergeKeepWhich": "Quelle étiquette garder ?",
    "settingsMore.mergeTitle": "Fusionner « {tag} » avec une autre étiquette",
    "settingsMore.mergedInto": "Fusionnée avec « {target} ».",
    "settingsMore.merging": "Fusion…",
    "settingsMore.tagDescribePlaceholder": "Qu'est-ce que celle-ci veut dire ?",
    "settingsMore.tagLastUsed": " · dernière il y a {ago}",
    "settingsMore.tagLockDesc":
        "Par défaut, toute l'équipe peut ajouter une étiquette. Verrouillez "
        + "une fois que votre liste est la bonne.",
    "settingsMore.tagLockLabel":
        "Seuls les propriétaires et les admins peuvent créer des étiquettes",
    "settingsMore.tagLockSupporting":
        "Tout le monde peut encore utiliser les étiquettes existantes. Cela "
        + "empêche seulement d'en inventer de nouvelles en plein travail.",
    "settingsMore.tagLockTitle": "Qui peut créer des étiquettes",
    "settingsMore.tagLockedNote":
        "Un technicien qui a besoin d'une catégorie que vous n'avez pas "
        + "laissera la conversation sans étiquette plutôt que de demander. "
        + "Revoyez la liste ci-dessous de temps en temps.",
    "settingsMore.tagNeverUsed": "jamais utilisée",
    "settingsMore.tagOneThread": "1 conversation",
    "settingsMore.tagThreads": "{count} conversations",
    "settingsMore.tagsDesc":
        "Ce que l'équipe étiquette, et à quelle fréquence. Celles qui "
        + "traînent en bas sont souvent des doublons de quelque chose plus "
        + "haut.",
    "settingsMore.tagsTitle": "Étiquettes",
]

private let settingsMoreIosTemplatesEn: [String: String] = [
    "settingsMore.createFirstTemplate": "Create your first template",
    "settingsMore.createTemplate": "Create template",
    "settingsMore.deleteTemplateBody":
        "It disappears from the composer's Templates picker for the whole "
        + "crew. This can't be undone.",
    "settingsMore.deleteTemplateTitle": "Delete \"{name}\"?",
    "settingsMore.editTemplate": "Edit template",
    "settingsMore.keepIt": "Keep it",
    "settingsMore.newTemplate": "New template",
    "settingsMore.noTemplatesYet":
        "No templates yet. Save a reply you send often, then insert it from "
        + "Templates in the composer.",
    "settingsMore.oneSegmentPerSend": "1 segment per send",
    "settingsMore.previewFor": "Preview for {name}",
    "settingsMore.savedReplies": "Saved replies",
    "settingsMore.savedReply": "Saved reply",
    "settingsMore.segmentsPerSend": "{count} segments per send",
    "settingsMore.templateCategory": "Category (optional)",
    "settingsMore.templateCategorySample": "Quoting",
    "settingsMore.templateCounter": "{used}/{max} · ",
    "settingsMore.templateCreated": "Template created.",
    "settingsMore.templateDeleted": "Template deleted.",
    "settingsMore.templateMessage": "Message",
    "settingsMore.templateMessageSample": "On our way. See you in about 20 minutes.",
    "settingsMore.templateName": "Name",
    "settingsMore.templateNameSample": "On my way",
    "settingsMore.templateSaved": "Template saved.",
    "settingsMore.templateVariables": "Variables",
    "settingsMore.templateVariablesHint":
        "Tap to insert. Each one fills in per contact when the message "
        + "sends.",
    "settingsMore.templatesIntro":
        "Replies you type all the time, saved once. Tap Templates in the "
        + "composer to insert one. Anyone on the crew can add or change them.",
    "settingsMore.updatedAgo": "Updated {ago} ago",
    "settingsMore.updatedBy": "{line} by {editor}",
    "settingsMore.updatedJustNow": "Updated just now",
    "settingsMore.updatedOn": "Updated {when}",
]

private let settingsMoreIosTemplatesFr: [String: String] = [
    "settingsMore.createFirstTemplate": "Créer votre premier modèle",
    "settingsMore.createTemplate": "Créer le modèle",
    "settingsMore.deleteTemplateBody":
        "Il disparaît du sélecteur Modèles du composeur pour toute "
        + "l'équipe. Cette action est irréversible.",
    "settingsMore.deleteTemplateTitle": "Supprimer « {name} » ?",
    "settingsMore.editTemplate": "Modifier le modèle",
    "settingsMore.keepIt": "Le garder",
    "settingsMore.newTemplate": "Nouveau modèle",
    "settingsMore.noTemplatesYet":
        "Aucun modèle pour l'instant. Enregistrez une réponse que vous "
        + "envoyez souvent, puis insérez-la depuis Modèles dans le composeur.",
    "settingsMore.oneSegmentPerSend": "1 segment par envoi",
    "settingsMore.previewFor": "Aperçu pour {name}",
    "settingsMore.savedReplies": "Réponses enregistrées",
    "settingsMore.savedReply": "Réponse enregistrée",
    "settingsMore.segmentsPerSend": "{count} segments par envoi",
    "settingsMore.templateCategory": "Catégorie (facultatif)",
    "settingsMore.templateCategorySample": "Soumissions",
    "settingsMore.templateCounter": "{used}/{max} · ",
    "settingsMore.templateCreated": "Modèle créé.",
    "settingsMore.templateDeleted": "Modèle supprimé.",
    "settingsMore.templateMessage": "Message",
    "settingsMore.templateMessageSample":
        "Nous sommes en route. On arrive dans une vingtaine de minutes.",
    "settingsMore.templateName": "Nom",
    "settingsMore.templateNameSample": "En route",
    "settingsMore.templateSaved": "Modèle enregistré.",
    "settingsMore.templateVariables": "Variables",
    "settingsMore.templateVariablesHint":
        "Touchez pour insérer. Chacune se remplit selon le client au moment "
        + "de l'envoi.",
    "settingsMore.templatesIntro":
        "Les réponses que vous tapez tout le temps, enregistrées une fois. "
        + "Touchez Modèles dans le composeur pour en insérer une. Toute "
        + "l'équipe peut en ajouter ou les modifier.",
    "settingsMore.updatedAgo": "Mis à jour il y a {ago}",
    "settingsMore.updatedBy": "{line} par {editor}",
    "settingsMore.updatedJustNow": "Mis à jour à l'instant",
    "settingsMore.updatedOn": "Mis à jour le {when}",
]

private let settingsMoreIosGreetingEn: [String: String] = [
    "settingsMore.answerAndListen": "Answer, and you'll hear what to do.",
    "settingsMore.callMe": "Call me",
    "settingsMore.calling": "Calling…",
    "settingsMore.callingNow": "Calling {number} now",
    "settingsMore.captureOnTheWay": "On the way",
    "settingsMore.captureStep1": "1. Wait for the beep.",
    "settingsMore.captureStep2": "2. Say what you want your callers to hear.",
    "settingsMore.captureStep3": "3. Hang up. It saves itself.",
    "settingsMore.captureWillAppear":
        "It'll appear above as \"{name}\" when it lands. You can close "
        + "this.",
    "settingsMore.deleteGreetingBody":
        "Any number using it goes back to the written words, read aloud. "
        + "Callers hear the change on the next call.",
    "settingsMore.deleteGreetingTitle": "Delete \"{name}\"?",
    "settingsMore.exactlyWhatCallerGets": "This is exactly what a caller gets.",
    "settingsMore.greetingOnACall": "You are on a call. End it and try again.",
    "settingsMore.haveUsCallYou": "Have us call you instead",
    "settingsMore.hearItBack": "Hear it back",
    "settingsMore.micRefused":
        "Loonext needs the microphone to record a greeting. Allow it in iOS "
        + "Settings, then try again.",
    "settingsMore.micUnavailable":
        "The microphone is not available. Close any call and try again.",
    "settingsMore.nameIt": "Name it",
    "settingsMore.noGreetingsYet":
        "Nothing recorded yet — callers hear the written greeting, read "
        + "aloud.",
    "settingsMore.nothingRecorded": "Nothing was recorded. Try holding the phone closer.",
    "settingsMore.ownVoiceDesc":
        "Record the greeting yourself instead of having it read aloud. "
        + "Callers hear a person, which is the thing you are actually "
        + "selling.",
    "settingsMore.ownVoiceTitle": "Your own voice",
    "settingsMore.pickGreetingOnNumber":
        "Pick one on a number under Numbers to use it. Anything you have "
        + "not chosen stays unused.",
    "settingsMore.ratherOnThePhone": "Rather do it on the phone?",
    "settingsMore.record": "Record",
    "settingsMore.recordAgain": "Record again",
    "settingsMore.recordOnPhone": "Record it on the phone",
    "settingsMore.recordOnPhoneBody":
        "We'll ring you, you speak after the beep, and you hang up. No "
        + "microphone permission, nothing to hold.",
    "settingsMore.recordedLength": "Recorded {length}",
    "settingsMore.recordingNow": "Recording… speak now.",
    "settingsMore.saveGreeting": "Save greeting",
    "settingsMore.stop": "Stop",
    "settingsMore.takeWontPlay": "That recording would not play back. Record it again.",
    "settingsMore.upToTwoMinutes": "Up to two minutes.",
]

private let settingsMoreIosGreetingFr: [String: String] = [
    "settingsMore.answerAndListen": "Répondez, et vous entendrez quoi faire.",
    "settingsMore.callMe": "Appelez-moi",
    "settingsMore.calling": "Appel…",
    "settingsMore.callingNow": "Appel de {number} en cours",
    "settingsMore.captureOnTheWay": "L'appel arrive",
    "settingsMore.captureStep1": "1. Attendez le bip.",
    "settingsMore.captureStep2": "2. Dites ce que vos appelants doivent entendre.",
    "settingsMore.captureStep3": "3. Raccrochez. Ça s'enregistre tout seul.",
    "settingsMore.captureWillAppear":
        "Il apparaîtra ci-dessus sous « {name} » une fois reçu. Vous pouvez "
        + "fermer cette fenêtre.",
    "settingsMore.deleteGreetingBody":
        "Tout numéro qui l'utilise revient aux mots écrits, lus à voix "
        + "haute. Les appelants entendent le changement au prochain appel.",
    "settingsMore.deleteGreetingTitle": "Supprimer « {name} » ?",
    "settingsMore.exactlyWhatCallerGets": "C'est exactement ce qu'un appelant entend.",
    "settingsMore.greetingOnACall": "Vous êtes en appel. Terminez-le et réessayez.",
    "settingsMore.haveUsCallYou": "Faites-nous plutôt vous appeler",
    "settingsMore.hearItBack": "Réécouter",
    "settingsMore.micRefused":
        "Loonext a besoin du microphone pour enregistrer un message "
        + "d'accueil. Autorisez-le dans les Réglages, puis réessayez.",
    "settingsMore.micUnavailable":
        "Le microphone n'est pas disponible. Terminez tout appel et "
        + "réessayez.",
    "settingsMore.nameIt": "Nommez-le",
    "settingsMore.noGreetingsYet":
        "Rien d'enregistré pour l'instant — les appelants entendent le "
        + "message écrit, lu à voix haute.",
    "settingsMore.nothingRecorded":
        "Rien n'a été enregistré. Essayez de tenir le téléphone plus près.",
    "settingsMore.ownVoiceDesc":
        "Enregistrez le message d'accueil vous-même au lieu de le faire "
        + "lire à voix haute. Les appelants entendent une personne, et c'est "
        + "justement ce que vous vendez.",
    "settingsMore.ownVoiceTitle": "Votre propre voix",
    "settingsMore.pickGreetingOnNumber":
        "Choisissez-en un sur un numéro, sous Numéros, pour l'utiliser. "
        + "Tout ce que vous n'avez pas choisi reste inutilisé.",
    "settingsMore.ratherOnThePhone": "Vous préférez le faire au téléphone ?",
    "settingsMore.record": "Enregistrer",
    "settingsMore.recordAgain": "Enregistrer de nouveau",
    "settingsMore.recordOnPhone": "L'enregistrer au téléphone",
    "settingsMore.recordOnPhoneBody":
        "Nous vous appelons, vous parlez après le bip, et vous raccrochez. "
        + "Aucune permission de microphone, rien à tenir.",
    "settingsMore.recordedLength": "Enregistré : {length}",
    "settingsMore.recordingNow": "Enregistrement… parlez maintenant.",
    "settingsMore.saveGreeting": "Enregistrer le message",
    "settingsMore.stop": "Arrêter",
    "settingsMore.takeWontPlay":
        "Cet enregistrement ne peut pas être joué. Enregistrez-le de "
        + "nouveau.",
    "settingsMore.upToTwoMinutes": "Jusqu'à deux minutes.",
]

private let settingsMoreIosTextEnableEn: [String: String] = [
    "settingsMore.callMeInstead": "Call me instead",
    "settingsMore.cancelOrder": "Cancel order",
    "settingsMore.cancelTextEnableBody":
        "Nothing changes with your current carrier. The number keeps "
        + "working exactly as it does today. You can start again any time.",
    "settingsMore.cancelTextEnableTitle": "Cancel text-enablement?",
    "settingsMore.codeComingByCall": "You'll get a call at your number with the code.",
    "settingsMore.codeSentBySms": "Code sent by text to your number.",
    "settingsMore.colonReason": ": {reason}",
    "settingsMore.fullStop": ".",
    "settingsMore.landlineNumberLabel": "Your landline or VoIP number",
    "settingsMore.loaUploaded": "Letter of authorization uploaded.",
    "settingsMore.numberVerified": "Number verified.",
    "settingsMore.orderResubmitted": "Order resubmitted.",
    "settingsMore.ownershipCheckNote":
        "Number ownership check: the carrier sends a code to the number "
        + "itself.",
    "settingsMore.plainBillUploaded": "Bill uploaded.",
    "settingsMore.replaceBill": "Replace bill ✓",
    "settingsMore.replaceLoa": "Replace LOA ✓",
    "settingsMore.resubmit": "Resubmit",
    "settingsMore.resubmitting": "Resubmitting…",
    "settingsMore.start": "Start",
    "settingsMore.startTextEnableBody":
        "Texting for this number runs through Loonext; calls stay with your "
        + "current carrier, nothing changes there. The carrier reviews the "
        + "order over a few business days, and you'll upload proof you own "
        + "the number.",
    "settingsMore.teActionBody": "The carrier needs something from you",
    "settingsMore.teDocsNote":
        "Ownership proof: a signed letter of authorization and a recent "
        + "bill for the number (PDF, PNG, or JPEG).",
    "settingsMore.teFailed": "Didn't go through",
    "settingsMore.teFailedBody": "The order didn't go through",
    "settingsMore.teFixAndResubmit": " Fix what's named and resubmit.",
    "settingsMore.teLive": "Texting live",
    "settingsMore.teLiveBody":
        "Texting is live on this number. Calls stay with your current "
        + "carrier.",
    "settingsMore.teOrderCreated": "Order created. Upload the documents to move it along.",
    "settingsMore.teReceived": "Order received",
    "settingsMore.teReviewing": "Carrier reviewing",
    "settingsMore.teReviewingBody":
        "The carrier reviews text-enablement over a few business days. "
        + "Texting goes live only when the review completes. We'll keep this "
        + "card honest in the meantime.",
    "settingsMore.textEnableAction": "Text-enable a number",
    "settingsMore.textEnableCancelled": "Text-enablement cancelled.",
    "settingsMore.textEnableCardTitle": "Text-enable: {number}",
    "settingsMore.textEnableDesc":
        "Keep your number: texting runs through Loonext while calls stay "
        + "exactly where they are today. The carrier review takes a few "
        + "business days.",
    "settingsMore.textEnableTitle": "Text-enable your landline",
    "settingsMore.textMeTheCode": "Text me the code",
    "settingsMore.uploadBill": "Upload bill",
    "settingsMore.uploadLoa": "Upload LOA",
    "settingsMore.verificationCode": "Verification code",
    "settingsMore.verify": "Verify",
]

private let settingsMoreIosTextEnableFr: [String: String] = [
    "settingsMore.callMeInstead": "Appelez-moi plutôt",
    "settingsMore.cancelOrder": "Annuler la commande",
    "settingsMore.cancelTextEnableBody":
        "Rien ne change chez votre fournisseur actuel. Le numéro continue "
        + "de fonctionner exactement comme aujourd'hui. Vous pouvez "
        + "recommencer à tout moment.",
    "settingsMore.cancelTextEnableTitle": "Annuler l'activation des textos ?",
    "settingsMore.codeComingByCall": "Vous recevrez un appel à votre numéro avec le code.",
    "settingsMore.codeSentBySms": "Code envoyé par texto à votre numéro.",
    "settingsMore.colonReason": " : {reason}",
    "settingsMore.fullStop": ".",
    "settingsMore.landlineNumberLabel": "Votre ligne fixe ou numéro VoIP",
    "settingsMore.loaUploaded": "Lettre d'autorisation téléversée.",
    "settingsMore.numberVerified": "Numéro vérifié.",
    "settingsMore.orderResubmitted": "Commande soumise de nouveau.",
    "settingsMore.ownershipCheckNote":
        "Vérification de propriété du numéro : le fournisseur envoie un "
        + "code au numéro lui-même.",
    "settingsMore.plainBillUploaded": "Facture téléversée.",
    "settingsMore.replaceBill": "Remplacer la facture ✓",
    "settingsMore.replaceLoa": "Remplacer la lettre ✓",
    "settingsMore.resubmit": "Soumettre de nouveau",
    "settingsMore.resubmitting": "Nouvelle soumission…",
    "settingsMore.start": "Démarrer",
    "settingsMore.startTextEnableBody":
        "Les textos de ce numéro passent par Loonext ; les appels restent "
        + "chez votre fournisseur actuel, rien n'y change. Le fournisseur "
        + "révise la commande sur quelques jours ouvrables, et vous "
        + "téléverserez une preuve que le numéro vous appartient.",
    "settingsMore.teActionBody": "Le fournisseur a besoin de quelque chose de vous",
    "settingsMore.teDocsNote":
        "Preuve de propriété : une lettre d'autorisation signée et une "
        + "facture récente pour le numéro (PDF, PNG ou JPEG).",
    "settingsMore.teFailed": "N'a pas abouti",
    "settingsMore.teFailedBody": "La commande n'a pas abouti",
    "settingsMore.teFixAndResubmit": " Corrigez ce qui est nommé et soumettez de nouveau.",
    "settingsMore.teLive": "Textos actifs",
    "settingsMore.teLiveBody":
        "Les textos sont actifs sur ce numéro. Les appels restent chez "
        + "votre fournisseur actuel.",
    "settingsMore.teOrderCreated":
        "Commande créée. Téléversez les documents pour la faire avancer.",
    "settingsMore.teReceived": "Commande reçue",
    "settingsMore.teReviewing": "Révision du fournisseur",
    "settingsMore.teReviewingBody":
        "Le fournisseur révise l'activation des textos sur quelques jours "
        + "ouvrables. Les textos ne s'activent qu'à la fin de la révision. "
        + "Nous garderons cette carte honnête entretemps.",
    "settingsMore.textEnableAction": "Activer les textos sur un numéro",
    "settingsMore.textEnableCancelled": "Activation des textos annulée.",
    "settingsMore.textEnableCardTitle": "Activation des textos : {number}",
    "settingsMore.textEnableDesc":
        "Gardez votre numéro : les textos passent par Loonext tandis que "
        + "les appels restent exactement où ils sont aujourd'hui. La révision "
        + "du fournisseur prend quelques jours ouvrables.",
    "settingsMore.textEnableTitle": "Activer les textos sur votre ligne fixe",
    "settingsMore.textMeTheCode": "Envoyez-moi le code par texto",
    "settingsMore.uploadBill": "Téléverser la facture",
    "settingsMore.uploadLoa": "Téléverser la lettre",
    "settingsMore.verificationCode": "Code de vérification",
    "settingsMore.verify": "Vérifier",
]

private let settingsMoreIosRegistrationEn: [String: String] = [
    "settingsMore.businessNumberLabel": "Business number",
    "settingsMore.campaignIntro":
        "How customers ask you to text them, and two texts you actually "
        + "send. Carriers read these.",
    "settingsMore.contactEmail": "Contact email",
    "settingsMore.contactPhone": "Contact phone",
    "settingsMore.editDetails": "Edit your details",
    "settingsMore.einLabel": "EIN",
    "settingsMore.enterContactEmail": "Enter a contact email address.",
    "settingsMore.enterContactPhone": "Enter a contact phone number.",
    "settingsMore.enterCra": "Enter your CRA business number.",
    "settingsMore.enterEin": "Enter your 9-digit EIN (numbers only, dashes ok).",
    "settingsMore.enterField": "Enter {field}.",
    "settingsMore.enterLast4": "Enter the last 4 digits of your {idLabel}.",
    "settingsMore.enterMobileForCode":
        "Enter a US or Canadian mobile number; it gets the verification "
        + "text.",
    "settingsMore.enterWebsite":
        "Enter a web address (e.g. mikesplumbing.com) or leave it blank.",
    "settingsMore.fieldCity": "the city",
    "settingsMore.fieldFirstName": "your first name",
    "settingsMore.fieldKnownName": "the business name customers know",
    "settingsMore.fieldLastName": "your last name",
    "settingsMore.fieldLegalName": "your legal business name",
    "settingsMore.fieldPostal": "the postal code",
    "settingsMore.fieldProvince": "the province",
    "settingsMore.fieldState": "the state",
    "settingsMore.fieldStreet": "the street address",
    "settingsMore.fieldTooLong": "Keep {field} under {max} characters.",
    "settingsMore.fieldZip": "the ZIP code",
    "settingsMore.firstName": "First name",
    "settingsMore.howCustomersOptIn": "How customers opt in",
    "settingsMore.industry": "Industry",
    "settingsMore.knownBusinessName": "Business name customers know",
    "settingsMore.lastName": "Last name",
    "settingsMore.legalBusinessName": "Legal business name",
    "settingsMore.mobileForCode": "Mobile for the verification text",
    "settingsMore.optInTooLong": "Keep the opt-in description under 2,048 characters.",
    "settingsMore.optInTooShort":
        "Carriers need at least 40 characters here: describe how customers "
        + "ask you to text them.",
    "settingsMore.postalLabel": "Postal code",
    "settingsMore.provinceLabel": "Province",
    "settingsMore.registrationSubmitted":
        "Submitted. We'll email you when carriers approve it.",
    "settingsMore.registryExactly": "These go to the carrier registry exactly as typed.",
    "settingsMore.sampleText1": "Sample text 1",
    "settingsMore.sampleText2": "Sample text 2",
    "settingsMore.sampleTooLong": "Keep each sample under 1,024 characters.",
    "settingsMore.sampleTooShort":
        "Each sample needs at least 20 characters: a real text you'd send.",
    "settingsMore.sinLabel": "SIN",
    "settingsMore.ssnLabel": "SSN",
    "settingsMore.stateLabel": "State",
    "settingsMore.submitting": "Submitting…",
    "settingsMore.websiteOptional": "Website (optional)",
    "settingsMore.zipLabel": "ZIP code",
]

private let settingsMoreIosRegistrationFr: [String: String] = [
    "settingsMore.businessNumberLabel": "Numéro d'entreprise",
    "settingsMore.campaignIntro":
        "Comment vos clients vous demandent de leur écrire, et deux textos "
        + "que vous envoyez vraiment. Les fournisseurs les lisent.",
    "settingsMore.contactEmail": "Courriel de contact",
    "settingsMore.contactPhone": "Téléphone de contact",
    "settingsMore.editDetails": "Modifier vos renseignements",
    "settingsMore.einLabel": "EIN",
    "settingsMore.enterContactEmail": "Entrez une adresse courriel de contact.",
    "settingsMore.enterContactPhone": "Entrez un numéro de téléphone de contact.",
    "settingsMore.enterCra": "Entrez votre numéro d'entreprise de l'ARC.",
    "settingsMore.enterEin":
        "Entrez votre EIN à 9 chiffres (chiffres seulement, tirets "
        + "acceptés).",
    "settingsMore.enterField": "Entrez {field}.",
    "settingsMore.enterLast4": "Entrez les 4 derniers chiffres de votre {idLabel}.",
    "settingsMore.enterMobileForCode":
        "Entrez un numéro mobile américain ou canadien ; c'est lui qui "
        + "recevra le texto de vérification.",
    "settingsMore.enterWebsite":
        "Entrez une adresse Web (p. ex. mikesplumbing.com) ou laissez le "
        + "champ vide.",
    "settingsMore.fieldCity": "la ville",
    "settingsMore.fieldFirstName": "votre prénom",
    "settingsMore.fieldKnownName": "le nom d'entreprise que les clients connaissent",
    "settingsMore.fieldLastName": "votre nom de famille",
    "settingsMore.fieldLegalName": "votre dénomination sociale",
    "settingsMore.fieldPostal": "le code postal",
    "settingsMore.fieldProvince": "la province",
    "settingsMore.fieldState": "l'État",
    "settingsMore.fieldStreet": "l'adresse",
    "settingsMore.fieldTooLong": "Limitez {field} à {max} caractères.",
    "settingsMore.fieldZip": "le code ZIP",
    "settingsMore.firstName": "Prénom",
    "settingsMore.howCustomersOptIn": "Comment les clients donnent leur accord",
    "settingsMore.industry": "Secteur d'activité",
    "settingsMore.knownBusinessName": "Nom d'entreprise que les clients connaissent",
    "settingsMore.lastName": "Nom de famille",
    "settingsMore.legalBusinessName": "Dénomination sociale",
    "settingsMore.mobileForCode": "Mobile pour le texto de vérification",
    "settingsMore.optInTooLong": "Limitez la description du consentement à 2 048 caractères.",
    "settingsMore.optInTooShort":
        "Les fournisseurs exigent au moins 40 caractères ici : décrivez "
        + "comment vos clients vous demandent de leur écrire.",
    "settingsMore.postalLabel": "Code postal",
    "settingsMore.provinceLabel": "Province",
    "settingsMore.registrationSubmitted":
        "Soumis. Nous vous écrirons quand les fournisseurs l'approuveront.",
    "settingsMore.registryExactly":
        "Ces renseignements sont transmis au registre des fournisseurs "
        + "exactement comme vous les tapez.",
    "settingsMore.sampleText1": "Exemple de texto 1",
    "settingsMore.sampleText2": "Exemple de texto 2",
    "settingsMore.sampleTooLong": "Limitez chaque exemple à 1 024 caractères.",
    "settingsMore.sampleTooShort":
        "Chaque exemple doit compter au moins 20 caractères : un vrai texto "
        + "que vous enverriez.",
    "settingsMore.sinLabel": "NAS",
    "settingsMore.ssnLabel": "SSN",
    "settingsMore.stateLabel": "État",
    "settingsMore.submitting": "Envoi en cours…",
    "settingsMore.websiteOptional": "Site Web (facultatif)",
    "settingsMore.zipLabel": "Code ZIP",
]

private let settingsMoreIosPortEn: [String: String] = [
    "settingsMore.billUploaded": "Carrier bill uploaded.",
    "settingsMore.checkNumber": "Check the number",
    "settingsMore.createTransfer": "Create the transfer",
    "settingsMore.creating": "Creating…",
    "settingsMore.cutoverExport": "Export your message history.",
    "settingsMore.cutoverExportDetail": "The number moves, your old conversations do not.",
    "settingsMore.cutoverKeepOld": "Keep your old service active.",
    "settingsMore.cutoverKeepOldDetail":
        "Cancelling before the transfer finishes can release the number "
        + "back to the carrier, and that is the one way to genuinely lose it.",
    "settingsMore.cutoverTellCrew": "Tell the crew the switch date.",
    "settingsMore.cutoverTellCrewDetail":
        "From that morning, calls and texts arrive in this inbox instead of "
        + "the old one.",
    "settingsMore.cutoverTextsTrail": "Expect texting to trail calls.",
    "settingsMore.cutoverTextsTrailDetail":
        "Voice and texting can finish on different clocks, so texts may "
        + "take an extra day. We will tell you when both are live.",
    "settingsMore.submitTransfer": "Submit transfer",
]

private let settingsMoreIosPortFr: [String: String] = [
    "settingsMore.billUploaded": "Facture du fournisseur téléversée.",
    "settingsMore.checkNumber": "Vérifier le numéro",
    "settingsMore.createTransfer": "Créer le transfert",
    "settingsMore.creating": "Création…",
    "settingsMore.cutoverExport": "Exportez votre historique de messages.",
    "settingsMore.cutoverExportDetail":
        "Le numéro change de main, pas vos anciennes conversations.",
    "settingsMore.cutoverKeepOld": "Gardez votre ancien service actif.",
    "settingsMore.cutoverKeepOldDetail":
        "Annuler avant la fin du transfert peut rendre le numéro au "
        + "fournisseur, et c'est la seule façon de le perdre pour de bon.",
    "settingsMore.cutoverTellCrew": "Dites la date de bascule à l'équipe.",
    "settingsMore.cutoverTellCrewDetail":
        "À partir de ce matin-là, les appels et les textos arrivent dans "
        + "cette boîte de réception plutôt que dans l'ancienne.",
    "settingsMore.cutoverTextsTrail": "Les textos peuvent suivre les appels avec du retard.",
    "settingsMore.cutoverTextsTrailDetail":
        "La voix et les textos peuvent se terminer à des moments différents "
        + ": les textos peuvent prendre une journée de plus. Nous vous dirons "
        + "quand les deux seront actifs.",
    "settingsMore.submitTransfer": "Soumettre le transfert",
]

private let settingsMoreIosExportEn: [String: String] = [
    "settingsMore.dataExport": "Data export",
    "settingsMore.exportAlreadyBuilding":
        "One is already being put together. It will appear under Data "
        + "export.",
    "settingsMore.exportBuildingNow":
        "Being put together now. It will appear under Data export.",
    "settingsMore.exportCheckAgain": "Check again",
    "settingsMore.exportDidNotFinish": "It didn't finish. Ask for another one.",
    "settingsMore.exportFrom": "From",
    "settingsMore.exportLinksExpired":
        "The links have expired and the copy has been deleted. Ask for a "
        + "fresh one above.",
    "settingsMore.exportStatusBuilding": "Being put together",
    "settingsMore.exportStatusFailed": "Didn't finish",
    "settingsMore.exportStatusReady": "Ready",
    "settingsMore.exportStoppedWatching":
        "Still building. We stopped checking to save your data.",
    "settingsMore.exportTo": "To",
    "settingsMore.exportUsageAction": "Export usage",
    "settingsMore.exportUsageBlurb":
        "Your texts, calls and storage for a period, as a file for whoever "
        + "does your books.",
    "settingsMore.exportUsageNote":
        "It counts what we measured — it is not a copy of your Stripe "
        + "invoice, and nothing on it is priced. It is put together in the "
        + "background and appears under Data export.",
    "settingsMore.startIt": "Start it",
    "settingsMore.starting": "Starting…",
]

private let settingsMoreIosExportFr: [String: String] = [
    "settingsMore.dataExport": "Exportation de données",
    "settingsMore.exportAlreadyBuilding":
        "Une exportation est déjà en préparation. Elle apparaîtra sous "
        + "Exportation de données.",
    "settingsMore.exportBuildingNow":
        "En préparation maintenant. Elle apparaîtra sous Exportation de "
        + "données.",
    "settingsMore.exportCheckAgain": "Vérifier de nouveau",
    "settingsMore.exportDidNotFinish": "Elle n'a pas abouti. Demandez-en une autre.",
    "settingsMore.exportFrom": "Du",
    "settingsMore.exportLinksExpired":
        "Les liens ont expiré et la copie a été supprimée. Demandez-en une "
        + "nouvelle ci-dessus.",
    "settingsMore.exportStatusBuilding": "En préparation",
    "settingsMore.exportStatusFailed": "N'a pas abouti",
    "settingsMore.exportStatusReady": "Prête",
    "settingsMore.exportStoppedWatching":
        "Toujours en préparation. Nous avons cessé de vérifier pour "
        + "économiser vos données.",
    "settingsMore.exportTo": "Au",
    "settingsMore.exportUsageAction": "Exporter l'utilisation",
    "settingsMore.exportUsageBlurb":
        "Vos textos, vos appels et votre stockage pour une période, sous "
        + "forme de fichier pour la personne qui tient vos livres.",
    "settingsMore.exportUsageNote":
        "Le fichier compte ce que nous avons mesuré — ce n'est pas une "
        + "copie de votre facture Stripe, et rien n'y est chiffré en dollars. "
        + "Il est assemblé en arrière-plan et apparaît sous Exportation de "
        + "données.",
    "settingsMore.startIt": "Lancer",
    "settingsMore.starting": "Démarrage…",
]

private let settingsMoreIosNumbersEn: [String: String] = [
    "settingsMore.accessAdmins": "Admins only",
    "settingsMore.accessAdminsDetail": "Members can't see this number at all.",
    "settingsMore.accessEveryone": "Everyone",
    "settingsMore.accessEveryoneDetail": "The whole team can text, like today.",
    "settingsMore.accessMembersView": "Members: view & notes only",
    "settingsMore.accessMembersViewDetail":
        "Members can read and add notes, but not text. Admins still text.",
    "settingsMore.accessUsers": "Specific people",
    "settingsMore.accessUsersDetail": "Only the people you pick. Admins still text.",
    "settingsMore.cantReachLoonext": "Can't reach Loonext. Check your connection.",
    "settingsMore.levelNote": "View & notes only",
    "settingsMore.levelText": "Can text",
    "settingsMore.numberHealthCause":
        "Carriers sometimes start filtering a number — often one that was "
        + "reused from a previous business. We've been alerted and we're on "
        + "it; you don't need to do anything yet.",
    "settingsMore.numberHealthNoRate": "Fewer of your texts are getting through than usual.",
    "settingsMore.numberHealthRate":
        "About {percent}% of your recent texts were delivered, which is "
        + "below normal for this number.",
    "settingsMore.signedOut": "You're signed out.",
]

private let settingsMoreIosNumbersFr: [String: String] = [
    "settingsMore.accessAdmins": "Admins seulement",
    "settingsMore.accessAdminsDetail": "Les membres ne voient pas ce numéro du tout.",
    "settingsMore.accessEveryone": "Tout le monde",
    "settingsMore.accessEveryoneDetail": "Toute l'équipe peut texter, comme aujourd'hui.",
    "settingsMore.accessMembersView": "Membres : consultation et notes seulement",
    "settingsMore.accessMembersViewDetail":
        "Les membres peuvent lire et ajouter des notes, mais pas texter. "
        + "Les admins textent toujours.",
    "settingsMore.accessUsers": "Personnes précises",
    "settingsMore.accessUsersDetail":
        "Seulement les personnes que vous choisissez. Les admins textent "
        + "toujours.",
    "settingsMore.cantReachLoonext": "Impossible de joindre Loonext. Vérifiez votre connexion.",
    "settingsMore.levelNote": "Consultation et notes seulement",
    "settingsMore.levelText": "Peut texter",
    "settingsMore.numberHealthCause":
        "Les fournisseurs se mettent parfois à filtrer un numéro — souvent "
        + "un numéro réutilisé d'une entreprise précédente. Nous avons été "
        + "avertis et nous nous en occupons ; vous n'avez rien à faire pour "
        + "le moment.",
    "settingsMore.numberHealthNoRate":
        "Moins de vos textos se rendent à destination qu'à l'habitude.",
    "settingsMore.numberHealthRate":
        "Environ {percent} % de vos textos récents ont été livrés, ce qui "
        + "est sous la normale pour ce numéro.",
    "settingsMore.signedOut": "Vous êtes déconnecté.",
]
