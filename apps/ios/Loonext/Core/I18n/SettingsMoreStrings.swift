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
